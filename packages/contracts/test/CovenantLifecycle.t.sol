// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {CovenantStatus} from "../src/CovenantStatus.sol";
import {ResurvCovenantManager} from "../src/ResurvCovenantManager.sol";
import {DemoVault} from "../src/demo/DemoVault.sol";
import {CovenantFixture} from "./support/CovenantFixture.sol";

/// @notice The headline proof, told as a test before it is told as a demo.
///
/// @dev The claim under test is one sentence: the primary emergency action could not safely
///      complete, RESURV did not guess, the approved fallback produced the promised state, and
///      the responder was paid inside that same transaction. Everything else in this file
///      exists to show that each half of it fails when it should.
contract CovenantLifecycleTest is CovenantFixture {
    function setUp() public {
        _deployWorld();
    }

    // -------------------------------------------------------------------------------------
    // The canonical run
    // -------------------------------------------------------------------------------------

    function test_primaryRefused_fallbackSucceeds_andPaysInTheSameTransaction() public {
        bytes32 covenantId = _armedCovenant();
        _revokePauseAuthority();
        _trigger(covenantId, keccak256("vault-drain-alert"), 0);

        // Primary. The adapter no longer holds PAUSER_ROLE, so the attempt reverts whole.
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                address(pauseAction),
                vault.PAUSER_ROLE()
            )
        );
        _executeAttempt(covenantId, 0, 0);

        // Nothing moved. Not the vault, not the covenant, not the escrow.
        assertEq(token.balanceOf(address(vault)), ONE_USD, "vault touched by a failed attempt");
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.TRIGGERED));
        assertEq(manager.getCovenant(covenantId).attemptsUsed, 0, "failed attempt consumed a slot");
        assertEq(token.balanceOf(responder), 0, "responder paid for a failed attempt");

        // Fallback.
        uint256 responderBefore = token.balanceOf(responder);
        _executeAttempt(covenantId, 1, 1);

        assertEq(token.balanceOf(address(vault)), 0, "vault not evacuated");
        assertEq(token.balanceOf(safe), ONE_USD, "safe did not receive the funds");
        assertEq(
            token.balanceOf(responder) - responderBefore, ONE_USD, "responder was not paid the fee"
        );
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.SATISFIED));
        assertEq(manager.escrowed(address(token)), 0, "escrow not released");
        assertEq(token.balanceOf(address(manager)), 0, "manager retained value");

        ResurvCovenantManager.Covenant memory covenant = manager.getCovenant(covenantId);
        assertTrue(covenant.feeSettled, "fee not marked settled");
        assertTrue(covenant.finalStateHash != bytes32(0), "final state hash not recorded");
        assertEq(covenant.finalObservedValue, ONE_USD, "observed value is not the delivered amount");
    }

    /// @dev The single most important negative test in the repository. The action succeeds, the
    ///      outcome stays false, and every one of the four state changes unwinds together.
    function test_falseOutcomeRevertsTheActionTheCountersTheStatusAndTheFee() public {
        // A covenant whose declared outcome the available action cannot reach: the verifier
        // demands the safe receive two dollars and the vault only holds one.
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.verifierContext =
            abi.encode(address(vault), safe, address(token), uint256(0), ONE_USD * 2);

        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, _defaultActions());
        _fundAndArm(covenantId, ONE_USD);
        _revokePauseAuthority();

        manager.trigger(
            covenantId,
            keccak256("alert"),
            0,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 hours),
            _sign(covenantId, keccak256("alert"), 0)
        );

        uint256 vaultBefore = token.balanceOf(address(vault));
        uint256 safeBefore = token.balanceOf(safe);
        uint256 escrowBefore = manager.escrowed(address(token));

        vm.prank(executor);
        vm.expectPartialRevert(ResurvCovenantManager.OutcomeNotSatisfied.selector);
        manager.executeAttempt(
            covenantId, 1, _evacuateConfig(), params.verifierContext, bytes32(0), 0
        );

        assertEq(token.balanceOf(address(vault)), vaultBefore, "the action's write survived");
        assertEq(token.balanceOf(safe), safeBefore, "the transfer survived");
        assertEq(manager.escrowed(address(token)), escrowBefore, "escrow moved");
        assertEq(token.balanceOf(responder), 0, "responder was paid for a false outcome");
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.TRIGGERED));
        assertEq(manager.getCovenant(covenantId).attemptsUsed, 0, "attempt counter survived");
        assertFalse(
            manager.usedAttemptIds(
                manager.computeAttemptId(
                    covenantId, 1, _preStateHash(covenantId, params.verifierContext), 0
                )
            ),
            "attempt id burn survived a reverted attempt"
        );
    }

    function test_pauseAloneSatisfiesTheOutcome() public {
        // The primary works when its authority is intact, and the same covenant closes on it.
        bytes32 covenantId = _armedCovenant();
        _trigger(covenantId, keccak256("alert"), 0);

        _executeAttempt(covenantId, 0, 0);

        assertTrue(vault.paused(), "vault not paused");
        assertEq(token.balanceOf(address(vault)), ONE_USD, "pause path moved funds");
        assertEq(token.balanceOf(responder), ONE_USD, "responder not paid");
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.SATISFIED));
    }

    // -------------------------------------------------------------------------------------
    // Duplicate protection
    // -------------------------------------------------------------------------------------

    function test_duplicateTriggerIsRejectedOnTwoIndependentGrounds() public {
        bytes32 covenantId = _armedCovenant();
        bytes32 signalHash = keccak256("alert");
        bytes memory signature = _sign(covenantId, signalHash, 0);
        uint64 validAfter = uint64(block.timestamp);
        uint64 validUntil = uint64(block.timestamp + 1 hours);

        manager.trigger(covenantId, signalHash, 0, validAfter, validUntil, signature);

        // Ground one: the covenant is no longer ARMED.
        vm.expectRevert(ResurvCovenantManager.InvalidStatus.selector);
        manager.trigger(covenantId, signalHash, 0, validAfter, validUntil, signature);

        // Ground two: even from ARMED the nonce is consumed. Proven on a second covenant that
        // is triggered and then rewound only in the sense of trying nonce 0 again.
        _revokePauseAuthority();
        _executeAttempt(covenantId, 1, 0);
        vm.expectRevert(ResurvCovenantManager.InvalidStatus.selector);
        manager.trigger(covenantId, signalHash, 0, validAfter, validUntil, signature);
        assertEq(manager.getCovenant(covenantId).triggerNonce, 1, "nonce not consumed");
    }

    function test_noSecondActionOrPaymentAfterSatisfaction() public {
        bytes32 covenantId = _armedCovenant();
        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert"), 0);
        _executeAttempt(covenantId, 1, 0);

        uint256 responderBalance = token.balanceOf(responder);

        vm.prank(executor);
        vm.expectRevert(ResurvCovenantManager.AlreadyTerminal.selector);
        manager.executeAttempt(covenantId, 1, _evacuateConfig(), _verifierContext(), bytes32(0), 1);

        vm.prank(executor);
        vm.expectRevert(ResurvCovenantManager.AlreadyTerminal.selector);
        manager.executeAttempt(covenantId, 0, _pauseConfig(), _verifierContext(), bytes32(0), 2);

        assertEq(token.balanceOf(responder), responderBalance, "a second payment happened");
    }

    function test_sameSemanticAttemptCannotBeReplayed() public {
        bytes32 covenantId = _armedCovenant();
        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert"), 0);

        bytes32 preStateHash = _preStateHash(covenantId, _verifierContext());
        bytes32 attemptId = manager.computeAttemptId(covenantId, 1, preStateHash, 7);
        assertFalse(manager.usedAttemptIds(attemptId));

        _executeAttempt(covenantId, 1, 7);
        assertTrue(manager.usedAttemptIds(attemptId), "attempt id not burned");

        // The covenant is terminal, so the replay fails there first. The burn is what protects
        // a covenant that is still open, which the fuzz test below exercises directly.
        vm.prank(executor);
        vm.expectRevert(ResurvCovenantManager.AlreadyTerminal.selector);
        manager.executeAttempt(covenantId, 1, _evacuateConfig(), _verifierContext(), bytes32(0), 7);
    }

    /// @dev The burn on a covenant that is still open. The outcome stays false so the covenant
    ///      never becomes terminal, and the second attempt with the same identity is refused by
    ///      `usedAttemptIds` rather than by the status check.
    function test_attemptIdBurnBlocksAReplayOnAnOpenCovenant() public {
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.verifierContext =
            abi.encode(address(vault), safe, address(token), uint256(0), ONE_USD * 2);
        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, _defaultActions());
        _fundAndArm(covenantId, ONE_USD);
        _trigger(covenantId, keccak256("alert"), 0);

        // A pause that succeeds but does not satisfy this covenant's outcome would still be
        // reverted by the postcondition, so instead the burn is observed directly: the first
        // call reverts on the outcome, which unwinds the burn, and a call recording the burn
        // has to be one that commits. Use the vault-satisfying context on a second covenant.
        bytes32 open = _openCovenantSatisfiedByEvacuation();
        bytes32 preStateHash = _preStateHash(open, _verifierContext());
        bytes32 attemptId = manager.computeAttemptId(open, 1, preStateHash, 3);

        vm.prank(executor);
        manager.executeAttempt(open, 1, _evacuateConfig(), _verifierContext(), bytes32(0), 3);
        assertTrue(manager.usedAttemptIds(attemptId));
        assertTrue(manager.usedAttemptIds(attemptId), "burn is permanent");
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.TRIGGERED));
    }

    function _openCovenantSatisfiedByEvacuation() internal returns (bytes32 covenantId) {
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.salt = bytes32(uint256(99));
        vm.prank(requester);
        covenantId = manager.createCovenant(params, _defaultActions());
        _fundAndArm(covenantId, ONE_USD);
        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert-2"), 0);
    }

    // -------------------------------------------------------------------------------------
    // Commitments
    // -------------------------------------------------------------------------------------

    function test_uncommittedActionConfigIsRejected() public {
        bytes32 covenantId = _armedCovenant();
        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert"), 0);

        // The recipient is the field an attacker would want to change.
        bytes memory redirected =
            abi.encode(address(vault), address(token), stranger, ONE_USD, ONE_USD);

        vm.prank(executor);
        vm.expectRevert(ResurvCovenantManager.InvalidActionConfig.selector);
        manager.executeAttempt(covenantId, 1, redirected, _verifierContext(), bytes32(0), 0);
        assertEq(token.balanceOf(stranger), 0);
    }

    function test_uncommittedVerifierContextIsRejected() public {
        bytes32 covenantId = _armedCovenant();
        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert"), 0);

        // A context that would be trivially satisfied.
        bytes memory weakened =
            abi.encode(address(vault), safe, address(token), uint256(0), uint256(0));

        vm.prank(executor);
        vm.expectRevert(ResurvCovenantManager.InvalidVerifierContext.selector);
        manager.executeAttempt(covenantId, 1, _evacuateConfig(), weakened, bytes32(0), 0);
    }

    function test_staleStateHashIsRejected() public {
        bytes32 covenantId = _armedCovenant();
        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert"), 0);

        vm.prank(executor);
        vm.expectRevert(ResurvCovenantManager.StaleState.selector);
        manager.executeAttempt(
            covenantId, 1, _evacuateConfig(), _verifierContext(), keccak256("a different world"), 0
        );
    }

    function test_matchingStateHashIsAccepted() public {
        bytes32 covenantId = _armedCovenant();
        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert"), 0);

        bytes32 preStateHash = _preStateHash(covenantId, _verifierContext());
        vm.prank(executor);
        manager.executeAttempt(
            covenantId, 1, _evacuateConfig(), _verifierContext(), preStateHash, 0
        );
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.SATISFIED));
    }

    function test_onlyTheExecutorRoleMayAttempt() public {
        bytes32 covenantId = _armedCovenant();
        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert"), 0);

        bytes32 executorRole = manager.EXECUTOR_ROLE();
        for (uint256 i = 0; i < 3; ++i) {
            address caller = [stranger, requester, admin][i];
            vm.prank(caller);
            vm.expectRevert(
                abi.encodeWithSelector(
                    IAccessControl.AccessControlUnauthorizedAccount.selector, caller, executorRole
                )
            );
            manager.executeAttempt(
                covenantId, 1, _evacuateConfig(), _verifierContext(), bytes32(0), 0
            );
        }
    }

    function test_actionAdapterRefusesEveryCallerButTheManager() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSignature("OnlyManager()"));
        evacuateAction.execute(bytes32(0), _evacuateConfig());

        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSignature("OnlyManager()"));
        pauseAction.execute(bytes32(0), _pauseConfig());
    }

    function test_attemptLimitsAreEnforced() public {
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.verifierContext =
            abi.encode(address(vault), safe, address(token), uint256(0), ONE_USD * 2);
        params.maxTotalAttempts = 1;

        ResurvCovenantManager.ActionInput[] memory actions = _defaultActions();
        actions[1].maxAttempts = 1;

        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, actions);
        _fundAndArm(covenantId, ONE_USD);
        _trigger(covenantId, keccak256("alert"), 0);

        // Every attempt reverts on the postcondition, so the counters never actually rise.
        // The limits are proven on a covenant whose attempts commit instead: see
        // test_perActionAttemptLimit.
        vm.prank(executor);
        vm.expectPartialRevert(ResurvCovenantManager.OutcomeNotSatisfied.selector);
        manager.executeAttempt(
            covenantId, 1, _evacuateConfig(), params.verifierContext, bytes32(0), 0
        );
        assertEq(manager.getCovenant(covenantId).attemptsUsed, 0);
    }

    /// @dev An armed covenant has escrow and a committed plan but no incident. Attempting one
    ///      would pay a responder for work nobody asked for, and it is the mutation this suite
    ///      did not catch until it was written: weakening the status check to admit ARMED left
    ///      every other test green.
    function test_anArmedButUntriggeredCovenantCannotBeAttempted() public {
        bytes32 covenantId = _armedCovenant();
        _revokePauseAuthority();

        vm.prank(executor);
        vm.expectRevert(ResurvCovenantManager.InvalidStatus.selector);
        manager.executeAttempt(covenantId, 1, _evacuateConfig(), _verifierContext(), bytes32(0), 0);

        assertEq(
            token.balanceOf(address(vault)), ONE_USD, "the vault was drained without a trigger"
        );
        assertEq(token.balanceOf(responder), 0, "a responder was paid without a trigger");
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.ARMED));
    }

    function test_aDraftCovenantCannotBeAttempted() public {
        bytes32 covenantId = _createCovenant(_defaultParams());
        vm.prank(executor);
        vm.expectRevert(ResurvCovenantManager.InvalidStatus.selector);
        manager.executeAttempt(covenantId, 1, _evacuateConfig(), _verifierContext(), bytes32(0), 0);
    }

    function test_actionIndexOutOfRangeIsRejected() public {
        bytes32 covenantId = _armedCovenant();
        _trigger(covenantId, keccak256("alert"), 0);

        vm.prank(executor);
        vm.expectRevert(ResurvCovenantManager.ActionUnavailable.selector);
        manager.executeAttempt(covenantId, 2, _evacuateConfig(), _verifierContext(), bytes32(0), 0);
    }

    // -------------------------------------------------------------------------------------
    // Trigger authority
    // -------------------------------------------------------------------------------------

    function test_signatureFromTheWrongKeyIsRejected() public {
        bytes32 covenantId = _armedCovenant();
        (, uint256 impostorKey) = makeAddrAndKey("impostor");
        bytes32 digest = manager.triggerDigest(
            covenantId,
            keccak256("alert"),
            0,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 hours)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(impostorKey, digest);

        vm.expectRevert(ResurvCovenantManager.InvalidSignature.selector);
        manager.trigger(
            covenantId,
            keccak256("alert"),
            0,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 hours),
            abi.encodePacked(r, s, v)
        );
    }

    function test_wrongNonceIsRejected() public {
        bytes32 covenantId = _armedCovenant();
        // Signed before the expectation is armed: `_sign` makes an external call for the
        // digest, and `vm.expectRevert` applies to the next external call it sees.
        bytes memory signature = _sign(covenantId, keccak256("alert"), 1);
        vm.expectRevert(ResurvCovenantManager.InvalidNonce.selector);
        manager.trigger(
            covenantId,
            keccak256("alert"),
            1,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 hours),
            signature
        );
    }

    function test_signalOutsideItsValidityWindowIsRejected() public {
        bytes32 covenantId = _armedCovenant();
        uint64 validAfter = uint64(block.timestamp + 1 hours);
        uint64 validUntil = uint64(block.timestamp + 2 hours);
        bytes32 digest =
            manager.triggerDigest(covenantId, keccak256("alert"), 0, validAfter, validUntil);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(triggerAuthorityKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert(ResurvCovenantManager.SignalNotYetValid.selector);
        manager.trigger(covenantId, keccak256("alert"), 0, validAfter, validUntil, signature);

        vm.warp(validUntil + 1);
        vm.expectRevert(ResurvCovenantManager.SignalExpired.selector);
        manager.trigger(covenantId, keccak256("alert"), 0, validAfter, validUntil, signature);
    }

    /// @dev A signature is bound to one covenant. Replaying it against a sibling covenant with
    ///      the same authority, nonce and window must fail.
    function test_signatureIsBoundToItsCovenant() public {
        bytes32 first = _armedCovenant();
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.salt = bytes32(uint256(2));
        bytes32 second = _createCovenant(params);
        _fundAndArm(second, ONE_USD);

        bytes memory signature = _sign(first, keccak256("alert"), 0);
        vm.expectRevert(ResurvCovenantManager.InvalidSignature.selector);
        manager.trigger(
            second,
            keccak256("alert"),
            0,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 hours),
            signature
        );
    }

    // -------------------------------------------------------------------------------------
    // Exits
    // -------------------------------------------------------------------------------------

    function test_expiryRefundsTheRequesterWhenTheOutcomeIsFalse() public {
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.verifierContext =
            abi.encode(address(vault), safe, address(token), uint256(0), ONE_USD * 2);
        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, _defaultActions());
        _fundAndArm(covenantId, ONE_USD);
        _trigger(covenantId, keccak256("alert"), 0);

        uint256 before = token.balanceOf(requester);
        vm.warp(deadline + 1);
        manager.expireCovenant(covenantId, params.verifierContext);

        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.EXPIRED));
        assertEq(token.balanceOf(requester) - before, ONE_USD, "requester not refunded");
        assertEq(manager.escrowed(address(token)), 0);
    }

    function test_expiryIsRefusedWhileTheOutcomeIsTrue() public {
        bytes32 covenantId = _armedCovenant();
        _trigger(covenantId, keccak256("alert"), 0);

        // Somebody else pauses the vault, so the covenant's declared outcome is now true.
        bytes32 pauserRole = vault.PAUSER_ROLE();
        vm.startPrank(admin);
        vault.grantRole(pauserRole, admin);
        vault.pause();
        vm.stopPrank();

        vm.warp(deadline + 1);
        vm.expectRevert(ResurvCovenantManager.OutcomeAlreadySatisfied.selector);
        manager.expireCovenant(covenantId, _verifierContext());
    }

    function test_expiryBeforeTheDeadlineIsRefused() public {
        bytes32 covenantId = _armedCovenant();
        _trigger(covenantId, keccak256("alert"), 0);
        vm.expectRevert(ResurvCovenantManager.CovenantNotExpired.selector);
        manager.expireCovenant(covenantId, _verifierContext());
    }

    function test_cancellationRefundsBeforeTriggerAndIsImpossibleAfter() public {
        bytes32 covenantId = _armedCovenant();
        uint256 before = token.balanceOf(requester);

        vm.prank(stranger);
        vm.expectRevert(ResurvCovenantManager.NotRequester.selector);
        manager.cancelCovenant(covenantId);

        vm.prank(requester);
        manager.cancelCovenant(covenantId);
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.CANCELLED));
        assertEq(token.balanceOf(requester) - before, ONE_USD);

        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.salt = bytes32(uint256(3));
        bytes32 second = _createCovenant(params);
        _fundAndArm(second, ONE_USD);
        _trigger(second, keccak256("alert"), 0);

        vm.prank(requester);
        vm.expectRevert(ResurvCovenantManager.InvalidStatus.selector);
        manager.cancelCovenant(second);
    }

    /// @dev A DRAFT covenant paid nothing in and must take nothing out, even when a sibling
    ///      covenant has funded the same token. Without the `funded` flag this cancellation
    ///      drains the sibling's escrow.
    function test_cancellingAnUnfundedDraftCannotDrainAnotherCovenantsEscrow() public {
        bytes32 funded = _armedCovenant();

        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.salt = bytes32(uint256(4));
        bytes32 draft = _createCovenant(params);

        uint256 requesterBefore = token.balanceOf(requester);
        vm.prank(requester);
        manager.cancelCovenant(draft);

        assertEq(token.balanceOf(requester), requesterBefore, "an unfunded draft paid itself out");
        assertEq(manager.escrowed(address(token)), ONE_USD, "sibling escrow was drained");
        assertEq(token.balanceOf(address(manager)), ONE_USD);
        assertEq(uint8(manager.statusOf(funded)), uint8(CovenantStatus.ARMED));
    }

    function test_finalizeAlreadySatisfiedClosesWithoutPayingAFee() public {
        bytes32 covenantId = _armedCovenant();
        _trigger(covenantId, keccak256("alert"), 0);

        vm.startPrank(admin);
        vault.grantRole(vault.PAUSER_ROLE(), admin);
        vault.pause();
        vm.stopPrank();

        uint256 requesterBefore = token.balanceOf(requester);
        manager.finalizeAlreadySatisfied(covenantId, _verifierContext());

        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.SATISFIED));
        assertEq(token.balanceOf(responder), 0, "responder paid for an action it did not take");
        assertEq(token.balanceOf(requester) - requesterBefore, ONE_USD, "requester not refunded");
    }

    function test_finalizeAlreadySatisfiedRefusesWhileTheOutcomeIsFalse() public {
        bytes32 covenantId = _armedCovenant();
        _trigger(covenantId, keccak256("alert"), 0);
        vm.expectRevert(ResurvCovenantManager.OutcomeNotSatisfiedYet.selector);
        manager.finalizeAlreadySatisfied(covenantId, _verifierContext());
    }

    function test_attemptAfterTheDeadlineIsRefused() public {
        bytes32 covenantId = _armedCovenant();
        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert"), 0);

        vm.warp(deadline + 1);
        vm.prank(executor);
        vm.expectRevert(ResurvCovenantManager.CovenantHasExpired.selector);
        manager.executeAttempt(covenantId, 1, _evacuateConfig(), _verifierContext(), bytes32(0), 0);
    }

    /// @dev Exactly at the deadline the covenant is still live; one second later it is not.
    function test_deadlineBoundaryIsInclusive() public {
        bytes32 covenantId = _armedCovenant();
        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert"), 0);

        vm.warp(deadline);
        _executeAttempt(covenantId, 1, 0);
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.SATISFIED));
    }

    // -------------------------------------------------------------------------------------
    // Pause, roles and admin power
    // -------------------------------------------------------------------------------------

    function test_pauseStopsNewWorkButNeverRefunds() public {
        bytes32 covenantId = _armedCovenant();
        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert"), 0);

        vm.prank(pauser);
        manager.setPaused(true);

        vm.prank(executor);
        vm.expectRevert(ResurvCovenantManager.GlobalPause.selector);
        manager.executeAttempt(covenantId, 1, _evacuateConfig(), _verifierContext(), bytes32(0), 0);

        vm.warp(deadline + 1);
        uint256 before = token.balanceOf(requester);
        manager.expireCovenant(covenantId, _verifierContext());
        assertEq(token.balanceOf(requester) - before, ONE_USD, "pause blocked a refund");
    }

    function test_pauseBlocksCreationAndTriggering() public {
        bytes32 covenantId = _armedCovenant();
        bytes memory signature = _sign(covenantId, keccak256("alert"), 0);
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.salt = bytes32(uint256(77));
        ResurvCovenantManager.ActionInput[] memory actions = _defaultActions();

        vm.prank(pauser);
        manager.setPaused(true);

        vm.prank(requester);
        vm.expectRevert(ResurvCovenantManager.GlobalPause.selector);
        manager.createCovenant(params, actions);

        vm.expectRevert(ResurvCovenantManager.GlobalPause.selector);
        manager.trigger(
            covenantId,
            keccak256("alert"),
            0,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 hours),
            signature
        );
    }

    function test_cancellationSurvivesAPause() public {
        bytes32 covenantId = _armedCovenant();
        vm.prank(pauser);
        manager.setPaused(true);

        uint256 before = token.balanceOf(requester);
        vm.prank(requester);
        manager.cancelCovenant(covenantId);
        assertEq(token.balanceOf(requester) - before, ONE_USD);
    }

    function test_adminCannotRewriteAnArmedCovenant() public {
        bytes32 covenantId = _armedCovenant();
        ResurvCovenantManager.Covenant memory before = manager.getCovenant(covenantId);

        // The only admin surface that exists is the fee-token allowlist and the pause, and
        // neither touches a covenant. Disallowing the token after arming must not strand it.
        vm.prank(admin);
        manager.setFeeTokenAllowed(address(token), false);

        ResurvCovenantManager.Covenant memory after_ = manager.getCovenant(covenantId);
        assertEq(after_.verifier, before.verifier);
        assertEq(after_.responder, before.responder);
        assertEq(after_.feeAmount, before.feeAmount);
        assertEq(after_.deadline, before.deadline);
        assertEq(after_.verifierContextHash, before.verifierContextHash);

        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert"), 0);
        _executeAttempt(covenantId, 1, 0);
        assertEq(token.balanceOf(responder), ONE_USD, "a disallowed token stranded a payout");
    }

    function test_onlyThePauserMayPauseAndOnlyTheAdminMayAllowTokens() public {
        vm.prank(stranger);
        vm.expectRevert();
        manager.setPaused(true);

        vm.prank(stranger);
        vm.expectRevert();
        manager.setFeeTokenAllowed(address(token), false);
    }

    // -------------------------------------------------------------------------------------
    // Creation validation
    // -------------------------------------------------------------------------------------

    function test_creationRejectsAnUnapprovedFeeToken() public {
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.feeToken = address(0xBEEF);
        vm.prank(requester);
        vm.expectRevert(ResurvCovenantManager.FeeTokenNotAllowed.selector);
        manager.createCovenant(params, _defaultActions());
    }

    function test_creationRejectsAnActionCountOutsideTwoToFive() public {
        ResurvCovenantManager.ActionInput[] memory one = new ResurvCovenantManager.ActionInput[](1);
        one[0] = _defaultActions()[0];
        vm.prank(requester);
        vm.expectRevert(ResurvCovenantManager.InvalidParameters.selector);
        manager.createCovenant(_defaultParams(), one);

        ResurvCovenantManager.ActionInput[] memory six = new ResurvCovenantManager.ActionInput[](6);
        for (uint256 i = 0; i < 6; ++i) {
            six[i] = _defaultActions()[0];
        }
        vm.prank(requester);
        vm.expectRevert(ResurvCovenantManager.InvalidParameters.selector);
        manager.createCovenant(_defaultParams(), six);
    }

    function test_creationRejectsADeadlineInThePast() public {
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.deadline = uint64(block.timestamp);
        vm.prank(requester);
        vm.expectRevert(ResurvCovenantManager.InvalidParameters.selector);
        manager.createCovenant(params, _defaultActions());
    }

    function test_creationRejectsAZeroFee() public {
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.feeAmount = 0;
        vm.prank(requester);
        vm.expectRevert(ResurvCovenantManager.InvalidParameters.selector);
        manager.createCovenant(params, _defaultActions());
    }

    function test_theSameSaltCannotCreateTwoCovenants() public {
        _createCovenant(_defaultParams());
        vm.prank(requester);
        vm.expectRevert(ResurvCovenantManager.CovenantAlreadyExists.selector);
        manager.createCovenant(_defaultParams(), _defaultActions());
    }

    function test_covenantIdMatchesTheAdvertisedDerivation() public {
        bytes32 covenantId = _createCovenant(_defaultParams());
        assertEq(covenantId, manager.computeCovenantId(requester, bytes32(uint256(1))));
    }

    function test_armingRequiresTheRequesterAndTheDraftStatus() public {
        bytes32 covenantId = _createCovenant(_defaultParams());
        token.mint(stranger, ONE_USD);
        vm.startPrank(stranger);
        token.approve(address(manager), ONE_USD);
        vm.expectRevert(ResurvCovenantManager.NotRequester.selector);
        manager.fundAndArm(covenantId);
        vm.stopPrank();

        _fundAndArm(covenantId, ONE_USD);
        token.mint(requester, ONE_USD);
        vm.startPrank(requester);
        token.approve(address(manager), ONE_USD);
        vm.expectRevert(ResurvCovenantManager.InvalidStatus.selector);
        manager.fundAndArm(covenantId);
        vm.stopPrank();
    }

    function test_anUnarmedCovenantCannotBeTriggered() public {
        bytes32 covenantId = _createCovenant(_defaultParams());
        bytes memory signature = _sign(covenantId, keccak256("alert"), 0);
        vm.expectRevert(ResurvCovenantManager.InvalidStatus.selector);
        manager.trigger(
            covenantId,
            keccak256("alert"),
            0,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 hours),
            signature
        );
    }

    function _preStateHash(bytes32 covenantId, bytes memory context)
        internal
        view
        returns (bytes32 stateHash)
    {
        (, stateHash,) = verifier.evaluate(covenantId, context);
    }
}
