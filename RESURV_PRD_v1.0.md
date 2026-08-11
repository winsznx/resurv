# RESURV Product Requirements Document

**Product:** RESURV  
**Working domain:** resurv.xyz  
**Version:** 1.0  
**Status:** Product and mechanism locked for implementation  
**Owner:** Tim  
**Research and specification date:** 4 August 2026  
**Primary build environment:** Claude Code  
**Hackathon:** KeeperHub Agents Onchain, build window 27 July to 13 August 2026

---

## 0. Document contract

This document is the source of truth for building RESURV. It is not a pitch deck and it is not a loose idea document. Every implementation phase must satisfy its exit gate before the next phase begins.

### 0.1 Source hierarchy

When sources disagree, use this order:

1. Observed target-chain behavior from reproducible tests.
2. Observed KeeperHub production or testnet behavior from reproducible seam tests.
3. KeeperHub official documentation current at the time of the test.
4. Verified contract source and official protocol documentation.
5. This PRD.
6. Assumptions, comments, generated explanations, and model output.

### 0.2 Claim labels

Every public claim and internal design assumption must be marked as one of:

- **VERIFIED:** reproduced against a real API, contract, or chain.
- **DOCUMENTED:** stated by an official source but not yet reproduced by the team.
- **ASSUMED:** required for the design but not yet verified.
- **EXPERIMENTAL:** implemented and tested only in a limited environment.
- **OUT OF SCOPE:** intentionally excluded from version 1.

`docs/CLAIMS.md` must remain current throughout the build. Claude Code must not convert DOCUMENTED or ASSUMED claims into VERIFIED claims without linked evidence.

### 0.3 Non-negotiable wording rules

RESURV must never claim:

- That a completed blockchain transaction can be rolled back by a later workflow step.
- That x402 or MPP settlement is atomically coupled to the recovery transaction unless a seam test proves the exact coupling.
- That KeeperHub is trustless.
- That idempotency alone gives permanent exactly-once economic execution.
- That private routing was used unless runtime chain configuration or execution evidence confirms it.
- That the product is production-ready before the production gate in this PRD is passed.

---

## 1. Executive summary

### 1.1 One-line product

**RESURV keeps executing pre-authorized recovery actions through KeeperHub until a declared onchain safe state becomes true, then pays the responder.**

### 1.2 Product category

Outcome-gated execution infrastructure for onchain agents.

### 1.3 Core problem

Most onchain automation treats transaction submission or confirmation as success. Protocol operators do not actually need a transaction. They need a resulting state:

- The vault is empty and the approved Safe received the funds.
- The protocol is paused.
- A dangerous approval is revoked.
- Exposure is below a limit.
- A health factor is above a minimum.
- A specific recipient received at least the critical amount.

A transaction can confirm while the desired outcome remains false. A primary emergency action can also fail because a role was revoked, state changed after simulation, gas conditions changed, or the target contract no longer matches assumptions.

### 1.4 Core mechanism

A requester creates and funds an immutable outcome covenant containing:

- A deterministic outcome verifier.
- A small ordered set of approved recovery actions.
- Exact target, selector, value, recipient, and retry limits.
- A signed trigger authority.
- A deadline.
- A success fee.

The RESURV response agent examines the current state and tries eligible actions through KeeperHub. Each successful attempt is a single EVM transaction that:

1. Executes one approved action or atomic adapter.
2. Evaluates the immutable outcome verifier.
3. Reverts the entire attempt if the outcome remains false.
4. Marks the covenant satisfied and releases the success fee if the outcome is true.

The action, outcome check, state transition, and success payment therefore succeed or revert together inside one target-chain transaction.

### 1.5 Why KeeperHub is load-bearing

KeeperHub is the execution and reliability layer used for:

- Pre-broadcast simulation.
- Reliable transaction submission.
- Gas management and retry handling.
- Chain-level private mempool routing where currently enabled.
- Organization wallet signing through Turnkey.
- Idempotent transport retries.
- Authoritative execution status and transaction links.
- Execution logs and analytics.
- Agent-native MCP and Claude Code integration.
- Optional marketplace discovery and x402 or MPP service payments.

Removing KeeperHub does not make RESURV logically impossible, but it removes the sponsor-specific last-mile guarantees the product is built to demonstrate. The team would have to rebuild simulation, wallet handling, nonce management, retries, chain routing, execution status, and audit integration.

### 1.6 Initial user

A small or mid-sized DeFi protocol security or operations lead who already has monitoring but does not have a 24-hour response team.

### 1.7 Initial use case

Emergency vault recovery on Base:

- Primary action: pause the vault.
- Fallback action: evacuate USDC to an approved Safe.
- Outcome: `vaultUSDC == 0 AND safeUSDCIncrease >= minimumRequired` OR `vaultPaused == true`.
- Primary action is made invalid before the demo.
- KeeperHub simulation refuses the primary action.
- RESURV executes the fallback.
- The same successful transaction verifies the outcome and releases the responder fee.
- A duplicate trigger produces no second action and no second payment.

### 1.8 Headline proof

> The primary emergency action was invalid. RESURV selected an approved fallback, executed it through KeeperHub, made the committed safe state true, paid the responder in the same transaction, and rejected a duplicate trigger without moving funds or paying twice.

---

## 2. Research basis and verified constraints

The following facts were checked against official sources on 4 August 2026. They remain subject to live seam testing because platform behavior can change.

### 2.1 KeeperHub facts used by the design

