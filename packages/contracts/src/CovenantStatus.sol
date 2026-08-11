// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @notice Onchain covenant lifecycle (PRD 9.1).
/// @dev Ordinals are consensus-relevant: events emit the numeric value and
///      `packages/domain` decodes it. `packages/domain/test/covenant-status.test.ts` and
///      `test/CovenantStatus.t.sol` both pin this ordering. Reordering is a breaking change.
enum CovenantStatus {
    NONE, // 0 - an unset struct must decode as NONE, never as a live state
    DRAFT, // 1
    ARMED, // 2
    TRIGGERED, // 3
    EXECUTING, // 4
    SATISFIED, // 5
    EXPIRED, // 6
    CANCELLED // 7
}

/// @notice Reference state machine shared by the covenant contract and its tests.
/// @dev Pure and allocation-free so it can be reused inside an attempt without cost.
library CovenantStatusLib {
    /// @notice Terminal states are absorbing. CLAUDE.md invariant: no action runs after a
    ///         terminal state, and no terminal state may be left.
    function isTerminal(CovenantStatus status) internal pure returns (bool) {
        return status == CovenantStatus.SATISFIED || status == CovenantStatus.EXPIRED
            || status == CovenantStatus.CANCELLED;
    }

    /// @notice Legal transitions from PRD 9.1. Self-transitions are not transitions and
    ///         return false, so a caller cannot use this to justify re-entering a state.
    function canTransition(CovenantStatus from, CovenantStatus to) internal pure returns (bool) {
        if (from == to) return false;

        if (from == CovenantStatus.NONE) {
            return to == CovenantStatus.DRAFT;
        }
        if (from == CovenantStatus.DRAFT) {
            return to == CovenantStatus.ARMED || to == CovenantStatus.CANCELLED;
        }
        if (from == CovenantStatus.ARMED) {
            return to == CovenantStatus.TRIGGERED || to == CovenantStatus.CANCELLED;
        }
        if (from == CovenantStatus.TRIGGERED) {
            return to == CovenantStatus.EXECUTING || to == CovenantStatus.SATISFIED
                || to == CovenantStatus.EXPIRED;
        }
        if (from == CovenantStatus.EXECUTING) {
            return to == CovenantStatus.SATISFIED || to == CovenantStatus.EXPIRED;
        }

        // SATISFIED, EXPIRED, CANCELLED
        return false;
    }
}
