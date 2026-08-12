// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {CovenantStatus, CovenantStatusLib} from "./CovenantStatus.sol";
import {IOutcomeVerifier} from "./interfaces/IOutcomeVerifier.sol";
import {IResurvAction} from "./interfaces/IResurvAction.sol";

/// @title RESURV covenant manager
///
/// @notice An outcome covenant. A requester commits, before any incident, to a deterministic
///         definition of "safe", a short ordered list of pre-authorized recovery actions, one
///         trigger authority, a deadline and an escrowed success fee. A responder is paid only
///         when the committed state becomes true, and only inside the same transaction that
///         made it true.
///
/// @dev The property the whole product rests on lives in `executeAttempt`: the action, the
///      outcome check, the covenant state transition and the fee transfer are one EVM
///      transaction. A false postcondition reverts all four together. RESURV does not claim,
///      and this contract does not attempt, rollback of anything that already confirmed.
///
///      Two things this contract carries that the orchestrator cannot, both measured in Phase
///      0.5 (`docs/phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md`):
///
///      1. Semantic idempotency is onchain and permanent. KeeperHub's transport idempotency
///         bounds economic effects per idempotency key for 24 hours; a *new* key for the same
///         action was measured executing it a second time. `usedAttemptIds` is what actually
///         stops a duplicate economic effect, forever.
///      2. Access control keys on the KeeperHub organization wallet. Under gas sponsorship
///         `receipt.from` is a relayer and `receipt.to` a router, while `msg.sender` at the
///         target is the organization wallet. A contract that authorized on anything visible
///         in the receipt would authorize the wrong address.
///
///      No proxy, no upgrade path, no admin write to an armed covenant. PRD 10.2 and 10.10.
///
///      Eight `block.timestamp` comparisons carry a local `forge-lint` suppression rather than a
///      project-wide one. Every deadline and signal window in RESURV is denominated in hours or
///      days by construction, and a proposer's few seconds of latitude cannot move a covenant
///      across one. The suppression is per site so the lint keeps firing on any new comparison
///      that has not been reasoned about, which a `[lint] exclude_lints` entry would not do.
contract ResurvCovenantManager is AccessControl, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Allowed to call `executeAttempt`. Held by the KeeperHub organization wallet.
    bytes32 public constant EXECUTOR_ROLE = keccak256("RESURV_EXECUTOR_ROLE");
    /// @notice Allowed to stop new covenants, new triggers and new attempts. Never to seize.
    bytes32 public constant PAUSER_ROLE = keccak256("RESURV_PAUSER_ROLE");

    /// @dev PRD 10.6. The nonce is `uint32` and the window bounds are `uint64` seconds.
    bytes32 public constant TRIGGER_SIGNAL_TYPEHASH = keccak256(
        "TriggerSignal(bytes32 covenantId,bytes32 signalHash,uint32 nonce,uint64 validAfter,uint64 validUntil)"
    );

    /// @notice PRD 7.1: two to five approved actions. A single-action covenant is a bot.
    uint256 public constant MIN_ACTIONS = 2;
    uint256 public constant MAX_ACTIONS = 5;

    struct Covenant {
        address requester;
        address triggerAuthority;
        address responder;
        address verifier;
        address feeToken;
        uint128 feeAmount;
        uint64 deadline;
        uint32 triggerNonce;
        uint16 maxTotalAttempts;
        uint16 attemptsUsed;
        CovenantStatus status;
        /// @dev True once the escrow has left this contract, by payment or by refund. The
        ///      terminal-state rule already prevents a second transfer; this is the belt to
        ///      that braces, and it is what the escrow invariant reads.
        bool feeSettled;
        /// @dev True once `fundAndArm` has delivered the fee. Without it a cancelled DRAFT
        ///      covenant, which never paid anything in, would pay itself out of the pooled
        ///      escrow another covenant funded.
        bool funded;
        bytes32 verifierContextHash;
        bytes32 finalStateHash;
        uint256 finalObservedValue;
    }

    struct ActionSpec {
        address adapter;
        bytes32 configHash;
        uint16 maxAttempts;
        uint16 attemptsUsed;
        bool enabled;
    }

    struct CovenantParams {
        address triggerAuthority;
        address responder;
        address verifier;
        address feeToken;
        uint128 feeAmount;
        uint64 deadline;
        uint16 maxTotalAttempts;
        bytes verifierContext;
        bytes32 salt;
    }

    struct ActionInput {
        address adapter;
        bytes config;
        uint16 maxAttempts;
    }

    /// @dev The scalar half of an attempt, carried as one memory word rather than four stack
    ///      slots. `executeAttempt` plus its checks otherwise exceed the EVM's addressable
    ///      stack depth, and this is the fix that keeps the public ABI flat.
    struct AttemptRequest {
        bytes32 covenantId;
        uint256 actionIndex;
        bytes32 expectedStateHash;
        uint64 attemptSequence;
    }

    mapping(bytes32 covenantId => Covenant) internal _covenants;
    mapping(bytes32 covenantId => ActionSpec[]) internal _actions;

    /// @notice Permanent, per-covenant economic identity of an attempt. Never cleared.
    mapping(bytes32 attemptId => bool) public usedAttemptIds;

    /// @notice Escrow owed per fee token. The contract's balance must never fall below it.
    mapping(address token => uint256) public escrowed;

    /// @notice Fee tokens the manager will hold. No fee-on-transfer, rebasing or callback
    ///         tokens: `fundAndArm` measures the delivered amount and refuses a shortfall.
    mapping(address token => bool) public feeTokenAllowed;

    bool public paused;

    event CovenantCreated(
        bytes32 indexed covenantId,
        address indexed requester,
        address indexed verifier,
        address triggerAuthority,
        address responder,
        address feeToken,
        uint256 feeAmount,
        uint64 deadline,
        uint16 maxTotalAttempts,
        bytes32 verifierContextHash,
        bytes verifierContext
    );
    event CovenantActionCommitted(
        bytes32 indexed covenantId,
        uint256 indexed actionIndex,
        address indexed adapter,
        bytes32 configHash,
        uint16 maxAttempts,
        bytes config
    );
    event CovenantFunded(bytes32 indexed covenantId, address feeToken, uint256 feeAmount);
    event CovenantArmed(bytes32 indexed covenantId);
    event CovenantTriggered(bytes32 indexed covenantId, bytes32 indexed signalHash, uint32 nonce);
    /// @dev Emitted the moment an attempt's identity is burned, before the adapter runs. If the
    ///      attempt goes on to fail its postcondition the whole transaction reverts and this
    ///      event never reaches a block, which is exactly the guarantee being demonstrated.
    event AttemptStarted(
        bytes32 indexed covenantId,
        bytes32 indexed attemptId,
        uint256 actionIndex,
        bytes32 preStateHash,
        uint64 attemptSequence
    );
    /// @dev PRD 10.12, argument for argument.
    event AttemptSucceeded(
        bytes32 indexed covenantId,
        bytes32 indexed attemptId,
        uint256 actionIndex,
        bytes32 actionResultHash
    );
    event CovenantSatisfied(
        bytes32 indexed covenantId,
        bytes32 stateHash,
        uint256 observedValue,
        address responder,
        uint256 feeAmount
    );
    event CovenantSatisfiedWithoutAction(
        bytes32 indexed covenantId,
        bytes32 stateHash,
        uint256 observedValue,
        address refundRecipient,
        uint256 refundedAmount
    );
    event CovenantExpired(
        bytes32 indexed covenantId, address refundRecipient, uint256 refundedAmount
    );
    event CovenantCancelled(
        bytes32 indexed covenantId, address refundRecipient, uint256 refundedAmount
    );
    event GlobalPauseChanged(bool paused, address indexed caller);
    event FeeTokenAllowed(address indexed token, bool allowed);

    error InvalidStatus();
    error CovenantHasExpired();
    error CovenantNotExpired();
    error InvalidSignature();
    error InvalidNonce();
    error SignalNotYetValid();
    error SignalExpired();
    error InvalidVerifierContext();
    error InvalidActionConfig();
    error ActionUnavailable();
    error AttemptAlreadyUsed();
    error AttemptLimitReached();
    error StaleState();
    error OutcomeNotSatisfied(bytes32 stateHash, uint256 observedValue);
    error OutcomeAlreadySatisfied();
    error OutcomeNotSatisfiedYet();
    error FeeTransferFailed();
    error AlreadyTerminal();
    error CovenantAlreadyExists();
    error NotRequester();
    error GlobalPause();
    error InvalidParameters();
    error FeeTokenNotAllowed();

    modifier whenNotPaused() {
        if (paused) revert GlobalPause();
        _;
    }

    /// @param admin Global configuration only. Cannot rewrite an armed covenant.
    /// @param pauser Emergency multisig.
    /// @param executor KeeperHub organization wallet, the `msg.sender` a sponsored call
    ///        presents at this contract.
    /// @param initialFeeTokens Fee tokens allowed from the start.
    /// @dev Every role is an explicit argument because this contract is deployed through a
    ///      CREATE2 factory, so `msg.sender` in the constructor is the factory and not the
    ///      operator. A contract that granted admin to `msg.sender` here would hand the
    ///      factory the keys.
    constructor(address admin, address pauser, address executor, address[] memory initialFeeTokens)
        EIP712("RESURV", "1")
    {
        if (admin == address(0) || pauser == address(0) || executor == address(0)) {
            revert InvalidParameters();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, pauser);
        _grantRole(EXECUTOR_ROLE, executor);
        for (uint256 i = 0; i < initialFeeTokens.length; ++i) {
            address token = initialFeeTokens[i];
            if (token == address(0)) revert InvalidParameters();
            feeTokenAllowed[token] = true;
            emit FeeTokenAllowed(token, true);
        }
    }

    // ---------------------------------------------------------------------------------------
    // Creation and arming
    // ---------------------------------------------------------------------------------------

    /// @notice Commit a covenant. Everything that decides what may happen is fixed here.
    /// @dev The full verifier context and every action config are emitted, not just their
    ///      hashes, so the covenant can be reconstructed from chain alone by the public proof
    ///      page. The contract validates the hashes at attempt time either way.
    function createCovenant(CovenantParams calldata params, ActionInput[] calldata actionInputs)
        external
        whenNotPaused
        returns (bytes32 covenantId)
    {
        if (
            params.triggerAuthority == address(0) || params.responder == address(0)
                || params.verifier == address(0) || params.feeAmount == 0
                // forge-lint: disable-next-line(block-timestamp)
                || params.deadline <= block.timestamp || params.maxTotalAttempts == 0
        ) revert InvalidParameters();
        if (actionInputs.length < MIN_ACTIONS || actionInputs.length > MAX_ACTIONS) {
            revert InvalidParameters();
        }
        if (!feeTokenAllowed[params.feeToken]) revert FeeTokenNotAllowed();

        covenantId = keccak256(abi.encode(block.chainid, address(this), msg.sender, params.salt));
        if (_covenants[covenantId].status != CovenantStatus.NONE) revert CovenantAlreadyExists();

        bytes32 contextHash = keccak256(params.verifierContext);

        _covenants[covenantId] = Covenant({
            requester: msg.sender,
            triggerAuthority: params.triggerAuthority,
            responder: params.responder,
            verifier: params.verifier,
            feeToken: params.feeToken,
            feeAmount: params.feeAmount,
            deadline: params.deadline,
            triggerNonce: 0,
            maxTotalAttempts: params.maxTotalAttempts,
            attemptsUsed: 0,
            status: CovenantStatus.DRAFT,
            feeSettled: false,
            funded: false,
            verifierContextHash: contextHash,
            finalStateHash: bytes32(0),
            finalObservedValue: 0
        });

        emit CovenantCreated(
            covenantId,
            msg.sender,
            params.verifier,
            params.triggerAuthority,
            params.responder,
            params.feeToken,
            params.feeAmount,
            params.deadline,
            params.maxTotalAttempts,
            contextHash,
            params.verifierContext
        );

        for (uint256 i = 0; i < actionInputs.length; ++i) {
            ActionInput calldata input = actionInputs[i];
            if (input.adapter == address(0) || input.maxAttempts == 0) revert InvalidParameters();
            bytes32 configHash = keccak256(input.config);
            _actions[covenantId].push(
                ActionSpec({
                    adapter: input.adapter,
                    configHash: configHash,
                    maxAttempts: input.maxAttempts,
                    attemptsUsed: 0,
                    enabled: true
                })
            );
            emit CovenantActionCommitted(
                covenantId, i, input.adapter, configHash, input.maxAttempts, input.config
            );
        }
    }

    /// @notice Deposit the success fee and arm the covenant. PRD 8.1: a covenant enters ARMED
    ///         only after funding.
    /// @dev The delivered amount is measured rather than trusted. A fee-on-transfer token
    ///      would otherwise leave the escrow short by an amount nothing would notice until a
    ///      responder was paid less than the covenant promised.
    function fundAndArm(bytes32 covenantId) external whenNotPaused nonReentrant {
        Covenant storage covenant = _covenants[covenantId];
        if (covenant.status != CovenantStatus.DRAFT) revert InvalidStatus();
        if (msg.sender != covenant.requester) revert NotRequester();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= covenant.deadline) revert CovenantHasExpired();

        IERC20 token = IERC20(covenant.feeToken);
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), covenant.feeAmount);
        uint256 delivered = token.balanceOf(address(this)) - before;
        if (delivered != covenant.feeAmount) revert FeeTransferFailed();

        escrowed[covenant.feeToken] += covenant.feeAmount;
        covenant.funded = true;
        covenant.status = CovenantStatus.ARMED;

        emit CovenantFunded(covenantId, covenant.feeToken, covenant.feeAmount);
        emit CovenantArmed(covenantId);
    }

    // ---------------------------------------------------------------------------------------
    // Trigger
    // ---------------------------------------------------------------------------------------

    /// @notice Activate an armed covenant with an EIP-712 signature from its trigger authority.
    ///         Anyone may relay it; only the authority can author it.
    /// @dev The nonce is consumed whether or not the relayer is the authority, so the same
    ///      signed message can never be submitted twice. Combined with the status check, a
    ///      duplicate trigger fails on two independent grounds.
    function trigger(
        bytes32 covenantId,
        bytes32 signalHash,
        uint32 nonce,
        uint64 validAfter,
        uint64 validUntil,
        bytes calldata signature
    ) external whenNotPaused {
        Covenant storage covenant = _covenants[covenantId];
        if (covenant.status != CovenantStatus.ARMED) revert InvalidStatus();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > covenant.deadline) revert CovenantHasExpired();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < validAfter) revert SignalNotYetValid();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > validUntil) revert SignalExpired();
        if (nonce != covenant.triggerNonce) revert InvalidNonce();

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    TRIGGER_SIGNAL_TYPEHASH, covenantId, signalHash, nonce, validAfter, validUntil
                )
            )
        );
        if (ECDSA.recover(digest, signature) != covenant.triggerAuthority) {
            revert InvalidSignature();
        }

        covenant.triggerNonce = nonce + 1;
        covenant.status = CovenantStatus.TRIGGERED;

        emit CovenantTriggered(covenantId, signalHash, nonce);
    }

    /// @notice The digest a trigger authority signs. Exposed so an offchain signer never has to
    ///         re-derive the domain separator by hand.
    function triggerDigest(
        bytes32 covenantId,
        bytes32 signalHash,
        uint32 nonce,
        uint64 validAfter,
        uint64 validUntil
    ) external view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    TRIGGER_SIGNAL_TYPEHASH, covenantId, signalHash, nonce, validAfter, validUntil
                )
            )
        );
    }

    // ---------------------------------------------------------------------------------------
    // The atomic attempt
    // ---------------------------------------------------------------------------------------

    /// @notice Execute one committed recovery action and pay only if the committed outcome
    ///         became true. PRD 10.7.
    ///
    /// @dev Order matters and is not a style choice:
    ///      - every commitment is checked before anything external is called;
    ///      - the attempt id is burned before the adapter runs, so a reentrant call with the
    ///        same identity fails even if the guard were removed;
    ///      - the verifier is `view`, so the compiler emits STATICCALL and a verifier that
    ///        tries to write reverts rather than satisfying itself;
    ///      - `satisfied == false` reverts, which unwinds the adapter's writes, the attempt
    ///        counters, the status change and the fee together. That single revert is the
    ///        product.
    function executeAttempt(
        bytes32 covenantId,
        uint256 actionIndex,
        bytes calldata actionConfig,
        bytes calldata verifierContext,
        bytes32 expectedStateHash,
        uint64 attemptSequence
    ) external nonReentrant whenNotPaused onlyRole(EXECUTOR_ROLE) returns (bytes32) {
        return _executeAttempt(
            AttemptRequest({
                covenantId: covenantId,
                actionIndex: actionIndex,
                expectedStateHash: expectedStateHash,
                attemptSequence: attemptSequence
            }),
            actionConfig,
            verifierContext
        );
    }

    /// @dev The external entry point is a flat six-argument ABI because a caller writing a
    ///      KeeperHub request body should not have to encode a tuple. The work happens here,
    ///      against the packed request, because the flat form plus its locals exceeds the EVM's
    ///      addressable stack.
    function _executeAttempt(
        AttemptRequest memory request,
        bytes calldata actionConfig,
        bytes calldata verifierContext
    ) internal returns (bytes32) {
        (bytes32 attemptId,, address adapter) =
            _consumeAttempt(request, actionConfig, verifierContext);

        emit AttemptSucceeded(
            request.covenantId,
            attemptId,
            request.actionIndex,
            IResurvAction(adapter).execute(request.covenantId, actionConfig)
        );

        Covenant storage covenant = _covenants[request.covenantId];
        (bool satisfied, bytes32 stateHash, uint256 observedValue) =
            IOutcomeVerifier(covenant.verifier).evaluate(request.covenantId, verifierContext);
        if (!satisfied) revert OutcomeNotSatisfied(stateHash, observedValue);

        covenant.status = CovenantStatus.SATISFIED;
        covenant.finalStateHash = stateHash;
        covenant.finalObservedValue = observedValue;

        emit CovenantSatisfied(
            request.covenantId,
            stateHash,
            observedValue,
            covenant.responder,
            _settleEscrow(covenant, covenant.responder)
        );

        return stateHash;
    }

    /// @dev Every commitment check, the stale-state check, and the permanent burn of this
    ///      attempt's identity. Split out of `executeAttempt` because the two halves together
    ///      exceed the EVM's addressable stack, and split *here* on purpose: everything that
    ///      decides whether the attempt is allowed happens before the first external call, and
    ///      the attempt id is consumed before it too.
    function _consumeAttempt(
        AttemptRequest memory request,
        bytes calldata actionConfig,
        bytes calldata verifierContext
    ) internal returns (bytes32 attemptId, bytes32 preStateHash, address adapter) {
        bytes32 covenantId = request.covenantId;
        Covenant storage covenant = _covenants[covenantId];

        if (
            covenant.status != CovenantStatus.TRIGGERED
                && covenant.status != CovenantStatus.EXECUTING
        ) {
            if (CovenantStatusLib.isTerminal(covenant.status)) revert AlreadyTerminal();
            revert InvalidStatus();
        }
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > covenant.deadline) revert CovenantHasExpired();
        if (keccak256(verifierContext) != covenant.verifierContextHash) {
            revert InvalidVerifierContext();
        }
        if (request.actionIndex >= _actions[covenantId].length) revert ActionUnavailable();

        ActionSpec storage action = _actions[covenantId][request.actionIndex];
        if (!action.enabled || action.attemptsUsed >= action.maxAttempts) {
            revert ActionUnavailable();
        }
        if (covenant.attemptsUsed >= covenant.maxTotalAttempts) revert AttemptLimitReached();
        if (keccak256(actionConfig) != action.configHash) revert InvalidActionConfig();

        (, preStateHash,) =
            IOutcomeVerifier(covenant.verifier).evaluate(covenantId, verifierContext);
        if (request.expectedStateHash != bytes32(0) && preStateHash != request.expectedStateHash) {
            revert StaleState();
        }

        attemptId = computeAttemptId(
            covenantId, request.actionIndex, preStateHash, request.attemptSequence
        );
        if (usedAttemptIds[attemptId]) revert AttemptAlreadyUsed();
        usedAttemptIds[attemptId] = true;

        action.attemptsUsed += 1;
        covenant.attemptsUsed += 1;
        covenant.status = CovenantStatus.EXECUTING;

        adapter = action.adapter;

        emit AttemptStarted(
            covenantId, attemptId, request.actionIndex, preStateHash, request.attemptSequence
        );
    }

    /// @notice Close a covenant whose outcome was already true when it was triggered. PRD 10.8.
    /// @dev No recovery action ran, so no success fee is earned: v1 pays a zero verification fee
    ///      and refunds the escrow to the requester. Permissionless, because refusing to close a
    ///      covenant whose promise is already kept only strands escrow. The demo does not use
    ///      this path.
    function finalizeAlreadySatisfied(bytes32 covenantId, bytes calldata verifierContext)
        external
        nonReentrant
        whenNotPaused
    {
        Covenant storage covenant = _covenants[covenantId];
        if (covenant.status != CovenantStatus.TRIGGERED) revert InvalidStatus();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > covenant.deadline) revert CovenantHasExpired();
        if (keccak256(verifierContext) != covenant.verifierContextHash) {
            revert InvalidVerifierContext();
        }

        (bool satisfied, bytes32 stateHash, uint256 observedValue) =
            IOutcomeVerifier(covenant.verifier).evaluate(covenantId, verifierContext);
        if (!satisfied) revert OutcomeNotSatisfiedYet();

        covenant.status = CovenantStatus.SATISFIED;
        covenant.finalStateHash = stateHash;
        covenant.finalObservedValue = observedValue;

        uint256 refunded = _settleEscrow(covenant, covenant.requester);

        emit CovenantSatisfiedWithoutAction(
            covenantId, stateHash, observedValue, covenant.requester, refunded
        );
    }

    // ---------------------------------------------------------------------------------------
    // Exits
    // ---------------------------------------------------------------------------------------

    /// @notice Refund a triggered covenant whose deadline passed with the outcome still false.
    ///         PRD 8.6. Permissionless, and not blocked by the global pause: a pause must never
    ///         strand somebody else's escrow.
    /// @dev The verifier is consulted first and expiry is refused when it answers true, so a
    ///      covenant cannot be expired out from under a responder who earned the fee. A
    ///      verifier that reverts is treated as "not verifiable", which permits the refund:
    ///      the alternative is escrow locked forever behind a broken oracle.
    function expireCovenant(bytes32 covenantId, bytes calldata verifierContext)
        external
        nonReentrant
    {
        Covenant storage covenant = _covenants[covenantId];
        if (
            covenant.status != CovenantStatus.TRIGGERED
                && covenant.status != CovenantStatus.EXECUTING
        ) {
            revert InvalidStatus();
        }
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp <= covenant.deadline) revert CovenantNotExpired();
        if (keccak256(verifierContext) != covenant.verifierContextHash) {
            revert InvalidVerifierContext();
        }

        try IOutcomeVerifier(covenant.verifier).evaluate(covenantId, verifierContext) returns (
            bool satisfied, bytes32, uint256
        ) {
            if (satisfied) revert OutcomeAlreadySatisfied();
        } catch {
            // Not verifiable. Fall through to the refund rather than trapping the escrow.
        }

        covenant.status = CovenantStatus.EXPIRED;
        uint256 refunded = _settleEscrow(covenant, covenant.requester);

        emit CovenantExpired(covenantId, covenant.requester, refunded);
    }

    /// @notice Withdraw a covenant that has not been triggered. PRD 8.7. Not blocked by the
    ///         global pause, for the same reason expiry is not.
    function cancelCovenant(bytes32 covenantId) external nonReentrant {
        Covenant storage covenant = _covenants[covenantId];
        if (covenant.status != CovenantStatus.DRAFT && covenant.status != CovenantStatus.ARMED) {
            revert InvalidStatus();
        }
        if (msg.sender != covenant.requester) revert NotRequester();

        covenant.status = CovenantStatus.CANCELLED;
        uint256 refunded = _settleEscrow(covenant, covenant.requester);

        emit CovenantCancelled(covenantId, covenant.requester, refunded);
    }

    // ---------------------------------------------------------------------------------------
    // Global configuration. Nothing here can touch an existing covenant.
    // ---------------------------------------------------------------------------------------

    function setPaused(bool value) external onlyRole(PAUSER_ROLE) {
        paused = value;
        emit GlobalPauseChanged(value, msg.sender);
    }

    /// @dev Disallowing a token stops new covenants from using it. Covenants already funded
    ///      with it keep their escrow and their payout, because an admin who could strand an
    ///      armed covenant's fee would be an admin who could rewrite it.
    function setFeeTokenAllowed(address token, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0)) revert InvalidParameters();
        feeTokenAllowed[token] = allowed;
        emit FeeTokenAllowed(token, allowed);
    }

    // ---------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------

    function getCovenant(bytes32 covenantId) external view returns (Covenant memory) {
        return _covenants[covenantId];
    }

    function getActions(bytes32 covenantId) external view returns (ActionSpec[] memory) {
        return _actions[covenantId];
    }

    function actionCount(bytes32 covenantId) external view returns (uint256) {
        return _actions[covenantId].length;
    }

    function statusOf(bytes32 covenantId) external view returns (CovenantStatus) {
        return _covenants[covenantId].status;
    }

    /// @notice Read the outcome without attempting anything. The public proof page and the
    ///         orchestrator both use this, and neither may treat it as authority to advance:
    ///         only a successful `executeAttempt` marks a covenant satisfied.
    function readOutcome(bytes32 covenantId, bytes calldata verifierContext)
        external
        view
        returns (bool satisfied, bytes32 stateHash, uint256 observedValue)
    {
        Covenant storage covenant = _covenants[covenantId];
        if (keccak256(verifierContext) != covenant.verifierContextHash) {
            revert InvalidVerifierContext();
        }
        return IOutcomeVerifier(covenant.verifier).evaluate(covenantId, verifierContext);
    }

    /// @notice The permanent economic identity of one attempt. PRD 12.7.
    /// @dev Includes the pre-state hash, so the same action retried after the world moved is a
    ///      different attempt, and the same action retried against the same world is not.
    function computeAttemptId(
        bytes32 covenantId,
        uint256 actionIndex,
        bytes32 preStateHash,
        uint64 attemptSequence
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(covenantId, actionIndex, preStateHash, attemptSequence));
    }

    function computeCovenantId(address requester, bytes32 salt) external view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), requester, salt));
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ---------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------

    /// @dev The single exit for escrowed value. Marks the covenant settled before transferring,
    ///      so a token with a callback cannot re-enter into a second payout even if the
    ///      reentrancy guard were removed, and returns the amount so callers can emit it.
    function _settleEscrow(Covenant storage covenant, address recipient)
        internal
        returns (uint256)
    {
        if (covenant.feeSettled) revert FeeTransferFailed();
        covenant.feeSettled = true;

        // A DRAFT covenant paid nothing in, so it must take nothing out. Reading the pooled
        // escrow balance instead would let it withdraw another covenant's fee.
        if (!covenant.funded) return 0;

        uint256 amount = covenant.feeAmount;
        if (amount == 0) return 0;

        escrowed[covenant.feeToken] -= amount;
        IERC20(covenant.feeToken).safeTransfer(recipient, amount);
        return amount;
    }
}