- The Direct Execution API supports simulation, contract calls, check-and-execute, idempotency keys, status polling, transaction hashes, and transaction links.
- KeeperHub recommends using the same request body for simulation and broadcast, removing only the `simulate` flag and adding an idempotency key.
- Direct execution is limited to 60 requests per minute per API key.
- Idempotency records are replayable for 24 hours. Reusing a key with a different request body returns a conflict.
- Simulation creates no execution audit row and no transaction hash.
- Simulation uses the organization EOA as `from`, not a configured Safe, which matters for `msg.sender`-dependent behavior.
- Workflow executions expose an ordered list of transaction hashes and detailed step logs.
- Blockchain writes completed before a later workflow failure cannot be rolled back.
- Marketplace callers are charged only when the listed workflow succeeds. Failed workflow calls return an error and are not charged.
- Marketplace workflows receive 70% of successful call revenue and can be called through typed per-workflow MCP endpoints.
- KeeperHub organization API keys use the `kh_` prefix. Webhook trigger keys use `wfb_` and are not interchangeable.
- The live chain list comes from `GET /api/chains`. It includes `usePrivateMempoolRpc`, which states whether KeeperHub routes that chain through a private mempool by default.
- Gas sponsorship requires a public mempool and cannot be combined with private mempool routing.
- The first-party agentic payment wallet has strict USDC-only contract allowlists and transfer caps. It is suitable for small x402 or MPP payments, not for general protocol execution.
- Base Sepolia and Base are currently listed as stable KeeperHub chains. The Base Sepolia USDC address in the current quickstart is `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
- The Analytics API offers a Server-Sent Events stream that emits updates when analytics change.

### 2.2 Claude Code practices used by the build system

- Keep the root `CLAUDE.md` concise and specific. Large instruction files reduce adherence.
- Put reusable procedures in project skills rather than continuously growing `CLAUDE.md`.
- Use project-scoped settings, rules, hooks, and subagents in `.claude/` and commit them to git.
- Use plan mode before large changes.
- Use read-only or worktree-isolated subagents for independent review.
- Use deny-first permissions and hooks for commands that must never run.
- Do not use `--dangerously-skip-permissions` for this repository.
- Keep separate named sessions or worktrees for independent workstreams so context and edits do not collide.

### 2.3 Version policy

This PRD does not invent future package versions. At repository creation:

1. Resolve the current stable release of every dependency from its official registry.
2. Pin exact versions in the lockfile.
3. Record the resolved versions in `docs/VERSIONS.md` with date, source, and compatibility notes.
4. Do not use floating `latest` tags in CI or production images.
5. Dependency updates require a dedicated pull request and the full regression gate.

---

## 3. Product thesis

### 3.1 Transaction success is not outcome success

The system must distinguish:

- **Intent:** what the requester wants.
- **Attempt:** an approved action submitted to produce the outcome.
- **Transaction result:** whether the action transaction confirmed.
- **Outcome result:** whether the committed state predicate is true.
- **Economic completion:** whether the responder was paid.

Only the last three occurring under the covenant rules make a run successful.

### 3.2 Outcome is the unit of completion

RESURV does not pay for reasoning, simulation, or broadcast. It pays when a verifier observes the promised state.

### 3.3 Recovery actions are capabilities, not arbitrary calldata

The agent never receives permission to construct arbitrary calls. It can select only from action adapters committed before the covenant is armed.

### 3.4 Every successful attempt is atomic

Version 1 supports only same-chain outcomes that can be synchronously observed after an action inside the same EVM transaction.

If the action returns but the verifier remains false, the transaction reverts. The action state changes, covenant state changes, and fee transfer all revert together.

This guarantee does not apply to:

- Cross-chain delivery.
- Asynchronous withdrawals.
- Delayed protocol settlement.
- Offchain services.
- Multi-transaction KeeperHub workflows.

Those are explicitly out of scope for version 1.

### 3.5 AI is bounded by deterministic enforcement

The model may classify, rank, and explain approved actions. The contract and deterministic controller decide what is executable.

If the model is unavailable, malformed, or uncertain, RESURV uses the deterministic fallback order or escalates. Safety does not depend on model availability.

---

## 4. Goals, success criteria, and non-goals

### 4.1 Version 1 goals

1. Create an immutable outcome covenant on Base Sepolia.
2. Fund a real success fee in test USDC or a controlled test token.
3. Accept a replay-protected signed risk trigger.
4. Simulate every candidate action through KeeperHub before broadcast.
5. Execute at least one real fallback action through KeeperHub.
6. Verify the safe state inside the same successful transaction.
7. Release the success fee inside that transaction.
8. Reject duplicate triggers and duplicate success payment.
9. Produce an independently checkable receipt with chain links and KeeperHub execution evidence.
10. Provide a reusable KeeperHub onboarding artifact from the seam-test work.

### 4.2 Hackathon success criteria

- Real KeeperHub-executed transaction linked in the submission.
- Real contract state change on Base Sepolia or Base.
- Visible failed primary path and successful fallback path.
- Independent proof page requiring no private credentials.
- Reliability behavior demonstrated, including replay and stale-state handling.
- Clear use of KeeperHub, not a thin wrapper.
- Structured feedback, test fixture, starter template, or documentation improvement eligible for the onboarding bounty.

### 4.3 Production success criteria

The system is not production-ready until all of the following are true:

- Core contracts pass independent security review.
- Invariant and fork tests cover every terminal state.
- RPC failover and reconciliation are proven under fault injection.
- KeeperHub seam behavior is captured by automated tests.
- Secrets, API keys, and deployment permissions are production hardened.
- Contracts are verified on the target explorer.
- Monitoring, paging, backups, and incident runbooks are active.
- A canary covenant with capped value has completed successfully.
- A rollback plan exists for application services. Contracts use versioned replacement rather than proxy rollback.

### 4.4 Non-goals for version 1

- General wallet policy firewall.
- Generic liquidation guardian.
- Arbitrary free-form contract calls.
- Cross-chain outcome guarantees.
- Full insurance underwriting.
- Reverse auction or responder marketplace.
- Open public custody of large protocol treasuries.
- Upgradeable proxy contracts.
- DAO governance automation.
- Agent performance competitions.
- ZK outcome proofs.
- Automatic compensation for irreversible external transactions.

---

## 5. Users and jobs to be done

### 5.1 Protocol security or operations lead

**Job:** Define what “safe” means before an incident and know that approved actions will continue until that state is reached.

**Needs:**

- Narrow authority.
- Clear outcome definition.
- No arbitrary agent calldata.
- Fast proof of what happened.
- Safe failure and duplicate protection.
- A way to revoke or replace future covenants.

### 5.2 Response agent operator

**Job:** Run a responder that gets paid only when it produces the promised state.

**Needs:**

- Discoverable action plan.
- Deterministic eligibility rules.
- Reliable execution.
- Clear failure reasons.
- Verifiable performance history.

### 5.3 Auditor or incident reviewer

**Job:** Reconstruct whether the trigger was valid, which actions were tried, what changed onchain, and why payment occurred.

**Needs:**

- Immutable contract events.
- Ordered KeeperHub execution identifiers and transaction hashes.
- Verifier source and state reads.
- A signed, canonical receipt.
- Explicit limitations.

### 5.4 Hackathon judge

**Job:** Verify the central claim in under two minutes.

**Needs:**

- A completed covenant.
- Failed primary simulation evidence.
- Successful fallback transaction.
- Outcome verifier result.
- Fee release in the same transaction.
- Duplicate trigger rejection.

---

## 6. Product vocabulary

- **Covenant:** Immutable agreement defining the desired state, approved actions, trigger authority, deadline, and success fee.
- **Safe state:** The state predicate returned by the outcome verifier.
- **Outcome verifier:** A deterministic view contract that returns whether the covenant is satisfied and a state hash.
- **Action adapter:** A contract that performs one bounded recovery operation or an atomic group of operations.
- **Recovery plan:** Ordered list of action adapters and immutable configurations.
- **Trigger signal:** Replay-protected signed message that activates a covenant.
- **Attempt:** One KeeperHub-submitted call to execute a committed action.
- **Transport retry:** Repeating the exact same HTTP request with the same KeeperHub idempotency key.
- **Semantic attempt:** A new economic action identified by covenant, action, state hash, and attempt sequence.
- **Outcome receipt:** Canonical record linking the covenant, trigger, simulation evidence, attempts, final state, payment, and verification result.

---

## 7. Version 1 scope

### 7.1 Supported

- EVM single-chain execution.
- Base Sepolia first, then capped Base mainnet canary.
- One immutable verifier per covenant.
- Two to five approved actions.
- Same-chain synchronous actions.
- ERC-20 success fee, initially Base USDC or test equivalent.
- One responder beneficiary.
- One trigger authority per covenant.
- Deterministic fallback order with optional bounded model ranking.
- KeeperHub organization wallet as the transaction sender.
- Human UI and programmatic API.
- Public read-only proof page.

### 7.2 Unsupported

- Solana.
- Experimental KeeperHub chains.
- Safe-routed simulation until sender semantics are separately proven.
- Cross-chain messages as the successful action.
- Async protocols where final state cannot be checked in the same transaction.
- Arbitrary user-provided adapters.
- Fee-on-transfer or rebasing fee tokens.
- Unverified contracts or ABIs in production.

---

## 8. End-to-end user flows

### 8.1 Create covenant

1. Requester connects a wallet and signs in.
2. Requester selects a chain from the live KeeperHub chain list.
3. Requester selects a supported verifier template.
4. Requester configures the safe-state inputs.
5. Requester selects two to five audited action adapters.
6. Requester configures immutable adapter parameters.
7. UI shows the exact targets, selectors, recipients, values, and limits.
8. Requester selects trigger authority, deadline, responder beneficiary, and fee.
9. Backend runs static validation and independent read simulations.
10. Requester signs and submits the covenant creation transaction.
11. Requester funds the fee escrow.
12. Covenant enters `ARMED` only after funding and validation.

### 8.2 Trigger covenant

1. Monitoring system detects a risk condition.
2. Signal authority signs a typed trigger message.
3. Any relayer submits the signed signal to RESURV.
4. Contract verifies signer, covenant, nonce, validity window, and current status.
5. Covenant moves from `ARMED` to `TRIGGERED`.
6. Contract emits `CovenantTriggered`.
7. Backend indexer creates an orchestration job using the onchain event as the source of truth.

### 8.3 Execute recovery loop

1. Worker obtains a distributed lock for the covenant.
2. Worker reconciles database state with chain state.
3. Worker calls the verifier before taking action.
4. If already satisfied, it does not execute an action. It calls a dedicated finalize path only if the contract design permits fee release without an action.
5. Worker asks the bounded planner for an eligible action or uses deterministic order.
6. Deterministic policy validates the selected action.
7. Worker creates the exact KeeperHub contract-call body.
8. Worker sends the same body with `simulate: true`.
9. If simulation reverts, worker records the result and advances to the next eligible action.
10. If simulation passes, worker removes `simulate`, creates a semantic attempt ID and a transport idempotency key, and submits once.
11. Worker saves the KeeperHub `executionId` before any further action.
12. Worker retrieves authoritative status and transaction link.
13. Worker waits for configured confirmations through an independent RPC.
14. If completed, the contract is expected to be terminal because `executeAttempt` either reverted or atomically satisfied and paid.
15. Worker reconciles covenant state and produces the receipt.
16. If all actions are exhausted, worker marks the run escalated offchain and waits for expiry or manual intervention. It cannot invent another action.

### 8.4 Successful completion

A successful `executeAttempt` transaction:

1. Validates covenant status and deadline.
2. Validates caller authorization.
3. Validates action index and remaining attempts.
4. Executes the approved adapter.
5. Evaluates the verifier.
6. Reverts if false.
7. Marks covenant `SATISFIED` if true.
8. Records final state hash and observed value.
9. Releases the success fee.
10. Emits the terminal events.

### 8.5 Duplicate trigger

1. The same signed trigger is submitted again.
2. Contract rejects the used nonce or non-ARMED status.
3. No new orchestration job is accepted as executable.
4. No action runs.
5. No fee moves.
6. Proof page displays the rejected duplicate.

### 8.6 Expiry

1. Deadline passes while outcome remains false.
2. Anyone may call `expireCovenant`.
3. Contract rechecks the verifier.
4. If verifier is true, expiry is rejected and finalization must occur.
5. If verifier is false, covenant moves to `EXPIRED`.
6. Success fee is refunded to the requester.
7. Further actions are rejected.

### 8.7 Cancellation

- Requester may cancel only before trigger.
- Cancellation refunds the success fee.
- Triggered covenants cannot be cancelled by the requester.
- A global emergency pause may block execution while still allowing safe refunds for cancelled or expired covenants.

---

## 9. State machines

### 9.1 Onchain covenant state

```text
DRAFT -> ARMED -> TRIGGERED -> EXECUTING -> SATISFIED
   |       |          |            |            
   |       |          |            -> EXPIRED
   |       |          -> EXPIRED
   |       -> CANCELLED
   -> CANCELLED
```

Recommended enum:

```solidity
enum CovenantStatus {
    NONE,
    DRAFT,
    ARMED,
    TRIGGERED,
    EXECUTING,
    SATISFIED,
    EXPIRED,
    CANCELLED
}
```

`EXECUTING` may be represented as an emitted attempt state rather than a persistent status if atomic attempt calls do not need a separate stored state. Prefer fewer stored states when they do not create a security property.

### 9.2 Offchain orchestration state

```text
PENDING
RECONCILING
PLANNING
SIMULATING
SIMULATION_REJECTED
SUBMITTING
AWAITING_KEEPERHUB
AWAITING_CONFIRMATIONS
SATISFIED
EXHAUSTED
EXPIRED
ESCALATED
FAILED_INTERNAL
```

Offchain status never overrides onchain terminal status.

---

## 10. Smart contract specification

### 10.1 Contract set

```text
contracts/
  src/
    ResurvCovenantManager.sol
    ResurvActionRegistry.sol
    interfaces/
      IOutcomeVerifier.sol
      IResurvAction.sol
    actions/
      PauseAction.sol
      EvacuateERC20Action.sol
    verifiers/
      VaultSafeStateVerifier.sol
    demo/
      DemoVault.sol
      MockUSDC.sol
