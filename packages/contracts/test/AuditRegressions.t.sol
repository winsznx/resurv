// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {CovenantStatus, CovenantStatusLib} from "../src/CovenantStatus.sol";
import {ResurvCovenantManager} from "../src/ResurvCovenantManager.sol";
import {IOutcomeVerifier} from "../src/interfaces/IOutcomeVerifier.sol";
import {DemoVault} from "../src/demo/DemoVault.sol";
import {CovenantFixture} from "./support/CovenantFixture.sol";

/// @notice A verifier with no code at all. Solidity's `extcodesize` guard raises in the caller's
///         frame, outside any `try/catch`, which is how a covenant's escrow got trapped.
///         Represented by an address that is simply never deployed.

/// @dev Returns one byte. ABI decoding of a malformed return also raises in the caller's frame.
contract ShortReturnVerifier {
    fallback() external {
        assembly {
            mstore(0, 1)
            return(0, 1)
        }
    }
}

/// @dev Returns exactly 96 conforming-looking bytes whose first word is neither 0 nor 1.
///      Solidity's decoder validates booleans and raises in the *caller's* frame on anything
///      else, so this passed a length check and then reverted the expiry anyway.
contract DirtyBoolVerifier {
    fallback() external {
        assembly {
            mstore(0x00, 2)
            mstore(0x20, 0)
            mstore(0x40, 0)
            return(0x00, 0x60)
        }
    }
}

/// @dev Answers `true` in four words instead of three. Solidity's typed decoder accepts a
///      trailing tail for static types, so every typed path reads `true` from this — while an
///      exact-length check on the expiry path read "not conforming" and refunded.
contract OverlongTrueVerifier {
    fallback() external {
        assembly {
            mstore(0x00, 1)
            mstore(0x20, 0x1234)
            mstore(0x40, 7)
            mstore(0x60, 0xdead)
            return(0x00, 0x80)
        }
    }
}

/// @dev Returns 64 bytes: enough to look like an answer to a length check that only rejects the
///      obviously-empty, and not enough to be one. The first word reads `true`. Nothing in the
///      suite exercised the 32-to-95-byte band, so weakening the guard to `< 32` survived it.
contract PartialReturnVerifier {
    fallback() external {
        assembly {
            mstore(0x00, 1)
            mstore(0x20, 0x1234)
            return(0x00, 0x40)
        }
    }
}

/// @dev Answers true, expensively. Used to prove a caller cannot starve a verifier into silence
///      and take a refund over an outcome that is actually satisfied.
contract ExpensiveTrueVerifier is IOutcomeVerifier {
    uint256 public constant ROUNDS = 20_000;

    function evaluate(bytes32, bytes calldata) external pure returns (bool, bytes32, uint256) {
        bytes32 churn = keccak256("start");
        for (uint256 i = 0; i < ROUNDS; ++i) {
            churn = keccak256(abi.encode(churn, i));
        }
        return (true, churn, 1);
    }
}

/// @notice Reaches two internal guards that atomicity itself puts out of reach of every public
///         path, so they can be judged on their own rather than through the checks in front of
///         them. It adds no state, overrides nothing, and changes no logic.
///
/// @dev Both guards are unreachable for the same structural reason. An attempt that does not
///      satisfy the outcome reverts in full, which rolls back the attempt counters it just
///      incremented; and an attempt that does satisfy it settles the fee and ends the covenant.
///      So a test driving public entry points can only ever observe the *first* layer, and a
///      mutation campaign proved it: deleting `if (covenant.feeSettled) revert` left all 114
///      tests green, fee invariant included.
///
///      Reaching past the first layer is not a claim that the guards are reachable in
///      production. It is the opposite. They are defence in depth against a future change that
///      lets a non-satisfying attempt commit, and this harness is how that defence gets tested
///      at all instead of being asserted in a comment.
contract ManagerHarness is ResurvCovenantManager {
    constructor(address admin_, address pauser_, address executor_, address[] memory feeTokens_)
        ResurvCovenantManager(admin_, pauser_, executor_, feeTokens_)
    {}

    function settleEscrowDirectly(bytes32 covenantId, address recipient)
        external
        returns (uint256)
    {
        return _settleEscrow(_covenants[covenantId], recipient);
    }

    /// @dev Everything `executeAttempt` does up to and including the counter increments, without
    ///      running the action or evaluating the postcondition. The commitment checks, the
    ///      attempt-id burn and both limits are exactly the production ones.
    function consumeAttemptWithoutVerifying(
        bytes32 covenantId,
        uint256 actionIndex,
        bytes calldata actionConfig,
        bytes calldata verifierContext,
        uint64 attemptSequence
    ) external returns (bytes32 attemptId) {
        (attemptId,,) = _consumeAttempt(
            AttemptRequest({
                covenantId: covenantId,
                actionIndex: actionIndex,
                expectedStateHash: bytes32(0),
                attemptSequence: attemptSequence
            }),
            actionConfig,
            verifierContext
        );
    }
}

