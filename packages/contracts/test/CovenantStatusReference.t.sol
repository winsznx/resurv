// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {CovenantStatus, CovenantStatusLib} from "../src/CovenantStatus.sol";
import {CovenantStatusReference} from "./model/CovenantStatusReference.sol";

/// @notice Equivalence between the production state machine and the independent reference
///         model, over the complete 8x8 pair space. Every test in this file would fail on a
///         mutation the Phase 0 invariant suite could not see.
contract CovenantStatusReferenceTest is Test {
    uint8 internal constant STATUS_COUNT = CovenantStatusReference.STATUS_COUNT;

    function name(CovenantStatus status) internal pure returns (string memory) {
        string[8] memory names = [
            "NONE", "DRAFT", "ARMED", "TRIGGERED", "EXECUTING", "SATISFIED", "EXPIRED", "CANCELLED"
        ];
        return names[uint8(status)];
    }

    function pair(CovenantStatus from, CovenantStatus to) internal pure returns (string memory) {
        return string.concat(name(from), " -> ", name(to));
    }

    /// @dev The whole point of the exercise: enumerate the entire pair space rather than the
    ///      subset the implementation already blesses.
    function test_libraryAgreesWithTheReferenceModelOnEveryPair() public pure {
        for (uint8 f; f < STATUS_COUNT; ++f) {
            for (uint8 t; t < STATUS_COUNT; ++t) {
                CovenantStatus from = CovenantStatus(f);
                CovenantStatus to = CovenantStatus(t);
                assertEq(
                    CovenantStatusLib.canTransition(from, to),
                    CovenantStatusReference.allows(from, to),
                    pair(from, to)
                );
            }
        }
    }

    function test_terminalPredicateAgreesWithTheReferenceModel() public pure {
        for (uint8 s; s < STATUS_COUNT; ++s) {
            CovenantStatus status = CovenantStatus(s);
            assertEq(
                CovenantStatusLib.isTerminal(status),
                CovenantStatusReference.isTerminal(status),
                name(status)
            );
        }
    }

    function test_referenceModelPermitsExactlyTenTransitions() public pure {
        uint256 permitted;
        for (uint8 f; f < STATUS_COUNT; ++f) {
            for (uint8 t; t < STATUS_COUNT; ++t) {
                if (CovenantStatusReference.allows(CovenantStatus(f), CovenantStatus(t))) {
                    ++permitted;
                }
            }
        }
        assertEq(permitted, 10, "PRD 9.1 has 10 edges");
    }

    // ---------------------------------------------------------------------------------
    // Regression tests for the exact defects the independent review demonstrated.
    // Each one passed under the Phase 0 invariant suite.
    // ---------------------------------------------------------------------------------

    function test_regression_draftCannotReachExecuting() public pure {
        assertFalse(CovenantStatusLib.canTransition(CovenantStatus.DRAFT, CovenantStatus.EXECUTING));
    }

    function test_regression_draftCannotReachSatisfied() public pure {
        assertFalse(CovenantStatusLib.canTransition(CovenantStatus.DRAFT, CovenantStatus.SATISFIED));
    }

    function test_regression_armedCannotReachSatisfied() public pure {
        assertFalse(CovenantStatusLib.canTransition(CovenantStatus.ARMED, CovenantStatus.SATISFIED));
    }

    function test_regression_executingCannotRewindToArmed() public pure {
        assertFalse(CovenantStatusLib.canTransition(CovenantStatus.EXECUTING, CovenantStatus.ARMED));
    }

    function test_regression_terminalStatesAreExactlyTheModelSet() public pure {
        uint256 terminals;
        for (uint8 s; s < STATUS_COUNT; ++s) {
            if (CovenantStatusLib.isTerminal(CovenantStatus(s))) ++terminals;
        }
        assertEq(terminals, 3, "isTerminal must not be rewritten to a constant");
        assertTrue(CovenantStatusLib.isTerminal(CovenantStatus.SATISFIED));
        assertTrue(CovenantStatusLib.isTerminal(CovenantStatus.EXPIRED));
        assertTrue(CovenantStatusLib.isTerminal(CovenantStatus.CANCELLED));
        assertFalse(CovenantStatusLib.isTerminal(CovenantStatus.NONE));
        assertFalse(CovenantStatusLib.isTerminal(CovenantStatus.DRAFT));
        assertFalse(CovenantStatusLib.isTerminal(CovenantStatus.ARMED));
        assertFalse(CovenantStatusLib.isTerminal(CovenantStatus.TRIGGERED));
        assertFalse(CovenantStatusLib.isTerminal(CovenantStatus.EXECUTING));
    }

    /// @dev A terminal state may not reach a non-terminal state, and may not reach a
    ///      different terminal state either: expiry is not reversible and cancellation is
    ///      not convertible into settlement.
    function test_regression_terminalStatesReachNothingAtAll() public pure {
        for (uint8 f; f < STATUS_COUNT; ++f) {
            if (!CovenantStatusReference.isTerminal(CovenantStatus(f))) continue;
            for (uint8 t; t < STATUS_COUNT; ++t) {
                assertFalse(
                    CovenantStatusLib.canTransition(CovenantStatus(f), CovenantStatus(t)),
                    pair(CovenantStatus(f), CovenantStatus(t))
                );
            }
        }
    }

    /// @dev The fee is released on entry to SATISFIED, so the set of states that can reach it
    ///      is the set of states from which a fee release is possible. It is exactly the two
    ///      that have passed the trigger.
    function test_regression_satisfiedIsReachableOnlyFromTriggeredAndExecuting() public pure {
        for (uint8 f; f < STATUS_COUNT; ++f) {
            CovenantStatus from = CovenantStatus(f);
            bool expected = from == CovenantStatus.TRIGGERED || from == CovenantStatus.EXECUTING;
            assertEq(
                CovenantStatusLib.canTransition(from, CovenantStatus.SATISFIED),
                expected,
                pair(from, CovenantStatus.SATISFIED)
            );
        }
    }

    function test_regression_nothingReturnsToNone() public pure {
        for (uint8 f; f < STATUS_COUNT; ++f) {
            assertFalse(CovenantStatusLib.canTransition(CovenantStatus(f), CovenantStatus.NONE));
        }
    }

    function test_regression_selfTransitionIsNeverLegal() public pure {
        for (uint8 s; s < STATUS_COUNT; ++s) {
            assertFalse(CovenantStatusLib.canTransition(CovenantStatus(s), CovenantStatus(s)));
        }
    }
}