```

### 10.2 Design choice: immutable versioned contracts

Version 1 uses no upgradeable proxy.

Reasons:

- The contract controls escrowed payment and emergency authority.
- Upgradeability adds admin-key and storage-layout risk.
- A hackathon demo benefits from inspectable immutable behavior.
- New versions can be deployed through a version registry while existing covenants retain their original code.

The deployment manifest must include bytecode hashes, constructor arguments, compiler settings, and verified source links.

### 10.3 `IOutcomeVerifier`

```solidity
interface IOutcomeVerifier {
    function evaluate(bytes32 covenantId, bytes calldata context)
        external
        view
        returns (
            bool satisfied,
            bytes32 stateHash,
            uint256 observedValue
        );
}
```

Requirements:

- Must be `view`.
- Must be deterministic for the same chain state and context.
- Must not rely on mutable offchain claims.
- Must return a state hash containing every material state element.
- Must define rounding and threshold semantics.
- Must fail closed. A revert means not verifiable and the attempt reverts.

### 10.4 `IResurvAction`

```solidity
interface IResurvAction {
    function execute(bytes32 covenantId, bytes calldata config)
        external
        payable
        returns (bytes32 actionResultHash);
}
```

Requirements:

- Adapter address is committed before arming.
- Adapter configuration hash is committed before arming.
- Adapter must validate targets and recipients.
- Adapter cannot use unbounded arbitrary external calls.
- Adapter must revert on partial failure.
- Adapter must expose a human-readable schema in the repository.

### 10.5 Covenant data model

```solidity
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
    CovenantStatus status;
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
```

The full verifier context and adapter configurations may be emitted and stored in calldata or a content-addressed manifest. The contract must validate their hashes during execution.

### 10.6 Trigger message

Use EIP-712 typed data:

```text
TriggerSignal(
  bytes32 covenantId,
  bytes32 signalHash,
  uint32 nonce,
  uint64 validAfter,
  uint64 validUntil
)
```

Rules:

- Signer must equal the covenant trigger authority.
- Covenant must be `ARMED`.
- Nonce must equal the expected nonce.
- Current time must be within the validity window.
- `signalHash` must be emitted for receipt linkage.
- Used messages cannot be replayed.

### 10.7 Atomic `executeAttempt`

Illustrative logic:

```solidity
function executeAttempt(
    bytes32 covenantId,
    uint256 actionIndex,
    bytes calldata actionConfig,
    bytes calldata verifierContext,
    bytes32 expectedStateHash,
    uint64 attemptSequence
) external nonReentrant onlyExecutor returns (bytes32 finalStateHash) {
    Covenant storage c = covenants[covenantId];

    if (c.status != CovenantStatus.TRIGGERED && c.status != CovenantStatus.EXECUTING) {
        revert InvalidStatus();
    }
    if (block.timestamp > c.deadline) revert CovenantExpired();
    if (keccak256(verifierContext) != c.verifierContextHash) revert InvalidVerifierContext();

    ActionSpec storage a = actions[covenantId][actionIndex];
    if (!a.enabled || a.attemptsUsed >= a.maxAttempts) revert ActionUnavailable();
    if (keccak256(actionConfig) != a.configHash) revert InvalidActionConfig();

    bytes32 preStateHash = _readStateHash(c.verifier, covenantId, verifierContext);
    if (expectedStateHash != bytes32(0) && preStateHash != expectedStateHash) {
        revert StaleState();
    }

    bytes32 attemptId = keccak256(
        abi.encode(covenantId, actionIndex, preStateHash, attemptSequence)
    );
    if (usedAttemptIds[attemptId]) revert AttemptAlreadyUsed();

    usedAttemptIds[attemptId] = true;
    a.attemptsUsed += 1;
    c.status = CovenantStatus.EXECUTING;

    bytes32 actionResultHash = IResurvAction(a.adapter).execute(
        covenantId,
        actionConfig
    );

    (bool satisfied, bytes32 stateHash, uint256 observedValue) =
        IOutcomeVerifier(c.verifier).evaluate(covenantId, verifierContext);

    if (!satisfied) revert OutcomeNotSatisfied(stateHash, observedValue);

    c.status = CovenantStatus.SATISFIED;
    c.finalStateHash = stateHash;
    c.finalObservedValue = observedValue;

    IERC20(c.feeToken).safeTransfer(c.responder, c.feeAmount);

    emit AttemptSucceeded(covenantId, attemptId, actionIndex, actionResultHash);
    emit CovenantSatisfied(covenantId, stateHash, observedValue, c.responder, c.feeAmount);

    return stateHash;
}
```

Because a false verifier result reverts the call, `usedAttemptIds`, attempt counters, adapter state changes, covenant state, and fee transfer all revert together.

The backend still records failed simulations and failed broadcast transactions. Those failures are not represented as successful onchain events.

### 10.8 Already-satisfied path

A covenant may already be safe when triggered. Provide `finalizeAlreadySatisfied`:

- Callable by the authorized executor or permissionlessly, depending on final threat review.
- Requires status `TRIGGERED`.
- Evaluates the verifier.
- Requires `satisfied == true`.
- Marks `SATISFIED` and transfers the fee.
- Emits a distinct event showing that no recovery action was needed.

Product decision before mainnet: whether an executor should receive the full fee for detecting an already-safe state. Version 1 default is a lower fixed verification fee or zero. The demo does not use this path.

### 10.9 Fee handling

- Use OpenZeppelin `SafeERC20`.
- Allow only audited fee tokens through an immutable or governance-controlled allowlist.
- Version 1 supports Base USDC and a test token.
- No fee-on-transfer, rebasing, callback, or ERC-777-like fee tokens.
- Transfer fee only after state is set to terminal.
- Protect fee-moving functions with `nonReentrant`.
- Refund on cancellation or expiry.
- No partial payout in version 1.

### 10.10 Access control

Roles:

- `DEFAULT_ADMIN_ROLE`: deployment multisig for global configuration only.
- `EXECUTOR_ROLE`: KeeperHub organization wallet allowed to call `executeAttempt`.
- `PAUSER_ROLE`: emergency multisig allowed to pause new triggers and attempts.
- Requester rights are covenant-specific and limited to pre-trigger cancellation.

The admin must not be able to:

- Change an armed covenant’s verifier.
- Change its recovery plan.
- Change its fee recipient.
- Seize escrow.
- Mark it satisfied without verifier success.

### 10.11 Pausing

Global pause may stop:

- New covenant creation.
- New triggers.
- New attempts.

Global pause must not stop:

- Refunds for cancelled covenants.
- Refunds for expired covenants.
- Read-only verification.

### 10.12 Events

Required events:

```solidity
event CovenantCreated(bytes32 indexed covenantId, address indexed requester, address verifier);
event CovenantFunded(bytes32 indexed covenantId, address feeToken, uint256 feeAmount);
event CovenantArmed(bytes32 indexed covenantId);
event CovenantTriggered(bytes32 indexed covenantId, bytes32 indexed signalHash, uint32 nonce);
event AttemptSucceeded(bytes32 indexed covenantId, bytes32 indexed attemptId, uint256 actionIndex, bytes32 actionResultHash);
event CovenantSatisfied(bytes32 indexed covenantId, bytes32 stateHash, uint256 observedValue, address responder, uint256 feeAmount);
event CovenantExpired(bytes32 indexed covenantId, address refundRecipient, uint256 refundedAmount);
event CovenantCancelled(bytes32 indexed covenantId, address refundRecipient, uint256 refundedAmount);
event GlobalPauseChanged(bool paused, address indexed caller);
```

### 10.13 Custom errors

Use custom errors rather than string reverts for gas efficiency and typed decoding:

```text
InvalidStatus
CovenantExpired
InvalidSignature
InvalidNonce
SignalNotYetValid
SignalExpired
InvalidVerifierContext
InvalidActionConfig
ActionUnavailable
AttemptAlreadyUsed
StaleState
OutcomeNotSatisfied
UnauthorizedExecutor
FeeTransferFailed
AlreadyTerminal
```

### 10.14 Core invariants

1. `SATISFIED` implies the verifier returned true in the same successful transaction.
2. Success fee can transfer at most once.
3. No recovery action can execute after a terminal state.
4. No uncommitted adapter or configuration can execute.
5. A false postcondition reverts all state changes made by that attempt.
6. Trigger nonce cannot be reused.
7. Cancellation is impossible after trigger.
8. Expiry refund is impossible when the verifier is true.
9. Only the authorized execution path can call action adapters.
10. Total attempts cannot exceed covenant limits.
11. Admin cannot rewrite an armed covenant.
12. Every successful payment has a matching `CovenantSatisfied` event.

---

## 11. Demo contracts

### 11.1 `DemoVault`

Purpose: make the failure and recovery contrast unambiguous.

State:

- Holds test USDC.
- Has `PAUSER_ROLE` and `RESCUER_ROLE`.
- `pause()` sets `paused = true`.
- `evacuateToSafe(token, safe, amount)` sends assets to the approved Safe.

Demo setup:

1. Fund vault with 1 test USDC.
2. Grant both roles to the RESURV action adapter or executor.
3. Revoke `PAUSER_ROLE` before trigger.
4. Leave `RESCUER_ROLE` active.

### 11.2 `PauseAction`

- Calls `DemoVault.pause()`.
- No dynamic target.
- Config commits the vault address.
- Simulation must revert after the role is revoked.

### 11.3 `EvacuateERC20Action`

- Calls the vault evacuation function.
- Config commits vault, token, safe, and exact or bounded amount.
- Recipient cannot be changed by the model or API caller.

### 11.4 `VaultSafeStateVerifier`

Safe when either:

```text
vault.paused == true
OR
(
  vault.tokenBalance == 0
  AND safe.tokenBalance >= safeBaseline + minimumReceived
)
```

The verifier returns a state hash over:

```text
chainId
vault
safe
feeToken
paused
vaultBalance
safeBalance
safeBaseline
minimumReceived
```

---

## 12. KeeperHub integration specification

### 12.1 Primary execution surface

Use the Direct Execution API for the core atomic call.

Reasons:

- The transaction must be one call to `executeAttempt`.
- Simulation and broadcast share one request body.
- The response gives an execution ID.
- Status gives the authoritative transaction hash and link.
- Transport idempotency is explicit.

Do not place the core attempt inside a multi-write workflow.

### 12.2 Authentication

- Store `KH_API_KEY` only in the backend or worker secret store.
- Use an organization-scoped `kh_` key for Direct Execution, MCP, workflow management, and analytics.
- Never expose `kh_` keys to the browser.
- Use a separate least-privilege key per environment.
- Rotate keys after a suspected leak.
- Record only the key identifier or prefix, never the key.
- Use `wfb_` only if a KeeperHub workflow webhook is used. It must not be substituted for `kh_`.

### 12.3 Chain discovery

At startup and every 10 minutes:

1. Call `GET /api/chains`.
2. Require `isEnabled == true`.
3. Require stable status in application configuration.
4. Record `usePrivateMempoolRpc`.
5. Compare chain ID, explorer URL, and testnet status with local configuration.
6. Refuse writes on an unexpected chain configuration change until reviewed.

### 12.4 Simulation sequence

For every semantic attempt:

1. Build canonical request JSON.
2. Save request hash.
3. Send with strict boolean `simulate: true`.
4. Require `success == true` and `wouldRevert == false`.
5. Save response and response hash.
6. Independently run `eth_call` from the expected organization wallet address when possible.
7. Compare result and revert reason.
8. If simulation fails, do not broadcast.

KeeperHub simulation creates no execution audit row. RESURV must therefore keep its own signed simulation record and label it as offchain evidence.

### 12.5 Broadcast sequence

1. Remove only `simulate` from the canonical body.
2. Generate semantic attempt ID.
3. Generate transport idempotency key from the semantic attempt ID and request hash.
4. Send `Idempotency-Key` and an `x-request-id` correlation value.
5. Save the response immediately.
6. Treat a `409 idempotency_in_progress` as a transport state, not a new attempt.
7. Treat a `409 idempotency_conflict` as a critical programming error.
8. Never retry with a new key until chain state and the original execution status have been reconciled.

### 12.6 Status handling

- Save `executionId`.
- Call `GET /api/execute/{executionId}/status`.
- Honor `X-Poll-Interval-Hint`.
- Terminal states are `completed` and `failed` for direct execution.
- Save `transactionHash`, `transactionLink`, `gasUsedWei`, result, error, timestamps, and request ID.
- Independently fetch the transaction receipt and contract events from a dedicated RPC.
- Do not mark RESURV satisfied from KeeperHub status alone. Read contract state.

### 12.7 Idempotency model

KeeperHub transport idempotency lasts 24 hours. RESURV economic idempotency is permanent onchain.

```text
semanticAttemptId = keccak256(
  covenantId,
  actionIndex,
  expectedStateHash,
  attemptSequence,
  requestBodyHash
)
```

- Same request interrupted in transport: same KeeperHub key.
- Different action: new semantic attempt and new key.
- Same action after material state change: new semantic attempt and new key.
- Same economic attempt after 24 hours: contract still rejects replay through attempt ID and covenant state.

### 12.8 Private routing

- Read `usePrivateMempoolRpc` from `GET /api/chains`.
- Store the value in every attempt record.
- Do not claim private routing if it is false or absent.
- Confirm the exact route with KeeperHub support or execution evidence before making a public MEV-protection claim.
- When private routing is active, pre-fund gas because gas sponsorship requires the public mempool.

### 12.9 Gas

- Let KeeperHub estimate gas unless a tested action requires an override.
- Use the conservative path for time-sensitive event or webhook-triggered operations when using workflows.
- Maintain native gas on the organization wallet.
- Alert before balance falls below the configured number of worst-case attempts.
- Store gas estimates and actual gas in the receipt.

### 12.10 Marketplace use

Marketplace is an extension after the core covenant works.

Version 1 marketplace listing may:

- Let another agent request a RESURV covenant template.
- Accept a small x402 or MPP initiation fee.
- Return the covenant creation schema and proof URL.
- Keep the core success fee in the RESURV escrow contract.

Do not depend on marketplace billing for the core success fee.

### 12.11 MCP and Claude Code

Development environment connection:

```bash
claude mcp add --transport http keeperhub https://app.keeperhub.com/mcp
```

For headless or CI use, configure a secret organization key. The project must also install or document the KeeperHub Claude Code plugin when useful for workflow inspection and execution debugging.

### 12.12 Analytics

Use KeeperHub analytics as supplemental observability:

- Poll execution and spend-cap endpoints.
- Subscribe to the analytics SSE stream for dashboard updates.
- Reconnect with backoff.
- Treat the RESURV database and chain events as the product record.
- Treat KeeperHub analytics as external execution telemetry.

---

## 13. Bounded response agent

### 13.1 Agent responsibilities

The agent may:

- Read covenant state.
- Read verifier state.
- Inspect signed trigger metadata.
- List eligible actions.
- Request simulation.
- Interpret simulation failure.
- Rank eligible actions.
- Submit an approved attempt through the controlled tool.
- Explain its decision.
- Escalate when no safe action remains.

The agent may not:

- Change covenant state directly.
- Create arbitrary calldata.
- Change targets or recipients.
- Change fee or deadline.
- Disable checks.
- Use a wallet outside the RESURV execution path.
- Mark an outcome satisfied.
- Retry with a new idempotency key without reconciliation.

### 13.2 Deterministic tools

```text
get_covenant(covenantId)
read_outcome(covenantId)
list_eligible_actions(covenantId)
simulate_action(covenantId, actionIndex, expectedStateHash)
execute_action(covenantId, actionIndex, expectedStateHash)
get_attempt_status(attemptId)
escalate(covenantId, reasonCode)
```

The `execute_action` tool is the only write-capable agent tool. It validates every field server-side and does not accept raw target, ABI, function name, or calldata from the model.

### 13.3 Decision schema

```json
{
  "covenantId": "0x...",
  "selectedActionIndex": 1,
  "reasonCode": "PRIMARY_SIMULATION_REVERTED",
  "reason": "pause() is unavailable because the committed executor lacks PAUSER_ROLE; evacuation remains eligible and directly satisfies the verifier",
  "confidence": 0.98,
  "requiresHuman": false
}
```

Validate through a strict schema. Reject unknown fields.

### 13.4 Fallback behavior

- If the model times out, use deterministic action order.
- If model output is invalid, use deterministic action order.
- If model selects an ineligible action, reject and record a policy violation.
- If model confidence is below the configured threshold and more than one materially different action is eligible, escalate or use deterministic priority according to covenant policy.
- No model call is required for the demo to complete.

### 13.5 Prompt injection defenses

- Never pass untrusted alert text directly as system instructions.
- Normalize alerts to a typed incident schema first.
- Place external text in quoted data fields.
- Do not expose secrets or API keys in model context.
- Tool descriptions must state that raw calldata is forbidden.
- The agent cannot invoke shell, arbitrary HTTP, or wallet signing tools in production mode.
- Log model, prompt version, tool calls, and decision output.

---

## 14. System architecture

### 14.1 Monorepo

```text
resurv/
  apps/
    web/                 # Next.js dashboard and public proof page
    api/                 # Typed HTTP API
    worker/              # Orchestration, reconciliation, KeeperHub execution
  packages/
    contracts/           # Foundry project
    domain/              # Pure reference model and state machine
    keeperhub-client/    # Typed API client and fixtures
    chain/               # viem clients, event decoding, RPC quorum
    agent/               # Bounded planner and tool schemas
    db/                  # schema, migrations, repositories
    observability/       # logs, traces, metrics
    sdk/                 # public TypeScript SDK
    config/              # environment validation
    ui/                  # shared components
  docs/
    PRD.md
    CLAIMS.md
    VERSIONS.md
    THREAT_MODEL.md
    RUNBOOKS.md
    DEPLOYMENTS.md
    PROOF_LADDER.md
  .claude/
    settings.json
    agents/
    rules/
    skills/
  CLAUDE.md
