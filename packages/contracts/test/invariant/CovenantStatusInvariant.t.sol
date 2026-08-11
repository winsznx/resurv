// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {CovenantStatus, CovenantStatusLib} from "../../src/CovenantStatus.sol";

/// @notice Stateful driver. The fuzzer calls `attempt` with arbitrary targets; only legal
///         transitions are applied, which is exactly what the real covenant contract will do.
contract CovenantStatusHandler {
    CovenantStatus public status = CovenantStatus.NONE;

    uint256 public transitionCount;
    bool public everTerminal;
    /// @notice Set if a transition was ever applied after a terminal state was reached.
    bool public movedAfterTerminal;

    function attempt(uint8 toRaw) external {
        CovenantStatus to = CovenantStatus(uint8(bound(toRaw, 0, 7)));
        if (!CovenantStatusLib.canTransition(status, to)) return;

        if (everTerminal) {
            movedAfterTerminal = true;
        }

        status = to;
        unchecked {
            ++transitionCount;
        }

        if (CovenantStatusLib.isTerminal(to)) {
            everTerminal = true;
        }
    }

    function bound(uint256 value, uint256 min, uint256 max) internal pure returns (uint256) {
        return min + (value % (max - min + 1));
    }
}

contract CovenantStatusInvariantTest is Test {
    CovenantStatusHandler internal handler;

    function setUp() public {
        handler = new CovenantStatusHandler();
        targetContract(address(handler));
    }

    /// @notice Once a covenant reaches a terminal state, no further transition is ever
    ///         applied. This is the machine-checked form of the CLAUDE.md invariant
    ///         "No action runs after a terminal state."
    function invariant_terminalStateIsAbsorbing() public view {
        assertFalse(handler.movedAfterTerminal(), "transition applied after terminal state");
    }

    /// @notice The reachable state set never includes NONE after the first transition,
    ///         so a covenant cannot be rewound into an uninitialized state.
    function invariant_neverReturnsToNone() public view {
        if (handler.transitionCount() == 0) return;
        assertTrue(handler.status() != CovenantStatus.NONE, "returned to NONE");
    }

    /// @notice A terminal status implies the terminal flag, so the handler cannot report a
    ///         terminal state while still believing it may move.
    function invariant_terminalFlagAgreesWithStatus() public view {
        if (CovenantStatusLib.isTerminal(handler.status())) {
            assertTrue(handler.everTerminal(), "terminal status without terminal flag");
        }
    }
}
