// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test, console} from "forge-std/Test.sol";
import {CovenantStatus, CovenantStatusLib} from "../../src/CovenantStatus.sol";
import {CovenantStatusReference} from "../model/CovenantStatusReference.sol";

/// @notice Stateful driver for the covenant state machine.
///
/// @dev Rewritten after the Phase 0 independent review. The previous handler opened with
///      `if (!CovenantStatusLib.canTransition(status, to)) return;`, so the fuzzer could only
///      ever replay the graph the implementation already believed in. Three real defects
///      survived it: `DRAFT -> EXECUTING`, `EXECUTING -> ARMED`, and an `isTerminal` that
///      returned false for every state.
///
///      This handler attempts every pair unconditionally and judges the outcome against
///      `CovenantStatusReference`, which is transcribed from PRD 9.1 and never calls the
///      library. The library still drives the state, so an illegal transition it permits is
///      really applied and really observed.
contract CovenantStatusHandler {
    uint8 internal constant STATUS_COUNT = CovenantStatusReference.STATUS_COUNT;

    CovenantStatus public status = CovenantStatus.NONE;

    uint256 public attemptCount;
    uint256 public mutationCount;
    uint256 public rejectedCount;
    uint256 public episodeCount = 1;

    /// @notice The library said something the reference model contradicts.
    uint256 public transitionDisagreements;
    /// @notice `isTerminal` said something the reference model contradicts.
    uint256 public terminalDisagreements;

    /// @notice A transition the reference model forbids was actually applied to `status`.
    bool public illegalTransitionApplied;
    /// @notice A transition was applied out of a state the reference model calls terminal.
    bool public leftTerminalState;
    /// @notice `status` was driven back to NONE after leaving it.
    bool public returnedToNone;

    uint256 public pairsAttempted;
    uint256 public pairsApplied;
    uint256 public statesVisited;

    mapping(uint256 => bool) internal attemptedPair;
    mapping(uint256 => bool) internal appliedPair;
    mapping(uint8 => bool) internal visitedState;

    constructor() {
        visitedState[uint8(CovenantStatus.NONE)] = true;
        statesVisited = 1;
    }

    /// @notice Attempt an arbitrary transition out of the current state, then optionally
    ///         start a fresh covenant if this one has settled. Never gated on the code under
    ///         test.
    ///
    /// @param toRaw the target state, taken modulo the enum size so the call cannot revert.
    /// @param restartWhenSettled when the covenant has reached a state the reference model
    ///        calls terminal, begin a new one. Terminal states absorb, so without a restart
    ///        the fuzzer spends most of its depth on guaranteed early returns and the call
    ///        count stops meaning anything. It is the fuzzer's choice, so attempts out of a
    ///        terminal state, which is what absorption is, keep happening too.
    function attempt(uint8 toRaw, bool restartWhenSettled) external {
        CovenantStatus from = status;
        CovenantStatus to = CovenantStatus(uint8(bound(toRaw, 0, STATUS_COUNT - 1)));

        ++attemptCount;
        recordAttempt(from, to);

        if (CovenantStatusLib.isTerminal(to) != CovenantStatusReference.isTerminal(to)) {
            ++terminalDisagreements;
        }

        bool libraryAllows = CovenantStatusLib.canTransition(from, to);
        bool modelAllows = CovenantStatusReference.allows(from, to);
        if (libraryAllows != modelAllows) {
            ++transitionDisagreements;
        }

        if (libraryAllows) {
            if (!modelAllows) illegalTransitionApplied = true;
            if (CovenantStatusReference.isTerminal(from)) leftTerminalState = true;
            if (to == CovenantStatus.NONE) returnedToNone = true;

            status = to;
            ++mutationCount;
            recordApplied(from, to);
        } else {
            ++rejectedCount;
        }

        if (restartWhenSettled && CovenantStatusReference.isTerminal(status)) restart();
    }

    /// @dev The restart is the harness starting over, not a transition, which is why it is
    ///      gated on the reference model rather than on `CovenantStatusLib.isTerminal`.
    function restart() internal {
        status = CovenantStatus.NONE;
        ++episodeCount;
    }

    function recordAttempt(CovenantStatus from, CovenantStatus to) internal {
        uint256 key = uint256(uint8(from)) * STATUS_COUNT + uint256(uint8(to));
        if (!attemptedPair[key]) {
            attemptedPair[key] = true;
            ++pairsAttempted;
        }
    }

    function recordApplied(CovenantStatus from, CovenantStatus to) internal {
        uint256 key = uint256(uint8(from)) * STATUS_COUNT + uint256(uint8(to));
        if (!appliedPair[key]) {
            appliedPair[key] = true;
            ++pairsApplied;
        }
        if (!visitedState[uint8(to)]) {
            visitedState[uint8(to)] = true;
            ++statesVisited;
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

    /// @notice The production transition relation is exactly the PRD 9.1 relation, judged on
    ///         pairs the fuzzer chose rather than pairs the library volunteered.
    function invariant_libraryAgreesWithReferenceModel() public view {
        assertEq(handler.transitionDisagreements(), 0, "canTransition disagrees with PRD 9.1");
    }

    /// @notice `isTerminal` is checked against the model on every state the fuzzer touches,
    ///         so a constant-false implementation cannot pass.
    function invariant_terminalPredicateAgreesWithReferenceModel() public view {
        assertEq(handler.terminalDisagreements(), 0, "isTerminal disagrees with PRD 9.1");
    }

    /// @notice No transition the model forbids was ever applied to real state.
    function invariant_noIllegalTransitionIsApplied() public view {
        assertFalse(handler.illegalTransitionApplied(), "illegal transition applied");
    }

    /// @notice CLAUDE.md invariant: no action runs after a terminal state. Terminal is
    ///         defined by the model here, not by the code being tested.
    function invariant_terminalStateIsAbsorbing() public view {
        assertFalse(handler.leftTerminalState(), "transition applied out of a terminal state");
    }

    /// @notice A covenant cannot be rewound into an uninitialized state, which would let an
    ///         already-settled covenant be armed again.
    function invariant_neverReturnsToNone() public view {
        assertFalse(handler.returnedToNone(), "returned to NONE");
    }

    /// @notice Behavioral coverage, reported instead of a raw call count. A handler call that
    ///         cannot mutate anything is not depth.
    function afterInvariant() public view {
        console.log("attempts                ", handler.attemptCount());
        console.log("applied transitions     ", handler.mutationCount());
        console.log("rejected attempts       ", handler.rejectedCount());
        console.log("covenants started       ", handler.episodeCount());
        console.log("distinct pairs attempted", handler.pairsAttempted());
        console.log("distinct pairs applied  ", handler.pairsApplied());
        console.log("distinct states visited ", handler.statesVisited());
    }
}
