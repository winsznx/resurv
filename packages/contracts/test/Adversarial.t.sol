// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {CovenantStatus} from "../src/CovenantStatus.sol";
import {ResurvCovenantManager} from "../src/ResurvCovenantManager.sol";
import {EvacuateERC20Action} from "../src/actions/EvacuateERC20Action.sol";
import {PauseAction} from "../src/actions/PauseAction.sol";
import {VaultSafeStateVerifier} from "../src/verifiers/VaultSafeStateVerifier.sol";
import {CovenantFixture} from "./support/CovenantFixture.sol";
import {
    AlwaysTrueVerifier,
    FeeOnTransferToken,
    NoOpAdapter,
    ReentrantAdapter,
    ReentrantFeeToken,
    RevertingVerifier,
    SelfSatisfyingVerifier
} from "./support/Malicious.sol";

/// @notice The two boundaries `docs/THREAT_MODEL.md` calls the riskiest, attacked directly.
contract AdversarialTest is CovenantFixture {
    function setUp() public {
        _deployWorld();
    }

    // -------------------------------------------------------------------------------------
    // Manager to adapter
    // -------------------------------------------------------------------------------------

    function test_reentrantAdapterCannotStartASecondAttempt() public {
        ReentrantAdapter attacker = new ReentrantAdapter(manager);

        ResurvCovenantManager.ActionInput[] memory actions =
            new ResurvCovenantManager.ActionInput[](2);
        actions[0] = ResurvCovenantManager.ActionInput({
            adapter: address(attacker), config: hex"", maxAttempts: 3
        });
        actions[1] = ResurvCovenantManager.ActionInput({
            adapter: address(evacuateAction), config: _evacuateConfig(), maxAttempts: 2
        });

        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.verifier = address(new AlwaysTrueVerifier());
        params.verifierContext = hex"";

        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, actions);
        _fundAndArm(covenantId, ONE_USD);
        _trigger(covenantId, keccak256("alert"), 0);
        attacker.arm(covenantId, hex"", hex"");

        vm.prank(executor);
        manager.executeAttempt(covenantId, 0, hex"", hex"", bytes32(0), 0);

        assertTrue(attacker.reentered(), "the adapter never attempted reentry");
        assertGt(attacker.lastRevertData().length, 0, "the reentrant call was not rejected");
        assertEq(token.balanceOf(responder), ONE_USD, "responder not paid once");
        assertEq(manager.escrowed(address(token)), 0);
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.SATISFIED));
    }

    function test_anAdapterThatDoesNothingCannotEarnAFee() public {
        NoOpAdapter lazy = new NoOpAdapter();

        ResurvCovenantManager.ActionInput[] memory actions =
            new ResurvCovenantManager.ActionInput[](2);
        actions[0] = ResurvCovenantManager.ActionInput({
            adapter: address(lazy), config: hex"", maxAttempts: 2
        });
        actions[1] = ResurvCovenantManager.ActionInput({
            adapter: address(evacuateAction), config: _evacuateConfig(), maxAttempts: 2
        });

        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, actions);
        _fundAndArm(covenantId, ONE_USD);
        _trigger(covenantId, keccak256("alert"), 0);

        vm.prank(executor);
        vm.expectPartialRevert(ResurvCovenantManager.OutcomeNotSatisfied.selector);
        manager.executeAttempt(covenantId, 0, hex"", _verifierContext(), bytes32(0), 0);

        assertEq(token.balanceOf(responder), 0);
        assertEq(manager.escrowed(address(token)), ONE_USD);
    }

    function test_anAdapterCannotBeInvokedOutsideAnAttempt() public {
        // The capability is bound to the manager, so holding the vault role is not enough.
        vm.prank(stranger);
        vm.expectRevert(EvacuateERC20Action.OnlyManager.selector);
        evacuateAction.execute(bytes32(0), _evacuateConfig());
        assertEq(token.balanceOf(address(vault)), ONE_USD);
    }

    function test_adaptersRejectMalformedConfigsAndValue() public {
        vm.expectRevert(PauseAction.InvalidConfig.selector);
        vm.prank(address(manager));
        pauseAction.execute(bytes32(0), hex"1234");

        vm.expectRevert(EvacuateERC20Action.InvalidConfig.selector);
        vm.prank(address(manager));
        evacuateAction.execute(bytes32(0), hex"1234");

        vm.deal(address(manager), 1 ether);
        vm.expectRevert(PauseAction.ValueNotAccepted.selector);
        vm.prank(address(manager));
        pauseAction.execute{value: 1}(bytes32(0), _pauseConfig());
    }

    function test_evacuationRefusesAnAmountOutsideItsCommittedBounds() public {
        // The vault holds one dollar; the committed config demands exactly two.
        bytes memory config =
            abi.encode(address(vault), address(token), safe, ONE_USD * 2, ONE_USD * 2);

        ResurvCovenantManager.ActionInput[] memory actions = _defaultActions();
        actions[1].config = config;

        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, actions);
        _fundAndArm(covenantId, ONE_USD);
        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert"), 0);

        vm.prank(executor);
        vm.expectPartialRevert(EvacuateERC20Action.AmountOutOfBounds.selector);
        manager.executeAttempt(covenantId, 1, config, _verifierContext(), bytes32(0), 0);
        assertEq(token.balanceOf(safe), 0);
    }

    // -------------------------------------------------------------------------------------
    // Manager to verifier
    // -------------------------------------------------------------------------------------

    function test_aVerifierThatWritesCannotSatisfyItself() public {
        SelfSatisfyingVerifier hostile = new SelfSatisfyingVerifier();

        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.verifier = address(hostile);
        params.verifierContext = hex"";

        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, _defaultActions());
        _fundAndArm(covenantId, ONE_USD);
        _trigger(covenantId, keccak256("alert"), 0);

        // The pre-state read already reaches it through STATICCALL, so the attempt cannot even
        // begin. Nothing is paid and the counter never moves.
        vm.prank(executor);
        vm.expectRevert();
        manager.executeAttempt(covenantId, 1, _evacuateConfig(), hex"", bytes32(0), 0);

        assertEq(hostile.counter(), 0, "the verifier managed to write");
        assertEq(token.balanceOf(responder), 0);
        assertEq(manager.escrowed(address(token)), ONE_USD);
    }

    function test_aVerifierThatRevertsFailsTheAttemptClosed() public {
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.verifier = address(new RevertingVerifier());
        params.verifierContext = hex"";

        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, _defaultActions());
        _fundAndArm(covenantId, ONE_USD);
        _trigger(covenantId, keccak256("alert"), 0);

        vm.prank(executor);
        vm.expectRevert(RevertingVerifier.NotVerifiable.selector);
        manager.executeAttempt(covenantId, 1, _evacuateConfig(), hex"", bytes32(0), 0);
        assertEq(manager.escrowed(address(token)), ONE_USD);
    }

    /// @dev A verifier that cannot answer must not trap the escrow forever, so expiry treats a
    ///      revert as "not verifiable" and refunds. This is the one place a reverting verifier
    ///      does not stop the world, and it is deliberate.
    function test_aRevertingVerifierStillPermitsExpiryRefund() public {
        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.verifier = address(new RevertingVerifier());
        params.verifierContext = hex"";

        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, _defaultActions());
        _fundAndArm(covenantId, ONE_USD);
        _trigger(covenantId, keccak256("alert"), 0);

        uint256 before = token.balanceOf(requester);
        vm.warp(deadline + 1);
        manager.expireCovenant(covenantId, hex"");

        assertEq(token.balanceOf(requester) - before, ONE_USD);
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.EXPIRED));
    }

    function test_theVerifierRejectsAMalformedContext() public {
        vm.expectRevert(VaultSafeStateVerifier.InvalidContext.selector);
        verifier.evaluate(bytes32(0), hex"1234");

        vm.expectRevert(VaultSafeStateVerifier.InvalidContext.selector);
        verifier.evaluate(
            bytes32(0), abi.encode(address(0), safe, address(token), uint256(0), uint256(0))
        );
    }

    /// @dev Two different worlds must not commit to the same state hash. The balance is the
    ///      only thing that changes here and the hash has to move with it.
    function test_theStateHashCoversWhatDecidedTheAnswer() public {
        (, bytes32 first,) = verifier.evaluate(bytes32(uint256(1)), _verifierContext());
        token.mint(address(vault), 1);
        (, bytes32 second,) = verifier.evaluate(bytes32(uint256(1)), _verifierContext());
        assertTrue(first != second, "state hash ignored a balance change");

        (, bytes32 otherCovenant,) = verifier.evaluate(bytes32(uint256(2)), _verifierContext());
        assertTrue(second != otherCovenant, "state hash ignored the covenant identity");
    }

    // -------------------------------------------------------------------------------------
    // Fee tokens
    // -------------------------------------------------------------------------------------

    function test_aFeeOnTransferTokenCannotArmACovenant() public {
        FeeOnTransferToken hostile = new FeeOnTransferToken();
        vm.prank(admin);
        manager.setFeeTokenAllowed(address(hostile), true);

        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.feeToken = address(hostile);

        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, _defaultActions());

        hostile.mint(requester, ONE_USD * 2);
        vm.startPrank(requester);
        hostile.approve(address(manager), ONE_USD * 2);
        vm.expectRevert(ResurvCovenantManager.FeeTransferFailed.selector);
        manager.fundAndArm(covenantId);
        vm.stopPrank();

        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.DRAFT));
        assertEq(manager.escrowed(address(hostile)), 0);
    }

    function test_aTokenThatReentersOnTransferCannotTakeTheEscrowTwice() public {
        ReentrantFeeToken hostile = new ReentrantFeeToken();
        vm.prank(admin);
        manager.setFeeTokenAllowed(address(hostile), true);

        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.feeToken = address(hostile);

        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, _defaultActions());

        hostile.mint(requester, ONE_USD);
        vm.startPrank(requester);
        hostile.approve(address(manager), ONE_USD);
        manager.fundAndArm(covenantId);
        vm.stopPrank();

        hostile.arm(manager, covenantId);

        uint256 requesterBefore = hostile.balanceOf(requester);
        vm.prank(requester);
        manager.cancelCovenant(covenantId);

        assertTrue(hostile.reentered(), "the token never attempted reentry");
        assertEq(hostile.balanceOf(requester) - requesterBefore, ONE_USD, "refunded twice");
        assertEq(hostile.balanceOf(address(manager)), 0);
        assertEq(manager.escrowed(address(hostile)), 0);
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.CANCELLED));
    }

    // -------------------------------------------------------------------------------------
    // Escrow conservation across covenants
    // -------------------------------------------------------------------------------------

    function test_oneCovenantCannotSpendAnothersEscrow() public {
        bytes32 first = _armedCovenant();

        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.salt = bytes32(uint256(2));
        // Three test dollars, six decimals. Nowhere near uint128.
        // forge-lint: disable-next-line(unsafe-typecast)
        params.feeAmount = uint128(ONE_USD * 3);
        vm.prank(requester);
        bytes32 second = manager.createCovenant(params, _defaultActions());
        _fundAndArm(second, ONE_USD * 3);

        assertEq(manager.escrowed(address(token)), ONE_USD * 4);

        _revokePauseAuthority();
        _trigger(first, keccak256("alert"), 0);
        _executeAttempt(first, 1, 0);

        assertEq(token.balanceOf(responder), ONE_USD, "first covenant overpaid");
        assertEq(manager.escrowed(address(token)), ONE_USD * 3, "second covenant's escrow moved");
        assertEq(token.balanceOf(address(manager)), ONE_USD * 3);
    }
}
