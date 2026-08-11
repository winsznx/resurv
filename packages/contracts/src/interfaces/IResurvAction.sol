// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @notice A pre-authorized recovery capability (PRD 10.4).
/// @dev Adapters are capabilities, not arbitrary calldata. CLAUDE.md invariant: "No model
///      output can create raw calldata." The adapter address and the hash of its config are
///      both committed before the covenant is armed, so the set of things that can happen
///      is fixed before any trigger exists.
///      Requirements:
///      - MUST validate its own targets and recipients.
///      - MUST NOT perform unbounded arbitrary external calls.
///      - MUST revert on partial failure. A half-completed action is a failed action.
///      - MUST publish a human-readable config schema in this repository.
interface IResurvAction {
    /// @param covenantId Identifier of the covenant on whose behalf the action runs.
    /// @param config Committed configuration. Its hash is fixed at arm time.
    /// @return actionResultHash Commitment to what the action did, recorded in the receipt.
    function execute(bytes32 covenantId, bytes calldata config)
        external
        payable
        returns (bytes32 actionResultHash);
}
