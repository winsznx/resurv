// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {CovenantStatus, CovenantStatusLib} from "../src/CovenantStatus.sol";

contract CovenantStatusTest is Test {
    using CovenantStatusLib for CovenantStatus;

    uint8 internal constant STATUS_COUNT = 8;

    /// @dev The TypeScript decoder in packages/domain hardcodes these ordinals. If this
    ///      test is ever edited to match a changed enum, the decoder must change with it.
    function test_ordinalsAreStable() public pure {
        assertEq(uint8(CovenantStatus.NONE), 0, "NONE");
        assertEq(uint8(CovenantStatus.DRAFT), 1, "DRAFT");
        assertEq(uint8(CovenantStatus.ARMED), 2, "ARMED");
        assertEq(uint8(CovenantStatus.TRIGGERED), 3, "TRIGGERED");
        assertEq(uint8(CovenantStatus.EXECUTING), 4, "EXECUTING");
        assertEq(uint8(CovenantStatus.SATISFIED), 5, "SATISFIED");
        assertEq(uint8(CovenantStatus.EXPIRED), 6, "EXPIRED");
        assertEq(uint8(CovenantStatus.CANCELLED), 7, "CANCELLED");
    }

    function test_happyPathIsPermitted() public pure {
        assertTrue(CovenantStatusLib.canTransition(CovenantStatus.NONE, CovenantStatus.DRAFT));
        assertTrue(CovenantStatusLib.canTransition(CovenantStatus.DRAFT, CovenantStatus.ARMED));
        assertTrue(CovenantStatusLib.canTransition(CovenantStatus.ARMED, CovenantStatus.TRIGGERED));
        assertTrue(
            CovenantStatusLib.canTransition(CovenantStatus.TRIGGERED, CovenantStatus.EXECUTING)
        );
        assertTrue(
            CovenantStatusLib.canTransition(CovenantStatus.EXECUTING, CovenantStatus.SATISFIED)
        );
    }

    /// @dev A single atomic attempt settles the covenant, so TRIGGERED reaching SATISFIED
    ///      without a stored EXECUTING state is legal (PRD 9.1 note).
    function test_triggeredMaySettleDirectly() public pure {
        assertTrue(
            CovenantStatusLib.canTransition(CovenantStatus.TRIGGERED, CovenantStatus.SATISFIED)
        );
    }

    function test_terminalStatesAreExactlyThree() public pure {
        uint256 terminals;
        for (uint8 i; i < STATUS_COUNT; ++i) {
            if (CovenantStatusLib.isTerminal(CovenantStatus(i))) ++terminals;
        }
        assertEq(terminals, 3, "SATISFIED, EXPIRED, CANCELLED");
        assertTrue(CovenantStatusLib.isTerminal(CovenantStatus.SATISFIED));
        assertTrue(CovenantStatusLib.isTerminal(CovenantStatus.EXPIRED));
        assertTrue(CovenantStatusLib.isTerminal(CovenantStatus.CANCELLED));
    }

    function test_cannotCancelAfterTrigger() public pure {
        assertFalse(
            CovenantStatusLib.canTransition(CovenantStatus.TRIGGERED, CovenantStatus.CANCELLED)
        );
        assertFalse(
            CovenantStatusLib.canTransition(CovenantStatus.EXECUTING, CovenantStatus.CANCELLED)
        );
    }

    function test_cannotSkipTheTrigger() public pure {
        assertFalse(CovenantStatusLib.canTransition(CovenantStatus.ARMED, CovenantStatus.EXECUTING));
        assertFalse(CovenantStatusLib.canTransition(CovenantStatus.ARMED, CovenantStatus.SATISFIED));
        assertFalse(CovenantStatusLib.canTransition(CovenantStatus.DRAFT, CovenantStatus.TRIGGERED));
    }

    /// @dev The fee is released on the transition into SATISFIED. If SATISFIED could be
    ///      re-entered, the fee could be released twice.
    function testFuzz_terminalStatesAreAbsorbing(uint8 fromRaw, uint8 toRaw) public pure {
        CovenantStatus from = CovenantStatus(bound(fromRaw, 0, STATUS_COUNT - 1));
        CovenantStatus to = CovenantStatus(bound(toRaw, 0, STATUS_COUNT - 1));
        vm.assume(CovenantStatusLib.isTerminal(from));
        assertFalse(CovenantStatusLib.canTransition(from, to), "left a terminal state");
    }

    function testFuzz_selfTransitionIsNeverLegal(uint8 raw) public pure {
        CovenantStatus status = CovenantStatus(bound(raw, 0, STATUS_COUNT - 1));
        assertFalse(CovenantStatusLib.canTransition(status, status));
    }

    function testFuzz_nothingReturnsToNone(uint8 fromRaw) public pure {
        CovenantStatus from = CovenantStatus(bound(fromRaw, 0, STATUS_COUNT - 1));
        assertFalse(CovenantStatusLib.canTransition(from, CovenantStatus.NONE));
    }
}