```

### 14.2 Recommended stack

Resolve and pin current stable versions at scaffold time.

- TypeScript with all strict compiler options.
- Node.js current active LTS.
- pnpm workspaces.
- Turborepo or equivalent task graph.
- Next.js for web.
- Fastify for API and internal webhook endpoints.
- Zod for runtime schemas and OpenAPI generation.
- PostgreSQL for durable product state.
- Drizzle ORM and SQL migrations.
- Redis plus BullMQ for distributed jobs and locks.
- viem for EVM reads, writes, event decoding, and typed ABIs.
- Foundry for contracts, unit tests, fuzz tests, invariant tests, fork tests, scripts, and verification.
- OpenZeppelin Contracts stable audited release for access control, EIP-712, SafeERC20, pausing, and reentrancy protection.
- OpenTelemetry for traces, metrics, and structured correlation.
- Docker Compose for local infrastructure.
- GitHub Actions for CI.
- Railway deployment profile for web, API, worker, Postgres, and Redis, while keeping deployment provider-neutral.

### 14.3 Source-of-truth boundaries

- Chain is source of truth for covenant status, action limits, verifier result, and payment.
- KeeperHub is source of truth for its execution IDs, status, logs, and transaction link.
- RESURV database is source of truth for orchestration history, model decisions, simulation evidence, and canonical receipts.
- UI is never a source of truth.

### 14.4 Service responsibilities

#### Web

- Authenticated operator interface.
- Covenant creation wizard.
- Live run view.
- Read-only proof page.
- Contract reads through dedicated RPC or API.
- No KeeperHub secret.

#### API

- Authentication and RBAC.
- Covenant drafts and validation.
- Read APIs.
- Trigger ingestion.
- Receipt retrieval.
- Admin and health endpoints.
- No long-running execution loop.

#### Worker

- Chain event consumption.
- Reconciliation.
- Agent planning.
- KeeperHub simulation and broadcast.
- Confirmation tracking.
- Receipt generation.
- Retry and escalation.

#### Database

- Durable orchestration state.
- Outbox and inbox deduplication.
- Attempt evidence.
- Receipt versions.
- Audit log.

---

## 15. Database model

### 15.1 Tables

#### `users`

- `id`
- `wallet_address`
- `created_at`
- `last_login_at`

#### `organizations`

- `id`
- `name`
- `slug`
- `created_at`

#### `organization_members`

- `organization_id`
- `user_id`
- `role` as `owner | operator | viewer`

#### `covenants`

- `id`
- `chain_id`
- `contract_address`
- `onchain_covenant_id`
- `requester_address`
- `trigger_authority`
- `responder_address`
- `verifier_address`
- `verifier_context`
- `verifier_context_hash`
- `fee_token`
- `fee_amount`
- `deadline`
- `onchain_status`
- `last_reconciled_block`
- `created_at`
- `updated_at`

Unique: `(chain_id, contract_address, onchain_covenant_id)`.

#### `action_specs`

- `covenant_id`
- `action_index`
- `adapter_address`
- `config_json`
- `config_hash`
- `max_attempts`
- `priority`
- `schema_version`

#### `trigger_signals`

- `id`
- `covenant_id`
- `signal_hash`
- `nonce`
- `valid_after`
- `valid_until`
- `signature`
- `submission_tx_hash`
- `status`

Unique: `(covenant_id, nonce)` and `signal_hash`.

#### `attempts`

- `id`
- `semantic_attempt_id`
- `covenant_id`
- `action_index`
- `attempt_sequence`
- `expected_state_hash`
- `request_body_hash`
- `status`
- `planner_decision_id`
- `created_at`
- `updated_at`

Unique: `semantic_attempt_id`.

#### `simulations`

- `attempt_id`
- `provider` as `keeperhub | rpc`
- `request_json`
- `request_hash`
- `response_json`
- `response_hash`
- `would_revert`
- `revert_reason`
- `created_at`

#### `keeperhub_executions`

- `attempt_id`
- `execution_id`
- `idempotency_key_hash`
- `request_id`
- `status`
- `transaction_hash`
- `transaction_link`
- `gas_used_wei`
- `error_code`
- `error_message`
- `private_mempool_expected`
- `created_at`
- `completed_at`

Unique: `execution_id` and `transaction_hash` when non-null.

#### `chain_observations`

- `covenant_id`
- `block_number`
- `block_hash`
- `status`
- `state_hash`
- `observed_value`
- `vault_balance`
- `safe_balance`
- `created_at`

#### `planner_decisions`

- `id`
- `covenant_id`
- `model_provider`
- `model_id`
- `prompt_version`
- `input_hash`
- `output_json`
- `valid`
- `fallback_used`
- `created_at`

#### `receipts`

- `id`
- `covenant_id`
- `version`
- `receipt_json`
- `receipt_hash`
- `signature`
- `verification_status`
- `created_at`

#### `outbox_events`

Transactional outbox for durable background work.

#### `audit_events`

Append-only internal audit log for auth, configuration, trigger ingestion, manual overrides, and secret rotation.

### 15.2 Database rules

- Use database transactions for state plus outbox write.
- Never mark an attempt successful before independent chain reconciliation.
- Use row-level locks or advisory locks for covenant orchestration.
- Keep raw external responses for debugging but redact secrets.
- Encrypt sensitive configuration at rest.
- Do not store private keys.

---

## 16. API specification

All endpoints use `/v1`.

### 16.1 Authentication

Human UI:

- Sign-In with Ethereum style challenge.
- One-time nonce.
- Domain and URI binding.
- Short-lived secure, HTTP-only session cookie.
- CSRF protection for state-changing browser requests.

Agent and service clients:

- RESURV API keys with random 32-byte secrets.
- Store only key hash and prefix.
- Scope keys by organization and permission.
- Rate limit by key and IP.

### 16.2 Endpoints

#### Covenant draft and creation

```text
POST /v1/covenants/validate
POST /v1/covenants
GET  /v1/covenants/:id
GET  /v1/covenants/:id/actions
POST /v1/covenants/:id/cancel
```

#### Trigger

```text
POST /v1/covenants/:id/triggers
GET  /v1/covenants/:id/triggers
```

The API validates the signed message, then submits or tracks the onchain trigger transaction according to the configured relayer mode.

#### Execution

```text
GET  /v1/covenants/:id/attempts
GET  /v1/attempts/:id
POST /v1/covenants/:id/reconcile
POST /v1/covenants/:id/escalate
```

Manual reconcile and escalation require operator role and create audit events.

#### Receipt and proof

```text
GET /v1/covenants/:id/receipt
GET /v1/receipts/:receiptId
GET /v1/receipts/:receiptId/verify
GET /v1/public/covenants/:chainId/:contract/:covenantId
```

#### Streaming

```text
GET /v1/covenants/:id/events
```

Server-Sent Events with typed events and reconnect cursor.

#### Health

```text
GET /health/live
GET /health/ready
GET /health/dependencies
```

Readiness requires database, Redis, target RPC, and KeeperHub status checks with bounded timeouts.

### 16.3 API error envelope

```json
{
  "error": {
    "code": "COVENANT_TERMINAL",
    "message": "The covenant is already satisfied",
    "requestId": "req_...",
    "details": {}
  }
}
```

Do not expose provider secrets, raw stack traces, or full signed messages in public errors.

---

## 17. Frontend requirements

### 17.1 Pages

- `/` product explanation and proof-first demo entry.
- `/app` covenant list.
- `/app/covenants/new` creation wizard.
- `/app/covenants/:id` live operator view.
- `/proof/:chainId/:contract/:covenantId` public verification page.
- `/docs` product-specific integration notes.

### 17.2 Covenant creation wizard

Steps:

1. Choose chain.
2. Choose verifier template.
3. Configure safe state.
4. Choose approved actions.
5. Review exact targets and recipients.
6. Set trigger authority and deadline.
7. Set fee and responder.
8. Run preflight validation.
9. Create and fund.

The review screen must display all immutable commitments in plain language and raw form.

### 17.3 Live run page

Panels:

- Covenant status.
- Declared outcome.
- Trigger evidence.
- Action ladder.
- Current verifier values.
- Simulation results.
- KeeperHub execution status.
- Transaction and explorer links.
- Payment state.
- Duplicate-protection state.

### 17.4 Public proof page

The page must answer five questions without login:

1. What outcome was promised?
2. What action was executed?
3. Did the verifier return true?
4. Was the responder paid in the same transaction?
5. Can another action or payment happen now?

### 17.5 Status language

Use exact states:

- `ARMED`
- `TRIGGERED`
- `SIMULATION REJECTED`
- `ATTEMPT REVERTED`
- `SATISFIED`
- `EXPIRED`
- `CANCELLED`

Do not display “rolled back” for a failed multi-transaction workflow. For an atomic attempt revert, display “attempt reverted with no state changes.”

### 17.6 Accessibility and resilience

- Keyboard navigation.
- Sufficient contrast.
- Live regions for status changes.
- Explorer links shown as text and icons.
- Loading, empty, stale, disconnected, and provider-degraded states.
- Never hide raw values behind only a visual indicator.

---

## 18. Canonical outcome receipt

### 18.1 Receipt schema

```json
{
  "schema": "resurv.outcome-receipt.v1",
  "receiptId": "rcpt_...",
  "generatedAt": "2026-08-04T00:00:00Z",
  "chain": {
    "chainId": 84532,
    "name": "Base Sepolia"
  },
  "covenant": {
    "manager": "0x...",
    "covenantId": "0x...",
    "requester": "0x...",
    "responder": "0x...",
    "triggerAuthority": "0x...",
    "deadline": 0,
    "verifier": "0x...",
    "verifierContextHash": "0x..."
  },
  "trigger": {
    "signalHash": "0x...",
    "nonce": 1,
    "transactionHash": "0x..."
  },
  "attempts": [
    {
      "sequence": 0,
      "actionIndex": 0,
      "actionName": "pause",
      "simulation": {
        "provider": "keeperhub",
        "requestHash": "0x...",
        "responseHash": "0x...",
        "wouldRevert": true,
        "revertReason": "AccessControlUnauthorizedAccount"
      },
      "broadcast": null
    },
    {
      "sequence": 1,
      "actionIndex": 1,
      "actionName": "evacuate-to-safe",
      "simulation": {
        "provider": "keeperhub",
        "wouldRevert": false
      },
      "broadcast": {
        "keeperhubExecutionId": "direct_...",
        "keeperhubStatus": "completed",
        "transactionHash": "0x...",
        "transactionLink": "...",
        "gasUsedWei": "...",
        "privateMempoolExpected": false
      }
    }
  ],
  "outcome": {
    "satisfied": true,
    "stateHash": "0x...",
    "observedValue": "1",
    "vaultBalance": "0",
    "safeBalanceIncrease": "1000000"
  },
  "payment": {
    "token": "0x...",
    "amount": "1000000",
    "recipient": "0x...",
    "transactionHash": "0x...",
    "sameTransactionAsSuccessfulAction": true
  },
  "terminalState": "SATISFIED",
  "duplicateProtection": {
    "triggerNonceConsumed": true,
    "successFeeReleasedOnce": true,
    "terminalActionsRejected": true
  },
  "verification": {
    "receiptHash": "0x...",
    "signer": "0x...",
    "contractSourceVerified": true,
    "confirmations": 12
  },
  "limitations": [
    "The failed simulation is offchain evidence and has no transaction hash",
    "The guarantee is single-chain and synchronous",
    "Private routing is not claimed unless confirmed for the chain"
  ]
}
```

### 18.2 Verification CLI

Provide:

```bash
pnpm resurv verify --receipt ./receipt.json
```

It must:

- Validate JSON schema.
- Recompute receipt hash.
- Verify RESURV signature if present.
- Read covenant state from chain.
- Read successful transaction receipt and events.
- Verify action and payment share the transaction hash.
- Call verifier at current state and, where archive RPC is available, at the successful block.
- Confirm terminal status.
- Confirm no second fee event.
- Report every check separately.

---

## 19. Reliability and observability

### 19.1 Internal service objectives

These are engineering targets, not public guarantees:

- Zero duplicate success-fee transfers.
- Zero actions after terminal state.
- 100% of successful covenants have a valid receipt.
- 100% of KeeperHub broadcasts have a stored execution ID before the next semantic action.
- Reconciliation detects database and chain divergence within 60 seconds.
- Public proof page availability target of 99.9% after launch.
- Trigger-to-first-simulation P95 under 10 seconds in healthy conditions.

### 19.2 Correlation identifiers

Carry across every layer:

- `requestId`
- `covenantId`
- `signalHash`
- `semanticAttemptId`
- `keeperhubExecutionId`
- `transactionHash`
- `traceId`

### 19.3 Metrics

```text
resurv_covenants_total{status}
resurv_triggers_total{result}
resurv_simulations_total{result,action}
resurv_attempts_total{result,action}
resurv_attempt_duration_seconds
resurv_keeperhub_requests_total{endpoint,status}
resurv_keeperhub_rate_limit_remaining
resurv_reconciliation_divergence_total{type}
resurv_receipt_verification_total{result}
resurv_duplicate_rejections_total{type}
resurv_rpc_disagreement_total{chain}
resurv_worker_job_lag_seconds
resurv_success_fee_total{token}
```

### 19.4 Logs

- Structured JSON only in deployed services.
- No secrets, raw API keys, private keys, or full auth tokens.
- Signed trigger may be stored encrypted but not printed in ordinary logs.
- Provider responses are redacted before logging.
- Log state transitions and invariant failures.

### 19.5 Traces

Trace spans:

```text
trigger.ingest
covenant.reconcile
outcome.read
planner.decide
keeperhub.simulate
rpc.simulate
keeperhub.broadcast
keeperhub.status
chain.confirm
receipt.generate
receipt.verify
```

### 19.6 Alerts

Critical alerts:

- Attempt broadcast without stored idempotency mapping.
- Chain says SATISFIED but database does not within 60 seconds.
- Database says SATISFIED but chain does not.
- Duplicate fee event.
- Unauthorized adapter execution.
- RPC providers disagree on finalized state.
- KeeperHub key rejected or spend cap reached.
- Worker lock held beyond timeout.
- Receipt verification failure after completion.

---

## 20. Security and threat model

### 20.1 Assets

- Escrowed success fees.
- Emergency action authority.
- KeeperHub organization wallet.
- KeeperHub API keys.
- Trigger authority keys.
- Contract configuration and action commitments.
- Canonical receipts and audit evidence.
- User sessions and RESURV API keys.

### 20.2 Trust boundaries

- Browser to API.
- API to database.
- Worker to KeeperHub.
- Worker to RPC providers.
- KeeperHub to Turnkey and target chain.
- Covenant manager to action adapter.
- Action adapter to target protocol.
- Covenant manager to verifier.
- Public verifier to chain state.

### 20.3 Threats and controls

#### Forged trigger

Controls:

- EIP-712 signer binding.
- Nonce.
- Validity window.
- Covenant ID and chain binding.
- Replay tests.

#### Compromised KeeperHub key

Controls:

- Key only in worker secrets.
- Per-environment key.
- KeeperHub organization spending cap.
- Onchain `EXECUTOR_ROLE` restricted to RESURV contract entry point.
- Action adapters and config commitments.
- Emergency pause.
- Rotation runbook.

#### Agent prompt injection

Controls:

- Typed incident normalization.
- No arbitrary HTTP or shell tools.
- No raw calldata tool.
- Server-side action eligibility.
- Model output schema.
- Deterministic fallback.

#### Arbitrary calldata

Controls:

- Contract stores adapter and config hashes.
- Worker does not accept target, ABI, function, or calldata from model.
- Adapter-specific schemas.
- Unit and invariant tests.

#### Reentrancy

Controls:

- OpenZeppelin `ReentrancyGuard`.
- Checks, effects, interactions ordering where compatible with atomic outcome verification.
- State set before fee transfer.
- Allowlisted fee tokens.
- Malicious adapter and token tests.

#### Stale simulation and TOCTOU

Controls:

- `expectedStateHash` passed into `executeAttempt`.
- Contract reads pre-state and reverts on mismatch.
- Simulation and broadcast use identical body.
- Fast submission after simulation.
- Reconcile before new semantic attempt.

#### RPC disagreement

Controls:

- Dedicated primary and secondary providers.
- Quorum for critical reads.
- Chain ID and block hash checks.
- Pause orchestration on disagreement.
- KeeperHub custom primary and fallback RPC where configured.

#### Reorg

Controls:

- Action and payment occur in the same transaction, so a reorg affects both together.
- UI shows `PROVISIONAL` until confirmation threshold.
- Receipt finalization waits for confirmations.
- Reconciliation handles removed logs.

#### Verifier manipulation

Controls:

- Immutable verifier after arming.
- Verified source.
- Deterministic state only.
- Oracle freshness and decimal rules where used.
- Fuzz and fork tests.
- Independent auditor review.

#### Target protocol bypass

Controls:

- Protocol grants narrow role to action adapter or RESURV executor contract, not broad role to an agent EOA.
- If an EOA has independent broad authority, RESURV cannot guarantee it will not bypass the contract. This must be disclosed.

#### Admin compromise

Controls:

- Multisig roles.
- Timelock for non-emergency registry changes.
- No admin rewrite of armed covenants.
- Emergency pause cannot seize escrow.
- Role change events monitored.

#### Database tampering

Controls:

- Chain reconciliation.
- Append-only audit records.
- Receipt hash and signature.
- Backups and restricted database roles.
- Public proof derives terminal facts from chain.

#### Denial of service

Controls:

- API rate limits.
- Queue backpressure.
- Per-covenant locks.
- Bounded attempts.
- Bounded model turns.
- Provider timeouts and circuit breakers.
- Manual escalation path.

### 20.4 Residual risks

- KeeperHub and Turnkey remain service dependencies.
- A chain outage can prevent recovery.
- A protocol may revoke every useful recovery role.
- A verifier can be correctly implemented but encode a poor definition of safety.
- A recovery transaction may be censored or delayed.
- Private routing availability is chain and platform dependent.
- Success-only compensation may not cover responder gas or opportunity cost.

---

## 21. Testing strategy

### 21.1 Reference model first

Create a pure domain model independent of contracts and KeeperHub:

```ts
type Result =
  | { status: 'satisfied'; actionIndex: number; paid: true }
  | { status: 'exhausted'; paid: false }
  | { status: 'expired'; paid: false }
  | { status: 'cancelled'; paid: false }