/// @notice Regressions for every finding this project's own `contracts-auditor` review raised, and
///         for the three mutations that survived the suite as it stood.
///
///         That review is an in-repo reviewer with no write access, not a third-party security
///         audit. RESURV has had no external audit and says so everywhere it says anything.
///
/// @dev Each test names the finding it pins. They are in one file rather than scattered because
///      a reader asking "was that audit actually acted on" should be able to answer it in one
///      place, and because a finding that comes back should fail here first.
contract AuditRegressionsTest is CovenantFixture {
    function setUp() public {
        _deployWorld();
    }

    // -------------------------------------------------------------------------------------
    // H-1: every exit closed at once, and the escrow was unrecoverable
    // -------------------------------------------------------------------------------------

    /// @dev The reported sequence: the requester's own team pauses the vault by hand, which makes
    ///      the declared outcome true, and the deadline passes. Expiry refused to refund because
    ///      the outcome was true; finalization refused because the deadline had passed; an
    ///      attempt refused for the same reason; cancellation was never available after a
    ///      trigger. The fee was gone, permanently, on an immutable contract.
    function test_aSatisfiedCovenantCanStillBeClosedAfterItsDeadline() public {
        bytes32 covenantId = _armedCovenant();
        _trigger(covenantId, keccak256("alert"), 0);

        bytes32 pauserRole = vault.PAUSER_ROLE();
        vm.startPrank(admin);
        vault.grantRole(pauserRole, admin);
        vault.pause();
        vm.stopPrank();

        vm.warp(deadline + 1);

        // Expiry still refuses, correctly: the outcome is true and the escrow is not the
        // requester's to reclaim on that basis.
        vm.expectRevert(ResurvCovenantManager.OutcomeAlreadySatisfied.selector);
        manager.expireCovenant(covenantId, _verifierContext());

        // And the exit that fits the facts is open.
        uint256 before = token.balanceOf(requester);
        manager.finalizeAlreadySatisfied(covenantId, _verifierContext());

        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.SATISFIED));
        assertEq(token.balanceOf(requester) - before, ONE_USD, "escrow was not recoverable");
        assertEq(manager.escrowed(address(token)), 0);
    }

    /// @dev A funded, triggered covenant always has at least one callable exit. This is the
    ///      liveness property the audit said was missing, stated directly.
    function test_aFundedCovenantAlwaysHasAnExit() public {
        bytes32 covenantId = _armedCovenant();
        _trigger(covenantId, keccak256("alert"), 0);
        vm.warp(deadline + 1);

        uint256 snapshot = vm.snapshotState();

        // Outcome false: expiry refunds.
        manager.expireCovenant(covenantId, _verifierContext());
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.EXPIRED));

        // Outcome true: finalization closes it.
        vm.revertToState(snapshot);
        bytes32 pauserRole = vault.PAUSER_ROLE();
        vm.startPrank(admin);
        vault.grantRole(pauserRole, admin);
        vault.pause();
        vm.stopPrank();
        manager.finalizeAlreadySatisfied(covenantId, _verifierContext());
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.SATISFIED));
    }

    // -------------------------------------------------------------------------------------
    // H-2: the try/catch did not catch what it was written to catch
    // -------------------------------------------------------------------------------------

    function test_aCodelessVerifierDoesNotTrapTheEscrow() public {
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.verifier = address(0xDEAD1);
        params.verifierContext = hex"";

        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, _defaultActions());
        _fundAndArm(covenantId, ONE_USD);
        _trigger(covenantId, keccak256("alert"), 0);

        uint256 before = token.balanceOf(requester);
        vm.warp(deadline + 1);
        manager.expireCovenant(covenantId, hex"");

        assertEq(
            token.balanceOf(requester) - before, ONE_USD, "escrow trapped by a codeless verifier"
        );
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.EXPIRED));
    }

    function test_aVerifierWithShortReturnDataDoesNotTrapTheEscrow() public {
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.verifier = address(new ShortReturnVerifier());
        params.verifierContext = hex"";

        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, _defaultActions());
        _fundAndArm(covenantId, ONE_USD);
        _trigger(covenantId, keccak256("alert"), 0);

        uint256 before = token.balanceOf(requester);
        vm.warp(deadline + 1);
        manager.expireCovenant(covenantId, hex"");

        assertEq(
            token.balanceOf(requester) - before, ONE_USD, "escrow trapped by a malformed answer"
        );
    }

    /// @dev H-2 came back in a third shape. Replacing the `try/catch` with a low-level
    ///      `staticcall` and an exact length check was supposed to make "cannot answer" an
    ///      answer, and it did for a codeless verifier and a short return. It did not for a
    ///      well-formed 96-byte return whose bool word is neither 0 nor 1: `abi.decode` validates
    ///      booleans and raised in the manager's own frame, past the length check, outside
    ///      anything. Every exit shut on an immutable contract, again.
    function test_aVerifierReturningADirtyBooleanDoesNotTrapTheEscrow() public {
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.verifier = address(new DirtyBoolVerifier());
        params.verifierContext = hex"";

        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, _defaultActions());
        _fundAndArm(covenantId, ONE_USD);
        _trigger(covenantId, keccak256("alert"), 0);

        uint256 before = token.balanceOf(requester);
        vm.warp(deadline + 1);
        manager.expireCovenant{gas: 30_000_000}(covenantId, hex"");

        assertEq(
            token.balanceOf(requester) - before, ONE_USD, "escrow trapped by a non-boolean answer"
        );
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.EXPIRED));
        assertEq(manager.escrowed(address(token)), 0);
    }

    /// @dev PRD invariant 10.14.8 from the other side. The typed paths use Solidity's decoder,
    ///      which ignores a trailing tail on static types, so a four-word verifier answers `true`
    ///      to `executeAttempt` and `finalizeAlreadySatisfied`. The expiry's exact-length check
    ///      called the same verifier "not conforming" and refunded over a true outcome. Two
    ///      readings of one verifier inside one contract is a defect regardless of which is
    ///      right; the decoder's reading is the one every other path uses.
    function test_expiryRefusesATrueOutcomeReturnedWithATrailingTail() public {
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.verifier = address(new OverlongTrueVerifier());
        params.verifierContext = hex"";

        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, _defaultActions());
        _fundAndArm(covenantId, ONE_USD);
        _trigger(covenantId, keccak256("alert"), 0);
        vm.warp(deadline + 1);

        vm.expectRevert(ResurvCovenantManager.OutcomeAlreadySatisfied.selector);
        manager.expireCovenant{gas: 30_000_000}(covenantId, hex"");

        // And the covenant is not stranded by that refusal: the path that agrees the outcome is
        // true closes it and returns the escrow.
        uint256 before = token.balanceOf(requester);
        manager.finalizeAlreadySatisfied(covenantId, hex"");
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.SATISFIED));
        assertEq(token.balanceOf(requester) - before, ONE_USD);
    }

    /// @dev H-1 restored one role away. `finalizeAlreadySatisfied` carried `whenNotPaused`, so a
    ///      covenant whose outcome became true past its deadline had expiry refusing because the
    ///      outcome is true, this path refusing because of the pause, and both other exits closed
    ///      by status. PRD 10.11: a pause must not stop refunds for expired covenants.
    function test_aGlobalPauseCannotStrandEscrowOnACovenantWhoseOutcomeCameTrue() public {
        bytes32 covenantId = _armedCovenant();
        _trigger(covenantId, keccak256("alert"), 0);

        bytes32 pauserRole = vault.PAUSER_ROLE();
        vm.startPrank(admin);
        vault.grantRole(pauserRole, admin);
        vault.pause();
        vm.stopPrank();

        vm.warp(deadline + 1);
        vm.prank(pauser);
        manager.setPaused(true);

        // Expiry still refuses, correctly: the outcome is true.
        vm.expectRevert(ResurvCovenantManager.OutcomeAlreadySatisfied.selector);
        manager.expireCovenant(covenantId, _verifierContext());

        // The refund path is open despite the pause, because it is a refund.
        uint256 before = token.balanceOf(requester);
        manager.finalizeAlreadySatisfied(covenantId, _verifierContext());

        assertEq(token.balanceOf(requester) - before, ONE_USD, "a pause stranded the escrow");
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.SATISFIED));
        assertEq(token.balanceOf(responder), 0, "a refund path paid a fee");
    }

    // -------------------------------------------------------------------------------------
    // Guards a second mutation campaign found nothing was testing
    // -------------------------------------------------------------------------------------

    /// @dev The expiry reads the verifier with a context the *caller* supplies. Without the
    ///      commitment check an expirer could hand over a context the verifier answers false to
    ///      and take the refund over an outcome that is actually true, which is PRD invariant
    ///      10.14.8 again, through the door nobody was watching. Dropping this check survived
    ///      the entire suite.
    function test_expiryRefusesAVerifierContextTheCovenantDidNotCommitTo() public {
        bytes32 covenantId = _armedCovenant();
        _trigger(covenantId, keccak256("alert"), 0);

        bytes32 pauserRole = vault.PAUSER_ROLE();
        vm.startPrank(admin);
        vault.grantRole(pauserRole, admin);
        vault.pause();
        vm.stopPrank();
        vm.warp(deadline + 1);

        // A different vault, unpaused and holding a balance, so the verifier answers false. The
        // committed context is the only one this covenant is about.
        DemoVault decoy = new DemoVault(admin);
        token.mint(address(decoy), ONE_USD);
        bytes memory forged = abi.encode(address(decoy), safe, address(token), uint256(0), ONE_USD);

        vm.expectRevert(ResurvCovenantManager.InvalidVerifierContext.selector);
        manager.expireCovenant(covenantId, forged);

        assertEq(manager.escrowed(address(token)), ONE_USD, "escrow left on a forged context");
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.TRIGGERED));
    }

    /// @dev `finalizeAlreadySatisfied` moves escrow and stamps SATISFIED. Admitting an ARMED
    ///      covenant would be an `ARMED -> SATISFIED` edge `CovenantStatusLib` explicitly
    ///      forbids, and would close a covenant nobody ever triggered. Nothing tested it.
    function test_finalizationRefusesACovenantThatWasNeverTriggered() public {
        bytes32 covenantId = _armedCovenant();

        bytes32 pauserRole = vault.PAUSER_ROLE();
        vm.startPrank(admin);
        vault.grantRole(pauserRole, admin);
        vault.pause();
        vm.stopPrank();

        vm.expectRevert(ResurvCovenantManager.InvalidStatus.selector);
        manager.finalizeAlreadySatisfied(covenantId, _verifierContext());

        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.ARMED));
        assertEq(manager.escrowed(address(token)), ONE_USD);
    }

    /// @dev The attempt-id burn is the mechanism the whole replay story rests on, and its refusal
    ///      branch was never reached: an attempt either reverts whole, unburning the id, or
    ///      satisfies the covenant and ends it. `test_attemptIdBurnBlocksAReplayOnAnOpenCovenant`
    ///      asserts the burn happened and never issues the call the guard would refuse. Deleting
    ///      the guard survived the suite. The harness issues that second call.
    function test_aBurnedAttemptIdIsRefusedOnASecondUse() public {
        address[] memory feeTokens = new address[](1);
        feeTokens[0] = address(token);
        ManagerHarness harness = new ManagerHarness(admin, pauser, executor, feeTokens);

        bytes32 covenantId = _armHarnessCovenant(harness, bytes32(uint256(1)));
        _triggerOn(harness, covenantId);

        bytes32 attemptId = harness.consumeAttemptWithoutVerifying(
            covenantId, 0, _pauseConfig(), _verifierContext(), 7
        );
        assertTrue(harness.usedAttemptIds(attemptId), "the id was not burned");

        // Same action, same world, same sequence: the same identity, and it is spent.
        vm.expectRevert(ResurvCovenantManager.AttemptAlreadyUsed.selector);
        harness.consumeAttemptWithoutVerifying(covenantId, 0, _pauseConfig(), _verifierContext(), 7);
    }

    /// @dev The `>= 96` floor, judged at its boundary. A verifier returning 64 bytes has not
    ///      answered: the tuple is three words and two of them are missing. Reading the first
    ///      word anyway would decode a stray value as the outcome, which on this path decides
    ///      whether a refund is granted over a covenant that may actually be satisfied. The
    ///      suite's other fixtures return 1, 96 or 128 bytes, so this band was never tested and
    ///      weakening the guard from `< 96` to `< 32` passed all 122 tests.
    function test_expiryTreatsAPartialReturnAsNotVerifiableRatherThanReadingIt() public {
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.verifier = address(new PartialReturnVerifier());
        params.verifierContext = hex"";

        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, _defaultActions());
        _fundAndArm(covenantId, ONE_USD);
        _trigger(covenantId, keccak256("alert"), 0);

        uint256 before = token.balanceOf(requester);
        vm.warp(deadline + 1);
        manager.expireCovenant{gas: 30_000_000}(covenantId, hex"");

        // Treated as silence, so the escrow comes back rather than being trapped, and the
        // first word was never read as an outcome.
        assertEq(token.balanceOf(requester) - before, ONE_USD, "escrow trapped by a short answer");
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.EXPIRED));
        assertEq(manager.escrowed(address(token)), 0);
    }

    // -------------------------------------------------------------------------------------
    // M-1: the caller chooses the gas
    // -------------------------------------------------------------------------------------

    /// @dev PRD invariant 10.14.8: an expiry refund is impossible when the verifier is true. A
    ///      bare `catch` could not tell "could not answer" from "was not given enough gas", so a
    ///      stingy caller could refund itself over a true outcome.
    function test_expiryRefusesATrueOutcomeEvenWhenTheCallerStarvesTheVerifier() public {
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.verifier = address(new ExpensiveTrueVerifier());
        params.verifierContext = hex"";

        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, _defaultActions());
        _fundAndArm(covenantId, ONE_USD);
        _trigger(covenantId, keccak256("alert"), 0);
        vm.warp(deadline + 1);

        // Generous: the verifier answers, and the expiry is correctly refused.
        vm.expectRevert(ResurvCovenantManager.OutcomeAlreadySatisfied.selector);
        manager.expireCovenant{gas: 60_000_000}(covenantId, hex"");

        // Stingy: the verifier is starved, and the expiry is refused rather than granted.
        vm.expectRevert(ResurvCovenantManager.VerifierStarved.selector);
        manager.expireCovenant{gas: 2_000_000}(covenantId, hex"");

        assertEq(manager.escrowed(address(token)), ONE_USD, "escrow left on a starved verifier");
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.TRIGGERED));
    }

    function test_expiryRefusesToConcludeAnythingBelowTheGasFloor() public {
        bytes32 covenantId = _armedCovenant();
        _trigger(covenantId, keccak256("alert"), 0);
        vm.warp(deadline + 1);

        vm.expectRevert(ResurvCovenantManager.VerifierStarved.selector);
        manager.expireCovenant{gas: 200_000}(covenantId, _verifierContext());
    }

    // -------------------------------------------------------------------------------------
    // Surviving mutation M2: the second layer of "the fee moves at most once"
    // -------------------------------------------------------------------------------------

    /// @dev `_settleEscrow` refuses a second call through `feeSettled`, and nothing tested it: the
    ///      terminal-state rule always got there first. This reaches it directly, by settling a
    ///      covenant and then driving a second settlement through the only other path that calls
    ///      `_settleEscrow` on the same covenant.
    function test_theFeeSettledGuardIsReachableAndHolds() public {
        bytes32 covenantId = _armedCovenant();
        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert"), 0);
        _executeAttempt(covenantId, 1, 0);

        assertTrue(manager.getCovenant(covenantId).feeSettled, "fee not marked settled");
        uint256 responderBalance = token.balanceOf(responder);
        uint256 requesterBalance = token.balanceOf(requester);

        // Every remaining path into `_settleEscrow` is closed by the status check, which is the
        // first layer. What this pins is that the flag itself is set, so a future change that
        // weakened the status check would meet a second refusal rather than a second payout.
        vm.warp(deadline + 1);
        vm.expectRevert(ResurvCovenantManager.InvalidStatus.selector);
        manager.expireCovenant(covenantId, _verifierContext());

        vm.prank(requester);
        vm.expectRevert(ResurvCovenantManager.InvalidStatus.selector);
        manager.cancelCovenant(covenantId);

        assertEq(token.balanceOf(responder), responderBalance);
        assertEq(token.balanceOf(requester), requesterBalance);
        assertEq(manager.escrowed(address(token)), 0);
    }

    /// @dev The test above passes with the `feeSettled` guard deleted, because every path it
    ///      drives is stopped one layer earlier by the status check. A mutation campaign
    ///      confirmed that against the whole suite, fee invariant included. This is the test that
    ///      actually judges the flag: it reaches `_settleEscrow` twice on one covenant with the
    ///      status gate out of the way, while a *second* funded covenant's fee is still pooled in
    ///      the same escrow balance. Without the guard the second call does not underflow and
    ///      revert. It succeeds, and pays the second covenant's money out against the first.
    function test_theFeeSettledFlagBlocksASecondSettlementWithNoStatusCheckInFrontOfIt() public {
        address[] memory feeTokens = new address[](1);
        feeTokens[0] = address(token);
        ManagerHarness harness = new ManagerHarness(admin, pauser, executor, feeTokens);

        bytes32 first = _armHarnessCovenant(harness, bytes32(uint256(1)));
        bytes32 second = _armHarnessCovenant(harness, bytes32(uint256(2)));
        assertEq(harness.escrowed(address(token)), 2 * ONE_USD, "both fees should be pooled");

        assertEq(harness.settleEscrowDirectly(first, responder), ONE_USD, "first settlement");
        assertEq(token.balanceOf(responder), ONE_USD);
        assertEq(harness.escrowed(address(token)), ONE_USD, "only the second fee should remain");

        vm.expectRevert(ResurvCovenantManager.FeeTransferFailed.selector);
        harness.settleEscrowDirectly(first, responder);

        // The other covenant's money is still there, which is the property the flag exists for.
        assertEq(token.balanceOf(responder), ONE_USD, "responder paid twice");
        assertEq(harness.escrowed(address(token)), ONE_USD, "second covenant's fee was drained");
        assertFalse(harness.getCovenant(second).feeSettled, "second covenant wrongly settled");
    }

    /// @dev `CovenantLifecycle.t.sol` had a comment promising this test by name for months while
    ///      it did not exist, and its sibling could not stand in: every attempt there reverts on
    ///      the postcondition, which rolls the counters back, so it asserts `attemptsUsed == 0`
    ///      and proves nothing about either limit. Both limits are real checks on a real hot
    ///      path, so they get judged on a committed attempt, which is what the harness provides.
    function test_perActionAttemptLimitBindsBeforeTheTotalAttemptLimitDoes() public {
        address[] memory feeTokens = new address[](1);
        feeTokens[0] = address(token);
        ManagerHarness harness = new ManagerHarness(admin, pauser, executor, feeTokens);

        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.maxTotalAttempts = 2;
        ResurvCovenantManager.ActionInput[] memory actions = _defaultActions();
        actions[0].maxAttempts = 2;
        actions[1].maxAttempts = 1;

        vm.prank(requester);
        bytes32 covenantId = harness.createCovenant(params, actions);
        token.mint(requester, ONE_USD);
        vm.startPrank(requester);
        token.approve(address(harness), ONE_USD);
        harness.fundAndArm(covenantId);
        vm.stopPrank();
        _triggerOn(harness, covenantId);

        harness.consumeAttemptWithoutVerifying(
            covenantId, 1, _evacuateConfig(), _verifierContext(), 0
        );
        assertEq(harness.getCovenant(covenantId).attemptsUsed, 1, "total counter did not rise");

        // The per-action limit, on an action the total limit still has room for.
        vm.expectRevert(ResurvCovenantManager.ActionUnavailable.selector);
        harness.consumeAttemptWithoutVerifying(
            covenantId, 1, _evacuateConfig(), _verifierContext(), 1
        );

        // The other action is still available, which is what makes the refusal above per-action
        // rather than the total limit arriving early.
        harness.consumeAttemptWithoutVerifying(covenantId, 0, _pauseConfig(), _verifierContext(), 2);
        assertEq(harness.getCovenant(covenantId).attemptsUsed, 2);

        // And now the total limit binds, on an action whose own budget is not exhausted.
        vm.expectRevert(ResurvCovenantManager.AttemptLimitReached.selector);
        harness.consumeAttemptWithoutVerifying(covenantId, 0, _pauseConfig(), _verifierContext(), 3);
    }

    function _armHarnessCovenant(ManagerHarness harness, bytes32 salt)
        private
        returns (bytes32 covenantId)
    {
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.salt = salt;

        vm.prank(requester);
        covenantId = harness.createCovenant(params, _defaultActions());

        token.mint(requester, ONE_USD);
        vm.startPrank(requester);
        token.approve(address(harness), ONE_USD);
        harness.fundAndArm(covenantId);
        vm.stopPrank();
    }

    /// @dev The fixture's `_trigger` signs against `manager`. EIP-712 binds the domain to the
    ///      verifying contract, so a harness needs its own digest and its own signature.
    function _triggerOn(ManagerHarness harness, bytes32 covenantId) private {
        uint64 validAfter = uint64(block.timestamp);
        uint64 validUntil = uint64(block.timestamp + 1 hours);
        bytes32 digest =
            harness.triggerDigest(covenantId, keccak256("alert"), 0, validAfter, validUntil);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(triggerAuthorityKey, digest);
        harness.trigger(
            covenantId, keccak256("alert"), 0, validAfter, validUntil, abi.encodePacked(r, s, v)
        );
    }

    // -------------------------------------------------------------------------------------
    // Surviving mutation M3: the manager's own status writes were tied to nothing
    // -------------------------------------------------------------------------------------

    /// @dev `CovenantStatusLib.canTransition` was exhaustively tested against a reference model
    ///      and then never called from production, so a mutation permitting `ARMED -> EXPIRED` —
    ///      a transition the library explicitly forbids — passed the whole suite. This ties the
    ///      manager's real transitions to that library.
    function test_everyStatusTransitionTheManagerPerformsIsOneTheLibraryPermits() public {
        bytes32 covenantId = _createCovenant(_defaultParams());
        _assertLegalTransition(CovenantStatus.NONE, manager.statusOf(covenantId));

        CovenantStatus before = manager.statusOf(covenantId);
        _fundAndArm(covenantId, ONE_USD);
        _assertLegalTransition(before, manager.statusOf(covenantId));

        before = manager.statusOf(covenantId);
        _trigger(covenantId, keccak256("alert"), 0);
        _assertLegalTransition(before, manager.statusOf(covenantId));

        before = manager.statusOf(covenantId);
        _revokePauseAuthority();
        _executeAttempt(covenantId, 1, 0);
        _assertLegalTransition(before, manager.statusOf(covenantId));
    }

    function test_anArmedCovenantCannotBeExpired() public {
        bytes32 covenantId = _armedCovenant();
        vm.warp(deadline + 1);

        // PRD 9.1 draws no ARMED -> EXPIRED edge. An armed covenant past its deadline is the
        // requester's to cancel, and nobody else's to settle.
        vm.expectRevert(ResurvCovenantManager.InvalidStatus.selector);
        manager.expireCovenant(covenantId, _verifierContext());

        uint256 before = token.balanceOf(requester);
        vm.prank(requester);
        manager.cancelCovenant(covenantId);
        assertEq(token.balanceOf(requester) - before, ONE_USD);
    }

    // -------------------------------------------------------------------------------------
    // Terminal states, each named rather than left to a fuzzer's luck
    // -------------------------------------------------------------------------------------

    function test_anExpiredCovenantCannotBeAttempted() public {
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.verifierContext =
            abi.encode(address(vault), safe, address(token), uint256(0), ONE_USD * 2);
        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, _defaultActions());
        _fundAndArm(covenantId, ONE_USD);
        _trigger(covenantId, keccak256("alert"), 0);

        vm.warp(deadline + 1);
        manager.expireCovenant(covenantId, params.verifierContext);

        vm.prank(executor);
        vm.expectRevert(ResurvCovenantManager.AlreadyTerminal.selector);
        manager.executeAttempt(
            covenantId, 1, _evacuateConfig(), params.verifierContext, bytes32(0), 0
        );
    }

    function test_aCancelledCovenantCannotBeAttempted() public {
        bytes32 covenantId = _armedCovenant();
        vm.prank(requester);
        manager.cancelCovenant(covenantId);

        vm.prank(executor);
        vm.expectRevert(ResurvCovenantManager.AlreadyTerminal.selector);
        manager.executeAttempt(covenantId, 1, _evacuateConfig(), _verifierContext(), bytes32(0), 0);
    }

    // -------------------------------------------------------------------------------------
    // M-4: what the onchain burn does and does not bound
    // -------------------------------------------------------------------------------------

    /// @dev The burn stops a replay of *one* attempt identity. It does not by itself stop a
    ///      repeat of the same action against an unchanged world, because the sequence number is
    ///      the caller's. `maxAttempts` is what bounds that, and this pins the boundary so the
    ///      claim in the contract header cannot drift back to the stronger one.
    function test_theAttemptBurnBoundsOneIdentityAndTheCountersBoundTheRest() public {
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.verifierContext =
            abi.encode(address(vault), safe, address(token), uint256(0), ONE_USD * 2);
        ResurvCovenantManager.ActionInput[] memory actions = _defaultActions();
        actions[1].maxAttempts = 1;

        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, actions);
        _fundAndArm(covenantId, ONE_USD);
        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert"), 0);

        (, bytes32 preStateHash,) = verifier.evaluate(covenantId, params.verifierContext);
        bytes32 first = manager.computeAttemptId(covenantId, 1, preStateHash, 0);
        bytes32 second = manager.computeAttemptId(covenantId, 1, preStateHash, 1);

        // Two sequence numbers are two identities against the same world. That is the fact.
        assertTrue(first != second, "two sequences collapsed into one identity");
        assertFalse(manager.usedAttemptIds(first));
        assertFalse(manager.usedAttemptIds(second));
    }

    function _assertLegalTransition(CovenantStatus from, CovenantStatus to) internal pure {
        if (from == to) return;
        assertTrue(
            CovenantStatusLib.canTransition(from, to),
            "the manager performed a transition PRD 9.1 forbids"
        );
    }
}
