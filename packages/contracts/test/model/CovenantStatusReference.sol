// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {CovenantStatus} from "../../src/CovenantStatus.sol";

/// @notice Test-only reference model of the covenant state machine, transcribed by hand from
///         PRD 9.1. It exists so the tests have an oracle that is not the code under test.
///
/// @dev The Phase 0 independent review proved why this is needed: the previous invariant
///      handler asked `CovenantStatusLib.canTransition` whether a transition was legal before
///      attempting it, so the implementation chose its own test space. Permitting
///      `DRAFT -> EXECUTING` or `EXECUTING -> ARMED`, or breaking `isTerminal` entirely, left
///      every invariant green.
///
///      Nothing here calls `CovenantStatusLib`. The representation is deliberately different
///      from the production one: production is a branch chain, this is a flat character
///      table, and `packages/repo-policy` compares this table against the TypeScript mirror
///      character for character so the two languages cannot drift apart.
///
///      Transcription note. PRD 9.1 draws
///        DRAFT -> ARMED -> TRIGGERED -> EXECUTING -> SATISFIED, with EXPIRED reachable from
///        TRIGGERED and EXECUTING, and CANCELLED reachable from DRAFT and ARMED.
///      It then says EXECUTING may be an emitted attempt state rather than a stored one, so
///      TRIGGERED -> SATISFIED is included: a single atomic attempt settles the covenant
///      without ever storing EXECUTING. NONE -> DRAFT is covenant creation.
library CovenantStatusReference {
    uint8 internal constant STATUS_COUNT = 8;

    /// @notice Row = from, column = to, in ordinal order. `X` permitted, `.` forbidden.
    /// @dev Column order: NONE DRAFT ARMED TRIGGERED EXECUTING SATISFIED EXPIRED CANCELLED
    function transitionTable() internal pure returns (bytes memory) {
        return abi.encodePacked(
            ".X......", // NONE      -> DRAFT
            "..X....X", // DRAFT     -> ARMED, CANCELLED
            "...X...X", // ARMED     -> TRIGGERED, CANCELLED
            "....XXX.", // TRIGGERED -> EXECUTING, SATISFIED, EXPIRED
            ".....XX.", // EXECUTING -> SATISFIED, EXPIRED
            "........", // SATISFIED -> nothing
            "........", // EXPIRED   -> nothing
            "........" // CANCELLED -> nothing
        );
    }

    /// @notice One character per state: `X` where the state is terminal.
    /// @dev Order: NONE DRAFT ARMED TRIGGERED EXECUTING SATISFIED EXPIRED CANCELLED
    function terminalRow() internal pure returns (bytes memory) {
        return bytes(".....XXX");
    }

    function allows(CovenantStatus from, CovenantStatus to) internal pure returns (bool) {
        return transitionTable()[uint256(uint8(from)) * STATUS_COUNT + uint256(uint8(to))] == "X";
    }

    function isTerminal(CovenantStatus status) internal pure returns (bool) {
        return terminalRow()[uint256(uint8(status))] == "X";
    }
}
