// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test, console} from "forge-std/Test.sol";
import {CovenantStatus, CovenantStatusLib} from "../../src/CovenantStatus.sol";
import {ResurvCovenantManager} from "../../src/ResurvCovenantManager.sol";
import {EvacuateERC20Action} from "../../src/actions/EvacuateERC20Action.sol";
import {PauseAction} from "../../src/actions/PauseAction.sol";
import {VaultSafeStateVerifier} from "../../src/verifiers/VaultSafeStateVerifier.sol";
import {DemoVault} from "../../src/demo/DemoVault.sol";
import {TestUSD} from "../../src/demo/TestUSD.sol";

/// @notice Stateful driver for the covenant manager.
///
/// @dev Two rules carried over from the Phase 0 remediation, because they are the difference
///      between a suite that can fail and one that cannot:
///
///      1. Nothing is gated on the contract under test. The handler attempts illegal things on
///         purpose and records what the contract allowed, rather than asking it what to try.
///      2. Coverage is reported behaviorally in `afterInvariant`. A handler call that could not
///         mutate anything is not depth, and a large call count is not evidence.
///
///      `fail_on_revert = true`, so every call here catches its own reverts and records them.
///      A revert that escapes is a defect in the handler, which is what that setting is for.
contract CovenantHandler is Test {
    uint256 internal constant TRIGGER_KEY = 0xA11CE;

    ResurvCovenantManager public immutable manager;
    TestUSD public immutable token;
    DemoVault public immutable vault;
    VaultSafeStateVerifier public immutable verifier;
    PauseAction public immutable pauseAction;
    EvacuateERC20Action public immutable evacuateAction;

    address public immutable admin;
    address public immutable executor;
    address public immutable requester;
    address public immutable responder;
    address public immutable safeRecipient;
    address public immutable triggerAuthority;

    bytes32[] public covenantIds;
    mapping(bytes32 => bool) internal known;

    /// @dev Commitments snapshotted at arm time, so a later rewrite is observable.
    struct Commitment {
        address verifier;
        address responder;
        address feeToken;
        uint128 feeAmount;
        uint64 deadline;
        bytes32 verifierContextHash;
        bytes32 actionsDigest;
        bool armed;
    }

    mapping(bytes32 => Commitment) public commitments;
    mapping(bytes32 => uint256) public payouts;
    mapping(bytes32 => uint256) public refunds;
    mapping(bytes32 => uint256) public expectedEscrow;
    mapping(bytes32 => uint32) public triggersAccepted;

    bool public attemptSucceededAfterTerminal;
    bool public attemptSucceededWithoutATrigger;
    bool public attemptSucceededWithFalseOutcome;
    bool public commitmentRewritten;
    bool public nonceReplayed;
    bool public paidTwice;
    bool public attemptExceededLimits;

    uint256 public created;
    uint256 public armedCount;
    uint256 public triggered;
    uint256 public attemptsMade;
    uint256 public attemptsSucceeded;
    uint256 public attemptsRejected;
    uint256 public expiries;
    uint256 public cancellations;
    uint256 public terminalAttempts;

    constructor(
        ResurvCovenantManager manager_,
        TestUSD token_,
        DemoVault vault_,
        VaultSafeStateVerifier verifier_,
        PauseAction pauseAction_,
        EvacuateERC20Action evacuateAction_,
        address admin_,
        address executor_,
        address requester_,
        address responder_,
        address safeRecipient_
    ) {
        manager = manager_;
        token = token_;
        vault = vault_;
        verifier = verifier_;
        pauseAction = pauseAction_;
        evacuateAction = evacuateAction_;
        admin = admin_;
        executor = executor_;
        requester = requester_;
        responder = responder_;
        safeRecipient = safeRecipient_;
        triggerAuthority = vm.addr(TRIGGER_KEY);
    }

    // -------------------------------------------------------------------------------------
    // Committed shapes
    // -------------------------------------------------------------------------------------

    function verifierContext() public view returns (bytes memory) {
        return abi.encode(address(vault), safeRecipient, address(token), uint256(0), uint256(1));
    }

    function pauseConfig() public view returns (bytes memory) {
        return abi.encode(address(vault));
    }

    function evacuateConfig() public view returns (bytes memory) {
        return
            abi.encode(address(vault), address(token), safeRecipient, uint256(1), type(uint256).max);
    }

    function actionInputs()
        public
        view
        returns (ResurvCovenantManager.ActionInput[] memory inputs)
    {
        inputs = new ResurvCovenantManager.ActionInput[](2);
        inputs[0] = ResurvCovenantManager.ActionInput({
            adapter: address(pauseAction), config: pauseConfig(), maxAttempts: 2
        });
        inputs[1] = ResurvCovenantManager.ActionInput({
            adapter: address(evacuateAction), config: evacuateConfig(), maxAttempts: 2
        });
    }

    function actionsDigest() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                address(pauseAction),
                keccak256(pauseConfig()),
                address(evacuateAction),
                keccak256(evacuateConfig())
            )
        );
    }

    function covenantCount() external view returns (uint256) {
        return covenantIds.length;
    }

    // -------------------------------------------------------------------------------------
    // Handler actions
    // -------------------------------------------------------------------------------------

    /// @notice Two armed and triggered covenants, created before the campaign starts.
    /// @dev Not a fuzz target. Called once from `setUp`.
    function bootstrap() external {
        for (uint96 i = 1; i <= 2; ++i) {
            this.createAndFund(i * 1000, 20 days, true);
            this.triggerCovenant(covenantIds.length - 1, 0);
        }
    }

    function createAndFund(uint96 feeSeed, uint32 deadlineSeed, bool fund) external {
        uint128 fee = uint128(bound(uint256(feeSeed), 1, 1_000_000_000));
        uint64 deadline = uint64(block.timestamp + bound(uint256(deadlineSeed), 1, 30 days));
        bytes32 salt = keccak256(abi.encode("covenant", covenantIds.length, feeSeed));

        ResurvCovenantManager.CovenantParams memory params = ResurvCovenantManager.CovenantParams({
            triggerAuthority: triggerAuthority,
            responder: responder,
            verifier: address(verifier),
            feeToken: address(token),
            feeAmount: fee,
            deadline: deadline,
            maxTotalAttempts: 3,
            verifierContext: verifierContext(),
            salt: salt
        });

        vm.prank(requester);
        try manager.createCovenant(params, actionInputs()) returns (bytes32 covenantId) {
            ++created;
            if (!known[covenantId]) {
                known[covenantId] = true;
                covenantIds.push(covenantId);
            }
            if (!fund) return;

            token.mint(requester, fee);
            vm.prank(requester);
            token.approve(address(manager), fee);
            vm.prank(requester);
            try manager.fundAndArm(covenantId) {
                ++armedCount;
                expectedEscrow[covenantId] = fee;
                commitments[covenantId] = Commitment({
                    verifier: address(verifier),
                    responder: responder,
                    feeToken: address(token),
                    feeAmount: fee,
                    deadline: deadline,
                    verifierContextHash: keccak256(verifierContext()),
                    actionsDigest: actionsDigest(),
                    armed: true
                });
            } catch {}
        } catch {}
    }

    /// @dev Three of four calls use the nonce the covenant actually expects. A fuzzer drawing a
    ///      uniform `uint32` would satisfy the nonce check essentially never, and a handler
    ///      whose calls all bounce is depth without coverage. The fourth call keeps the
    ///      rejection path live.
    function triggerCovenant(uint256 idSeed, uint32 nonceSeed) external {
        if (covenantIds.length == 0) return;
        bytes32 covenantId = _pick(idSeed, CovenantStatus.ARMED, nonceSeed);
        uint32 nonceBefore = manager.getCovenant(covenantId).triggerNonce;
        uint32 nonce = nonceSeed % 4 == 0 ? nonceSeed : nonceBefore;

        uint64 validAfter = uint64(block.timestamp);
        uint64 validUntil = uint64(block.timestamp + 1 hours);
        bytes32 signalHash = keccak256(abi.encode("signal", covenantId, nonce));
        bytes32 digest =
            manager.triggerDigest(covenantId, signalHash, nonce, validAfter, validUntil);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(TRIGGER_KEY, digest);

        try manager.trigger(
            covenantId, signalHash, nonce, validAfter, validUntil, abi.encodePacked(r, s, v)
        ) {
            ++triggered;
            ++triggersAccepted[covenantId];
            // A nonce is consumed exactly once. Accepting one that is not strictly greater
            // than every previously accepted nonce would be a replay.
            if (nonce != nonceBefore) nonceReplayed = true;
            if (manager.getCovenant(covenantId).triggerNonce != nonce + 1) nonceReplayed = true;
        } catch {}
    }

    function attempt(uint256 idSeed, uint256 actionSeed, uint64 sequence) external {
        if (covenantIds.length == 0) return;
        // Truncation is intended: only the low bits decide whether the pick is steered.
        // forge-lint: disable-next-line(unsafe-typecast)
        bytes32 covenantId = _pick(idSeed, CovenantStatus.TRIGGERED, uint32(actionSeed));
        uint256 actionIndex = actionSeed % 3; // 3 so an out-of-range index is attempted too
        bytes memory config = actionIndex == 0 ? pauseConfig() : evacuateConfig();

        CovenantStatus statusBefore = manager.statusOf(covenantId);
        bool wasTerminal = CovenantStatusLib.isTerminal(statusBefore);
        if (wasTerminal) ++terminalAttempts;
        uint16 usedBefore = manager.getCovenant(covenantId).attemptsUsed;
        uint16 limit = manager.getCovenant(covenantId).maxTotalAttempts;

        ++attemptsMade;
        vm.prank(executor);
        try manager.executeAttempt(
            covenantId, actionIndex, config, verifierContext(), bytes32(0), sequence
        ) {
            ++attemptsSucceeded;
            if (wasTerminal) attemptSucceededAfterTerminal = true;
            if (triggersAccepted[covenantId] == 0) attemptSucceededWithoutATrigger = true;
            if (usedBefore >= limit) attemptExceededLimits = true;

            (bool satisfied,,) = verifier.evaluate(covenantId, verifierContext());
            if (!satisfied) attemptSucceededWithFalseOutcome = true;

            payouts[covenantId] += 1;
            if (payouts[covenantId] + refunds[covenantId] > 1) paidTwice = true;
            expectedEscrow[covenantId] = 0;
        } catch {
            ++attemptsRejected;
        }
    }

    function expire(uint256 idSeed) external {
        if (covenantIds.length == 0) return;
        // Truncation is intended: only the low bits decide whether the pick is steered.
        // forge-lint: disable-next-line(unsafe-typecast)
        bytes32 covenantId = _pick(idSeed, CovenantStatus.TRIGGERED, uint32(idSeed));
        try manager.expireCovenant(covenantId, verifierContext()) {
            ++expiries;
            refunds[covenantId] += 1;
            if (payouts[covenantId] + refunds[covenantId] > 1) paidTwice = true;
            expectedEscrow[covenantId] = 0;
        } catch {}
    }

    function cancel(uint256 idSeed) external {
        if (covenantIds.length == 0) return;
        bytes32 covenantId = covenantIds[idSeed % covenantIds.length];
        vm.prank(requester);
        try manager.cancelCovenant(covenantId) {
            ++cancellations;
            if (expectedEscrow[covenantId] > 0) {
                refunds[covenantId] += 1;
                if (payouts[covenantId] + refunds[covenantId] > 1) paidTwice = true;
            }
            expectedEscrow[covenantId] = 0;
        } catch {}
    }

    /// @dev Moves the world so outcomes flip between attempts, which is what makes the
    ///      stale-state and postcondition paths reachable.
    function refillVault(uint96 amount) external {
        token.mint(address(vault), bound(uint256(amount), 1, 1_000_000));
    }

    function pauseVaultOutOfBand() external {
        bytes32 role = vault.PAUSER_ROLE();
        vm.prank(admin);
        try vault.grantRole(role, admin) {} catch {}
        vm.prank(admin);
        try vault.pause() {} catch {}
    }

    function skipAhead(uint32 seconds_) external {
        vm.warp(block.timestamp + bound(uint256(seconds_), 1 minutes, 5 days));
    }

    /// @dev Steering, not gating. The fuzzer picks the covenant; this only biases the pick
    ///      toward one in a state where the call has something to do, because a driver whose
    ///      every call bounces off a status check reports depth it did not have. One call in
    ///      four ignores the preference outright, and nothing here consults the transition
    ///      logic under test: it reads a stored status, exactly as an operator would.
    function _pick(uint256 idSeed, CovenantStatus preferred, uint32 forceSeed)
        internal
        view
        returns (bytes32)
    {
        uint256 count = covenantIds.length;
        // Reduced before the addition: the fuzzer draws a full-width uint256 and `idSeed + i`
        // would overflow on it.
        uint256 start = idSeed % count;
        bytes32 fallbackId = covenantIds[start];
        if (forceSeed % 4 == 0) return fallbackId;
        for (uint256 i = 0; i < count; ++i) {
            bytes32 candidate = covenantIds[(start + i) % count];
            if (manager.statusOf(candidate) == preferred) return candidate;
        }
        return fallbackId;
    }

    /// @dev Every admin surface that exists, fired at a live covenant. There is no setter that
    ///      touches one, and the commitment check below is what proves it.
    ///
    ///      The pause is deliberately rare. An earlier version toggled it on half its calls,
    ///      which left the manager paused for most of every run: 1789 creation attempts
    ///      produced two covenants and no trigger was ever accepted. The suite was green and
    ///      it was measuring nothing.
    function adminPokes(uint8 seed) external {
        vm.prank(admin);
        try manager.setFeeTokenAllowed(address(token), seed % 16 != 0) {} catch {}
        vm.prank(admin);
        try manager.setPaused(seed % 8 == 0) {} catch {}
        if (seed % 8 == 0) {
            vm.prank(admin);
            try manager.setPaused(false) {} catch {}
        }
        vm.prank(admin);
        try manager.setFeeTokenAllowed(address(token), true) {} catch {}
        _checkCommitments();
    }

    function _checkCommitments() internal {
        for (uint256 i = 0; i < covenantIds.length; ++i) {
            bytes32 covenantId = covenantIds[i];
            Commitment memory snapshot = commitments[covenantId];
            if (!snapshot.armed) continue;
            ResurvCovenantManager.Covenant memory live = manager.getCovenant(covenantId);
            if (
                live.verifier != snapshot.verifier || live.responder != snapshot.responder
                    || live.feeToken != snapshot.feeToken || live.feeAmount != snapshot.feeAmount
                    || live.deadline != snapshot.deadline
                    || live.verifierContextHash != snapshot.verifierContextHash
            ) commitmentRewritten = true;

            ResurvCovenantManager.ActionSpec[] memory actions = manager.getActions(covenantId);
            bytes32 digest = keccak256(
                abi.encode(
                    actions[0].adapter,
                    actions[0].configHash,
                    actions[1].adapter,
                    actions[1].configHash
                )
            );
            if (digest != snapshot.actionsDigest) commitmentRewritten = true;
        }
    }

    /// @notice The escrow the manager should be holding, derived from the handler's own book
    ///         rather than from the contract's accounting.
    function expectedTotalEscrow() external view returns (uint256 total) {
        for (uint256 i = 0; i < covenantIds.length; ++i) {
            total += expectedEscrow[covenantIds[i]];
        }
    }

    function maxPayouts() external view returns (uint256 worst) {
        for (uint256 i = 0; i < covenantIds.length; ++i) {
            uint256 settled = payouts[covenantIds[i]] + refunds[covenantIds[i]];
            if (settled > worst) worst = settled;
        }
    }
}