```

The model must cover:

- Already satisfied.
- Primary simulation failure.
- Primary execution revert.
- Primary executes but outcome false, causing full transaction revert.
- Fallback success.
- Duplicate trigger.
- Duplicate attempt.
- Deadline boundary.
- Exact threshold.
- One unit below and above threshold.
- Stale state hash.
- Attempt exhaustion.

Production implementation tests compare state transitions with the model.

### 21.2 Contract tests

Use Foundry:

- Unit tests for every function and error.
- Fuzz tests for action configuration, amounts, deadlines, and nonces.
- Invariant tests for the core invariants.
- Malicious token, adapter, verifier, and reentrancy fixtures.
- Gas snapshots.
- Fork tests against Base and any real protocol adapter.
- Storage and event schema snapshots.

Required invariant tests:

```text
invariant_fee_moves_at_most_once
invariant_satisfied_requires_true_verifier
invariant_false_outcome_reverts_target_state
invariant_terminal_blocks_attempts
invariant_only_committed_adapter_executes
invariant_trigger_nonce_never_replays
invariant_admin_cannot_rewrite_armed_covenant
invariant_escrow_conservation
```

### 21.3 KeeperHub client tests

- Contract tests against recorded fixtures.
- Rate-limit header handling.
- `Retry-After` handling.
- `X-Poll-Interval-Hint` handling.
- Idempotency replay.
- Idempotency conflict.
- In-progress conflict.
- Simulation success and revert decoding.
- Status and transaction-link parsing.
- Unexpected response schema fails closed.

### 21.4 Protocol seam tests

Run against the real KeeperHub environment:

1. `GET /api/chains` and save current chain configuration.
2. Simulate a known successful test call.
3. Simulate a known role failure.
4. Broadcast an atomic RESURV attempt.
5. Repeat exact request with same idempotency key.
6. Reuse key with changed body and confirm conflict.
7. Confirm status and explorer link.
8. Confirm contract event and fee transfer share the same transaction.
9. Confirm gas sponsorship and private routing cannot be claimed together.
10. Confirm failed marketplace workflow billing before using marketplace claims.

### 21.5 Backend tests

- Repository and migration tests.
- Transactional outbox tests.
- Worker concurrency tests.
- Duplicate event ingestion.
- Lock expiry and worker crash recovery.
- Reconciliation after database rollback.
- Provider timeout and malformed response.
- Auth and RBAC.
- Rate limiting.
- Receipt canonicalization.

### 21.6 Agent tests

- Valid decision.
- Invalid JSON.
- Unknown action.
- Ineligible action.
- Prompt injection in alert text.
- Low confidence.
- Model timeout.
- Deterministic fallback.
- No raw calldata path.

### 21.7 End-to-end tests

Local Anvil:

- Full trigger to satisfaction.
- Failed primary to successful fallback.
- Duplicate trigger.
- Expiry.
- Receipt verification.

Base Sepolia:

- Real KeeperHub simulation.
- Real transaction.
- Real explorer link.
- Real fee transfer.
- Public proof page.

### 21.8 Chaos tests

- Kill worker after KeeperHub response but before database update.
- Kill worker after broadcast but before status fetch.
- Redis unavailable.
- Database failover.
- Primary RPC stale.
- Secondary RPC returns different block.
- KeeperHub returns 429.
- KeeperHub response times out while transaction lands.
- Chain reorg in local simulation.

### 21.9 Security gates

- Slither or equivalent static analysis.
- Foundry invariant and fuzz tests.
- Dependency audit.
- Secret scan.
- SAST.
- Container scan.
- IaC scan.
- Manual permission review.
- External contract review before mainnet.

---

## 22. Deployment and environments

### 22.1 Environments

| Environment | Chain | KeeperHub | Funds | Purpose |
|---|---|---|---|---|
| Local | Anvil | Mock server | Mock token | Unit and E2E |
| Integration | Base fork | Mock plus read-only live | None | Protocol behavior |
| Staging | Base Sepolia | Live | Test USDC | Full seam proof |
| Canary | Base | Live | Strictly capped | Limited production proof |
| Production | Base | Live | Approved caps | Post-audit only |

### 22.2 Application deployment

Recommended Railway services:

- `resurv-web`
- `resurv-api`
- `resurv-worker`
- PostgreSQL
- Redis

Requirements:

- Separate service credentials.
- Private networking where available.
- Health checks.
- Resource limits.
- Rolling app deploys.
- Worker deployment with graceful shutdown and job handoff.
- Database migrations as a separate gated job.

### 22.3 Contract deployment

- Foundry scripts only.
- Deployer key in Foundry keystore for local operator use.
- CI mainnet deployment is disabled.
- Mainnet requires manual multisig approval.
- Verify source on explorer.
- Record addresses and bytecode hashes in `docs/DEPLOYMENTS.md`.
- Run post-deployment smoke tests.
- Transfer admin and pauser roles to intended multisigs.
- Renounce unused deployer roles.

### 22.4 RPC

- Do not use public Base RPC endpoints for production service workloads.
- Configure dedicated primary and secondary providers.
- Check chain ID on every client startup.
- Set timeouts and circuit breakers.
- Keep archive access for historical receipt verification where possible.

### 22.5 Secrets

Required:

```text
DATABASE_URL
REDIS_URL
KH_API_KEY
PRIMARY_RPC_URL
SECONDARY_RPC_URL
ANTHROPIC_API_KEY
SESSION_SECRET
RESURV_RECEIPT_SIGNING_KEY
SENTRY_DSN or OTEL_EXPORTER_OTLP_ENDPOINT
```

Rules:

- Never commit `.env`.
- Claude Code permissions deny reading `.env*` and secret directories.
- Rotate staging and production independently.
- Receipt signing uses a dedicated key, not the deployer or trigger authority.
- Prefer KMS or HSM for production receipt signing.

### 22.6 Backups

- Automated PostgreSQL backups.
- Restore test before production launch.
- Receipts replicated to object storage.
- Contract state remains independently recoverable from chain events.
- Runbook documents full database rebuild from chain plus KeeperHub evidence.

---

## 23. CI and release gates

### 23.1 Pull request CI

- Install from lockfile.
- Format check.
- Type check.
- Lint.
- Unit tests.
- Contract tests.
- Fuzz smoke suite.
- Build all packages.
- Migration validation.
- Secret scan.
- SAST and dependency audit.
- Changed contract ABI and bytecode report.

### 23.2 Main branch CI

Everything above plus:

- Full invariant suite.
- Integration tests with Postgres and Redis.
- Docker image build and scan.
- Playwright browser tests.
- KeeperHub contract tests against recorded fixtures.
- Staging deployment.
- Staging smoke tests.

### 23.3 Release candidate gate

- Real Base Sepolia covenant lifecycle.
- Real KeeperHub execution ID and transaction hash.
- Receipt verifies independently.
- Duplicate trigger test passes.
- Claim ledger reviewed.
- Demo recording matches current deployment.
- Runbook rehearsal.

### 23.4 Mainnet gate

- Independent contract review.
- All critical and high findings resolved.
- Capped canary parameters approved.
- Multisigs configured.
- Monitoring and paging active.
- Key rotation tested.
- Database restore tested.
- No unverified assumptions in the mainnet path.

---

## 24. Proof ladder

Do not present a lower rung as a higher one.

1. Plain reference model.
2. Contract unit tests.
3. Fuzz and invariant tests.
4. Local full lifecycle.
5. KeeperHub seam tests.
6. Base fork integration.
7. Base Sepolia deployment.
8. Real KeeperHub atomic attempt.
9. Public proof page and verification CLI.
10. Capped Base mainnet canary.
11. Independent audit and production launch.

Hackathon submission must reach at least rung 9.

---

## 25. Three-minute demo

### 0:00 to 0:20

Show the promise:

> Most agents stop when a transaction lands. RESURV stops only when the promised onchain state is true.

Display:

```text
OUTCOME: vault empty and approved Safe received 1 USDC
SUCCESS FEE: 1 USDC
PRIMARY: pause
FALLBACK: evacuate
```

### 0:20 to 0:45

Trigger the covenant with a signed risk signal.

Display:

```text
COVENANT TRIGGERED
OUTCOME FALSE
FEE LOCKED
```

### 0:45 to 1:10

Primary action simulation.

`pause()` fails because the role was revoked.

Display the exact KeeperHub simulation response and reason:

```text
ATTEMPT 1
PAUSE
SIMULATION REJECTED
NO TRANSACTION SENT
```

### 1:10 to 1:55

RESURV selects `evacuateToSafe()`.

Show:

- Canonical action details.
- KeeperHub simulation success.
- KeeperHub execution ID.
- Live transaction link.

### 1:55 to 2:25

Open the successful transaction.

Show in one transaction:

- Vault sends USDC to Safe.
- Verifier returns true.
- Covenant becomes SATISFIED.
- Success fee transfers to responder.

### 2:25 to 2:45

Replay the same trigger.

Show:

```text
DUPLICATE REJECTED
0 NEW ACTIONS
0 SECOND PAYMENT
```

### 2:45 to 3:00

Open the public proof page and verification command.

Close:

> The transaction landed. RESURV proves the outcome was reached and pays only then.

---

## 26. Judge objections

### “Is this just a guardian bot?”

No. A guardian usually detects a threshold and sends one action. RESURV defines an immutable outcome covenant, attempts bounded fallback actions, verifies the state inside the successful transaction, and releases payment only when that state is true.

### “Why not put all of this in a smart contract?”

The contract enforces the safety and payment properties. KeeperHub handles the unreliable last mile around it: simulation, signing, gas, retries, routing, status, and audit evidence. The agent also needs to interpret failure and select among pre-authorized actions.

### “Does the workflow roll back earlier transactions?”

No. RESURV does not rely on multi-transaction rollback. Each version 1 attempt is one EVM transaction. A false postcondition reverts that transaction before any state change or payment can persist.

### “Is the AI trusted with funds?”

No. The model can select only from committed actions. The API and contract reject raw calldata and uncommitted configurations.

### “What if the model is down?”

The deterministic fallback order continues or the system escalates. Model availability is not a safety dependency.

### “Could the KeeperHub wallet bypass RESURV?”

The protocol should grant narrow emergency authority to the RESURV executor or adapters, not broad direct authority to the EOA. If an EOA has separate broad permissions, bypass resistance cannot be claimed.

### “What proves the responder earned the fee?”

The successful action, verifier result, covenant state transition, and fee transfer occur in the same transaction. The receipt links the transaction and contract events.

### “Why not x402 for the success fee?”

Marketplace x402 or MPP is useful for discovery and initiation. The core success fee uses target-chain escrow so outcome and payment can be atomic in the same transaction. Marketplace billing remains an extension until its exact execution coupling is proven.

### “What if every recovery action fails?”

The agent stops after the committed limits, emits an escalation record, and the covenant expires. It cannot invent authority.

### “What is the post-hackathon company?”

A library and network of verifiable outcome covenants, response adapters, and responder track records for protocol operations, treasury safety, bridge completion, and paid onchain service-level agreements.

---

## 27. Success metrics

### 27.1 Binary product metrics

- Successful covenant has verifier true in the same transaction.
- Success fee is released once.
- Duplicate trigger causes no new effect.
- Failed primary simulation causes no transaction.
- Public verifier reproduces terminal facts.

### 27.2 Hackathon metrics

- One real completed covenant.
- At least one failed primary path.
- At least one real fallback transaction.
- At least one KeeperHub integration improvement artifact.
- Full source, tests, transaction links, and demo.

### 27.3 Post-hackathon metrics

- Covenants created.
- Outcomes satisfied.
- Median time to safe state.
- Percentage requiring fallback.
- Attempts per success.
- Duplicate-effect rate.
- Receipt verification rate.
- Responder success rate by verifier class.

---

## 28. Build phases and hard gates

No phase starts before the previous gate passes.

### Phase 0: Source lock and repository foundation

Deliverables:

- Monorepo scaffold.
- Pinned versions and lockfile.
- Root `CLAUDE.md`.
- Claude Code settings, agents, rules, and skills.
- `docs/CLAIMS.md`.
- `docs/THREAT_MODEL.md` initial version.
- KeeperHub source snapshot and seam-test checklist.
- CI skeleton.

Exit gate:

- Clean install and build.
- No secrets readable by Claude Code project permissions.
- All documented commands work.
- Claim ledger distinguishes verified facts and assumptions.

Forbidden before gate:

- UI polish.
- Marketplace work.
- Mainnet deployment.

### Phase 1: Reference model and atomic contracts

Deliverables:

- Pure reference model.
- Covenant manager.
- Interfaces.
- Demo vault.
- Pause and evacuation adapters.
- Safe-state verifier.
- Unit, fuzz, and invariant tests.

Exit gate:

- False verifier result reverts target state, covenant state, and payment.
- Fee can move only once.
- Duplicate trigger and attempt tests pass.
- Contract coverage report reviewed.

### Phase 2: KeeperHub protocol-seam spike

Deliverables:

- Typed KeeperHub client.
- Live chain discovery.
- Simulation fixtures.
- Idempotency tests.
- Real Base Sepolia call.
- Current private-routing and sponsorship evidence.
- Documentation of API inconsistencies and issues.

Exit gate:

- One real KeeperHub-executed contract call with authoritative status and transaction link.
- Same-key replay returns original execution.
- Changed-body reuse returns conflict.
- Failed simulation produces no broadcast.
- Exact limitations written in claim ledger.

### Phase 3: Orchestrator and reconciliation

Deliverables:

- Database schema and migrations.
- Worker queue.
- Chain event indexer.
- Covenant lock.
- Reconciliation loop.
- KeeperHub simulation and broadcast pipeline.
- Confirmation handling.

Exit gate:

- Worker crash after broadcast recovers without duplicate execution.
- Database can rebuild terminal covenant state from chain.
- RPC disagreement pauses execution.

### Phase 4: Bounded response agent

Deliverables:

- Typed agent tools.
- Decision schema.
- Model adapter.
- Deterministic fallback.
- Prompt injection test suite.
- Decision audit records.

Exit gate:

- Agent cannot generate raw calldata.
- Invalid model output cannot cause execution.
- Demo completes with model disabled.
- Model-enabled path selects the correct fallback and gives a faithful explanation.

### Phase 5: Product API, dashboard, and receipt

Deliverables:

- Auth and RBAC.
- Covenant creation flow.
- Live timeline.
- Public proof page.
- Canonical receipt.
- Verification CLI.
- SSE updates.

Exit gate:

- Judge can verify the successful covenant without credentials.
- Receipt verification matches chain.
- UI handles stale and degraded provider states.

### Phase 6: Security and reliability hardening

Deliverables:

- Completed threat model.
- Chaos tests.
- Static analysis.
- Secret scan.
- Container scan.
- Observability dashboards.
- Alerts and runbooks.
- Database restore test.

Exit gate:

- No unresolved critical or high finding.
- Crash and provider-failure scenarios produce no duplicate effect.
- On-call runbook rehearsal passes.

### Phase 7: Public Base Sepolia proof

Deliverables:

- Verified contracts.
- Real funded covenant.
- Failed primary simulation.
- Successful fallback.
- Same-transaction verifier and payment.
- Duplicate replay proof.
- Public receipt and demo video.

Exit gate:

- Every public claim links to evidence.
- Submission transaction works from a clean browser.
- Demo can be followed with sound off.

### Phase 8: KeeperHub marketplace and onboarding bounty

Deliverables:

- Optional listed workflow or template.
- Paid-call failure billing seam test.
- Builder starter template.
- Documentation or pull request covering atomic attempts, idempotency, or workflow irreversibility.
- Reproducible issue reports.

Exit gate:

- Marketplace work does not weaken core proof.
- Onboarding artifact can be used independently by another builder.

### Phase 9: Submission and release

Deliverables:

- Public repository.
- Architecture and threat-model docs.
- Final video.
- Transaction and proof links.
- Submission copy.
- Release tag.
- Reproducible setup.

Exit gate:

- Fresh clone passes documented setup and tests.
- Claims ledger has no unsupported claim.
- Live proof remains operational.

---

## 29. Claude Code operating system

### 29.1 Session rule

Use one named Claude Code session per phase. Do not carry an overloaded implementation session across unrelated phases.

Recommended names:

```text
resurv-phase-0-foundation
resurv-phase-1-contracts
resurv-phase-2-keeperhub-seam
resurv-phase-3-orchestrator
resurv-phase-4-agent
resurv-phase-5-product
resurv-phase-6-hardening
resurv-phase-7-live-proof
```

### 29.2 Phase workflow

For every phase:

1. Start in plan mode.
2. Read this PRD, `CLAUDE.md`, phase files, claim ledger, and current git state.
3. Inspect existing code before proposing changes.
4. Produce a file-level plan and test plan.
5. Challenge the plan with the relevant reviewer subagent.
6. Implement the smallest coherent slice.
7. Run focused tests.
8. Run phase gate tests.
9. Run independent review in a worktree or read-only agent.
10. Fix findings.
11. Update claims, versions, architecture, and runbooks.
12. Commit with a clear phase checkpoint.

### 29.3 Required subagents

- `contracts-auditor`: read-only contract threat review and invariant analysis.
- `keeperhub-integrator`: official-doc and seam-behavior reviewer.
- `test-reviewer`: searches for missing negative, property, concurrency, and failure tests.
- `claim-auditor`: checks public statements against evidence.

Subagents must return findings, not silently modify the main worktree unless explicitly run in an isolated worktree.

### 29.4 Hooks

Project hooks must:

- Block destructive shell commands.
- Block force push and direct commits to protected branches.
- Block reading `.env`, secret files, and keystores.
- Run formatter after supported file edits where practical.
- Warn when contract ABI or bytecode changes.
- Require claim-ledger review before release-tag commands.

### 29.5 Permissions

Allowed without repeated prompts:

- Read project files excluding secrets.
- Run formatting, linting, type checking, and tests.
- Run local Docker Compose.
- Run non-destructive git inspection.

Always ask:

- Package installation or dependency updates.
- Network calls outside approved official documentation and configured MCP servers.
- Deployment commands.
- Database migration against non-local environments.
- Git push.

Always deny:

- Reading `.env*`, keystores, or secrets.
- `rm -rf` outside generated temporary paths.
- `git push --force`.
- Mainnet deployment from Claude Code.
- Private-key export.
- Disabling tests or security hooks to make a gate pass.

### 29.6 Context management

- Keep root `CLAUDE.md` under 200 lines.
- Put detailed procedures in `.claude/skills/`.
- Put path-specific rules in `.claude/rules/`.
- Use subagents for large searches and reviews.
- Use `/compact` only after durable decisions are written to files.
- Use `/rename` for every phase session.
- Use git checkpoints. Claude Code checkpoints do not replace git.

### 29.7 Standard phase prompt

```text
Read RESURV_PRD_v1.0.md, CLAUDE.md, docs/CLAIMS.md, docs/THREAT_MODEL.md,
and the current repository. Work on Phase <N> only.

