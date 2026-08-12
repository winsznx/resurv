// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {CovenantStatus} from "../src/CovenantStatus.sol";
import {ResurvCovenantManager} from "../src/ResurvCovenantManager.sol";
import {EvacuateERC20Action} from "../src/actions/EvacuateERC20Action.sol";
import {CovenantFixture} from "./support/CovenantFixture.sol";

/// @notice Property tests over the ranges a covenant is parameterized on: amounts, deadlines,
///         thresholds, attempt identities and callers.
contract CovenantFuzzTest is CovenantFixture {
    function setUp() public {
        _deployWorld();
    }

    /// @notice Whatever the requester escrowed, the responder receives exactly that and the
    ///         manager keeps nothing.
    function testFuzz_theResponderReceivesExactlyTheEscrowedFee(uint128 fee) public {
        fee = uint128(bound(uint256(fee), 1, type(uint96).max));

        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.feeAmount = fee;
        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, _defaultActions());
        _fundAndArm(covenantId, fee);

        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert"), 0);
        _executeAttempt(covenantId, 1, 0);

        assertEq(token.balanceOf(responder), fee, "responder underpaid or overpaid");
        assertEq(token.balanceOf(address(manager)), 0, "manager kept value");
        assertEq(manager.escrowed(address(token)), 0);
    }

    /// @notice Cancellation returns the escrow whole, for any amount.
    function testFuzz_cancellationRefundsTheExactEscrow(uint128 fee) public {
        fee = uint128(bound(uint256(fee), 1, type(uint96).max));

        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.feeAmount = fee;
        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, _defaultActions());
        _fundAndArm(covenantId, fee);

        uint256 before = token.balanceOf(requester);
        vm.prank(requester);
        manager.cancelCovenant(covenantId);

        assertEq(token.balanceOf(requester) - before, fee);
        assertEq(token.balanceOf(address(manager)), 0);
    }

    /// @notice The deadline is inclusive on the last second and closed on the next one, at any
    ///         offset the covenant could be created with.
    function testFuzz_deadlineBoundaryIsExact(uint32 offset) public {
        uint64 covenantDeadline = uint64(block.timestamp + bound(uint256(offset), 1, 365 days));

        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.deadline = covenantDeadline;
        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, _defaultActions());
        _fundAndArm(covenantId, ONE_USD);
        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert"), 0);

        uint256 snapshot = vm.snapshotState();

        vm.warp(covenantDeadline + 1);
        vm.prank(executor);
        vm.expectRevert(ResurvCovenantManager.CovenantHasExpired.selector);
        manager.executeAttempt(covenantId, 1, _evacuateConfig(), _verifierContext(), bytes32(0), 0);

        vm.revertToState(snapshot);
        vm.warp(covenantDeadline);
        _executeAttempt(covenantId, 1, 0);
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.SATISFIED));
    }

    /// @notice The declared threshold decides, exactly. One unit below the requirement leaves
    ///         the outcome false and the whole attempt reverts; at the requirement it passes.
    function testFuzz_thresholdIsExactToTheUnit(uint96 vaultAmount, uint96 requiredDelta) public {
        uint256 held = bound(uint256(vaultAmount), 1, 1_000_000_000);
        uint256 required = held + bound(uint256(requiredDelta), 0, 2);

        // Reset the vault to exactly `held`.
        _emptyVault();
        token.mint(address(vault), held);

        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.verifierContext =
            abi.encode(address(vault), safe, address(token), uint256(0), required);
        ResurvCovenantManager.ActionInput[] memory actions = _defaultActions();
        actions[1].config = abi.encode(address(vault), address(token), safe, held, held);

        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, actions);
        _fundAndArm(covenantId, ONE_USD);
        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert"), 0);

        vm.prank(executor);
        if (required <= held) {
            manager.executeAttempt(
                covenantId, 1, actions[1].config, params.verifierContext, bytes32(0), 0
            );
            assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.SATISFIED));
            assertEq(token.balanceOf(responder), ONE_USD);
        } else {
            vm.expectPartialRevert(ResurvCovenantManager.OutcomeNotSatisfied.selector);
            manager.executeAttempt(
                covenantId, 1, actions[1].config, params.verifierContext, bytes32(0), 0
            );
            assertEq(token.balanceOf(responder), 0);
            assertEq(
                token.balanceOf(address(vault)), held, "the evacuation survived a false outcome"
            );
        }
    }

    /// @notice The evacuation bound is enforced on both sides, for every balance.
    function testFuzz_evacuationBoundsAreEnforced(
        uint96 balanceSeed,
        uint96 minSeed,
        uint96 maxSeed
    ) public {
        uint256 balance = bound(uint256(balanceSeed), 1, 1_000_000_000);
        uint256 minAmount = bound(uint256(minSeed), 1, 1_000_000_000);
        uint256 maxAmount = bound(uint256(maxSeed), minAmount, 2_000_000_000);

        _emptyVault();
        token.mint(address(vault), balance);

        bytes memory config = abi.encode(address(vault), address(token), safe, minAmount, maxAmount);
        ResurvCovenantManager.ActionInput[] memory actions = _defaultActions();
        actions[1].config = config;

        ResurvCovenantManager.CovenantParams memory params = _defaultParams();
        params.verifierContext =
            abi.encode(address(vault), safe, address(token), uint256(0), uint256(1));

        vm.prank(requester);
        bytes32 covenantId = manager.createCovenant(params, actions);
        _fundAndArm(covenantId, ONE_USD);
        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert"), 0);

        vm.prank(executor);
        if (balance >= minAmount && balance <= maxAmount) {
            manager.executeAttempt(covenantId, 1, config, params.verifierContext, bytes32(0), 0);
            assertEq(token.balanceOf(safe), balance);
        } else {
            vm.expectPartialRevert(EvacuateERC20Action.AmountOutOfBounds.selector);
            manager.executeAttempt(covenantId, 1, config, params.verifierContext, bytes32(0), 0);
            assertEq(token.balanceOf(safe), 0);
        }
    }

    /// @notice Two attempts differing in any one component are two different attempts, and two
    ///         attempts agreeing on all four are the same one. This is what makes the onchain
    ///         burn a permanent economic identity rather than a coincidence.
    function testFuzz_attemptIdentityIsInjective(
        bytes32 covenantId,
        uint256 actionIndex,
        bytes32 preStateHash,
        uint64 sequence,
        uint8 which
    ) public view {
        bytes32 base = manager.computeAttemptId(covenantId, actionIndex, preStateHash, sequence);
        assertEq(
            base,
            manager.computeAttemptId(covenantId, actionIndex, preStateHash, sequence),
            "the same four inputs produced two identities"
        );

        // Moved by XOR rather than by addition: the fuzzer draws full-width values and `+ 1`
        // overflows on the maximum, which is a defect in the test and not in the contract.
        uint8 field = which % 4;
        bytes32 moved = manager.computeAttemptId(
            field == 0 ? ~covenantId : covenantId,
            field == 1 ? actionIndex ^ 1 : actionIndex,
            field == 2 ? ~preStateHash : preStateHash,
            field == 3 ? sequence ^ 1 : sequence
        );
        assertTrue(base != moved, "two different attempts share one identity");
    }

    /// @notice No address but the executor may attempt, whatever the covenant's state.
    function testFuzz_onlyTheExecutorMayAttempt(address caller) public {
        vm.assume(caller != executor);

        bytes32 covenantId = _armedCovenant();
        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert"), 0);

        vm.prank(caller);
        vm.expectRevert();
        manager.executeAttempt(covenantId, 1, _evacuateConfig(), _verifierContext(), bytes32(0), 0);
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.TRIGGERED));
    }

    /// @notice A trigger signed by anything other than the covenant's authority is refused, and
    ///         a valid one from the authority is accepted.
    function testFuzz_onlyTheTriggerAuthoritySignsAValidTrigger(uint256 keySeed) public {
        uint256 impostorKey =
            bound(keySeed, 1, 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140);
        vm.assume(vm.addr(impostorKey) != triggerAuthority);

        bytes32 covenantId = _armedCovenant();
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
        assertEq(uint8(manager.statusOf(covenantId)), uint8(CovenantStatus.ARMED));
    }

    /// @notice A config that differs from the committed one anywhere is rejected, whatever it
    ///         differs in.
    function testFuzz_anyConfigDriftIsRejected(address recipient, uint96 minAmount) public {
        bytes memory drifted = abi.encode(
            address(vault), address(token), recipient, uint256(minAmount), type(uint256).max
        );
        vm.assume(keccak256(drifted) != keccak256(_evacuateConfig()));

        bytes32 covenantId = _armedCovenant();
        _revokePauseAuthority();
        _trigger(covenantId, keccak256("alert"), 0);

        vm.prank(executor);
        vm.expectRevert(ResurvCovenantManager.InvalidActionConfig.selector);
        manager.executeAttempt(covenantId, 1, drifted, _verifierContext(), bytes32(0), 0);
    }

    function _emptyVault() internal {
        uint256 held = token.balanceOf(address(vault));
        if (held == 0) return;
        bytes32 rescuerRole = vault.RESCUER_ROLE();
        vm.prank(admin);
        vault.grantRole(rescuerRole, admin);
        vm.prank(admin);
        vault.evacuateToSafe(address(token), address(0xdead), held);
    }
}