contract CovenantInvariantTest is Test {
    ResurvCovenantManager internal manager;
    TestUSD internal token;
    DemoVault internal vault;
    VaultSafeStateVerifier internal verifier;
    PauseAction internal pauseAction;
    EvacuateERC20Action internal evacuateAction;
    CovenantHandler internal handler;

    address internal admin = makeAddr("admin");
    address internal executor = makeAddr("executor");
    address internal requester = makeAddr("requester");
    address internal responder = makeAddr("responder");
    address internal safeRecipient = makeAddr("safe");

    function setUp() public {
        token = new TestUSD();
        address[] memory feeTokens = new address[](1);
        feeTokens[0] = address(token);

        // Admin holds the pauser role too, so the handler can fire every admin surface it has.
        manager = new ResurvCovenantManager(admin, admin, executor, feeTokens);
        pauseAction = new PauseAction(address(manager));
        evacuateAction = new EvacuateERC20Action(address(manager));
        verifier = new VaultSafeStateVerifier();
        vault = new DemoVault(admin);

        bytes32 pauserRole = vault.PAUSER_ROLE();
        bytes32 rescuerRole = vault.RESCUER_ROLE();
        vm.startPrank(admin);
        vault.grantRole(pauserRole, address(pauseAction));
        vault.grantRole(rescuerRole, address(evacuateAction));
        vm.stopPrank();

        token.mint(address(vault), 1_000_000);

        handler = new CovenantHandler(
            manager,
            token,
            vault,
            verifier,
            pauseAction,
            evacuateAction,
            admin,
            executor,
            requester,
            responder,
            safeRecipient
        );

        // Two covenants already armed and triggered, so a run does not have to spend its first
        // calls reaching a state where anything can happen. The fuzzer still creates, arms and
        // triggers its own, and still attempts against covenants in every other state.
        handler.bootstrap();

        bytes4[] memory selectors = new bytes4[](9);
        selectors[0] = CovenantHandler.createAndFund.selector;
        selectors[1] = CovenantHandler.triggerCovenant.selector;
        selectors[2] = CovenantHandler.attempt.selector;
        selectors[3] = CovenantHandler.expire.selector;
        selectors[4] = CovenantHandler.cancel.selector;
        selectors[5] = CovenantHandler.refillVault.selector;
        selectors[6] = CovenantHandler.pauseVaultOutOfBand.selector;
        selectors[7] = CovenantHandler.skipAhead.selector;
        selectors[8] = CovenantHandler.adminPokes.selector;

        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @notice PRD 10.14.2. The escrow can leave a covenant once, by payment or by refund,
    ///         never both and never twice.
    function invariant_feeMovesAtMostOncePerCovenant() public view {
        assertFalse(handler.paidTwice(), "a covenant settled more than once");
        assertLe(handler.maxPayouts(), 1, "a covenant settled more than once");
    }

    /// @notice PRD 10.14.1. Every successful attempt left the declared outcome true.
    function invariant_satisfiedRequiresATrueVerifier() public view {
        assertFalse(
            handler.attemptSucceededWithFalseOutcome(),
            "an attempt succeeded while the outcome was false"
        );
    }

    /// @notice CLAUDE.md: no action runs after a terminal state.
    function invariant_terminalBlocksAttempts() public view {
        assertFalse(
            handler.attemptSucceededAfterTerminal(), "an attempt ran after a terminal state"
        );
    }

    /// @notice A recovery action runs only in response to a trigger. An armed covenant holds
    ///         escrow and a committed plan, and no incident has happened yet.
    function invariant_noAttemptWithoutATrigger() public view {
        assertFalse(
            handler.attemptSucceededWithoutATrigger(), "an attempt ran on an untriggered covenant"
        );
    }

    /// @notice PRD 10.14.10.
    function invariant_attemptLimitsHold() public view {
        assertFalse(handler.attemptExceededLimits(), "an attempt ran past the covenant limit");
    }

    /// @notice PRD 10.14.6.
    function invariant_triggerNonceNeverReplays() public view {
        assertFalse(handler.nonceReplayed(), "a trigger nonce was accepted twice");
    }

    /// @notice PRD 10.14.11.
    function invariant_adminCannotRewriteAnArmedCovenant() public view {
        assertFalse(handler.commitmentRewritten(), "an armed covenant's commitments changed");
    }

    /// @notice PRD 10.14 escrow conservation, in both directions: the contract must hold at
    ///         least what it owes, and what it says it owes must equal what the handler paid in
    ///         and has not seen come out.
    function invariant_escrowConservation() public view {
        uint256 held = token.balanceOf(address(manager));
        uint256 owed = manager.escrowed(address(token));
        assertGe(held, owed, "manager holds less than it owes");
        assertEq(owed, handler.expectedTotalEscrow(), "escrow accounting diverged from the ledger");
        assertEq(held, owed, "manager holds value it does not owe");
    }

    /// @dev Foundry calls `setUp` before each of the 256 runs and `afterInvariant` once, at the
    ///      end, so these figures describe the **last run only** — roughly one four-hundredth of
    ///      the campaign. An audit found the previous framing of this block read as campaign-wide
    ///      coverage and was off by two orders of magnitude. The per-selector table Foundry
    ///      prints alongside is the campaign total; this is a depth check on one episode, which
    ///      is what it is useful for: it shows whether a single run can reach a covenant that is
    ///      created, armed, triggered, attempted and settled, or whether the handler is spending
    ///      its depth bouncing off status checks.
    function afterInvariant() public view {
        console.log("--- last run only, not the 256-run campaign ---");
        console.log("covenants created       ", handler.created());
        console.log("covenants armed         ", handler.armedCount());
        console.log("triggers accepted       ", handler.triggered());
        console.log("attempts made           ", handler.attemptsMade());
        console.log("attempts succeeded      ", handler.attemptsSucceeded());
        console.log("attempts rejected       ", handler.attemptsRejected());
        console.log("attempts from terminal  ", handler.terminalAttempts());
        console.log("expiries                ", handler.expiries());
        console.log("cancellations           ", handler.cancellations());
    }
}