First enter plan mode and inspect the code. Produce:
1. the current-state summary,
2. the exact files to change,
3. the invariants affected,
4. the tests that must fail before implementation,
5. the phase exit gate,
6. any claim in CLAIMS.md that this work may change.

Do not implement until the plan is coherent. Do not weaken an invariant, skip a
failing test, introduce arbitrary calldata, expose secrets, or claim behavior that
has not been reproduced. After implementation, run the focused tests and full phase
gate, ask the relevant reviewer subagent to challenge the result, fix findings, and
update durable documentation before committing.
```

---

## 30. Definition of done

RESURV version 1 is complete only when:

- The core atomic attempt is deployed and source verified.
- The primary action fails safely before broadcast.
- The fallback executes through KeeperHub.
- The verifier, covenant finalization, and success fee occur in the same transaction.
- Duplicate trigger and payment are rejected.
- A public receipt verifies independently.
- The repository builds from a fresh clone.
- Tests and security gates pass.
- Every claim is classified and supported.
- The demo and documentation describe limitations honestly.
- The onboarding artifact is published.

---

## 31. Kill and pivot criteria

Pivot or stop if any of these become true:

1. KeeperHub cannot reliably execute and return proof for the atomic attempt.
2. The target protocol cannot grant narrow authority to a RESURV adapter or executor.
3. The outcome cannot be observed synchronously in the same chain transaction.
4. The verifier cannot be made independent and deterministic.
5. Duplicate effects cannot be prevented onchain.
6. The demo depends on mocked execution or hidden manual signatures.
7. Existing submissions already implement the same atomic outcome covenant mechanism as their core.
8. Protocol users consistently prefer a single pause action and see no value in fallback outcome closure.
9. KeeperHub chain configuration or reliability makes the selected target chain unsuitable.
10. Security review finds that success-only fee escrow creates unacceptable attack incentives that cannot be mitigated.

---

## 32. Extension roadmap

Only after version 1 proof:

1. Verifier and adapter registry.
2. Safe module integration for existing protocol treasuries.
3. Attempt stipends and gas reimbursement.
4. Marketplace-discovered responder services.
5. Verifiable responder performance records.
6. Reverse auction for outcome fees.
7. Multi-party responder quorum.
8. Cross-chain covenants with explicit asynchronous semantics.
9. Insurance or SLA tranches.
10. Succinct or ZK-compressed receipts.

Each extension must strengthen the outcome covenant or remove a proven adoption barrier.

---

## 33. Official source map

Verified or documented claims in this PRD were based on the following official sources as accessed on 4 August 2026:

### KeeperHub

- Direct Execution API: https://docs.keeperhub.com/api/direct-execution
- Executions API: https://docs.keeperhub.com/api/executions
- Marketplace: https://docs.keeperhub.com/workflows/marketplace
- Hackathon Quickstart: https://docs.keeperhub.com/quickstart
- Authentication: https://docs.keeperhub.com/api/authentication
- Chains API: https://docs.keeperhub.com/api/chains
- Analytics API: https://docs.keeperhub.com/api/analytics
- Gas Management: https://docs.keeperhub.com/wallet-management/gas
- Agentic Wallets: https://docs.keeperhub.com/ai-tools/agentic-wallet
- FAQ: https://docs.keeperhub.com/FAQ
- Claude Code Plugin: https://docs.keeperhub.com/ai-tools/claude-code-plugin
- MCP Server: https://docs.keeperhub.com/ai-tools/mcp-server
- MCP Trigger Inputs: https://docs.keeperhub.com/ai-tools/mcp-trigger-inputs
- Validate Workflow: https://docs.keeperhub.com/ai-tools/mcp-validate-workflow
- Prior hackathon review: https://keeperhub.com/blog/010-openagents-hackathon-wrap

### Claude Code

- Best practices: https://code.claude.com/docs/en/best-practices
- Memory and CLAUDE.md: https://code.claude.com/docs/en/memory
- Settings: https://code.claude.com/docs/en/settings
- Permissions: https://code.claude.com/docs/en/permissions
- Hooks guide: https://code.claude.com/docs/en/hooks-guide
- Hooks reference: https://code.claude.com/docs/en/hooks
- Subagents: https://code.claude.com/docs/en/sub-agents
- Skills: https://code.claude.com/docs/en/slash-commands
- Common workflows: https://code.claude.com/docs/en/common-workflows

### Smart contracts and Base

- OpenZeppelin Contracts: https://docs.openzeppelin.com/contracts/5.x
- Ethereum smart contract security: https://ethereum.org/developers/docs/smart-contracts/security/
- Base contract deployment: https://docs.base.org/get-started/deploy-smart-contracts
- Base app and viem patterns: https://docs.base.org/apps/quickstart/build-app
- Base network connection guidance: https://docs.base.org/base-chain/quickstart/connecting-to-base

---

## 34. Final locked statement

**RESURV is not a transaction bot. It is an outcome covenant. The agent receives a bounded recovery plan, KeeperHub lands the attempt, the contract proves the safe state in the same transaction, and the responder is paid only when that state is real.**
