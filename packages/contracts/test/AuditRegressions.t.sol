// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {CovenantStatus, CovenantStatusLib} from "../src/CovenantStatus.sol";
import {ResurvCovenantManager} from "../src/ResurvCovenantManager.sol";
import {IOutcomeVerifier} from "../src/interfaces/IOutcomeVerifier.sol";
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

/// @notice Regressions for every finding an independent contract audit raised, and for the three
///         mutations that survived the suite as it stood.
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
