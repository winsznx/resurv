// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @notice Immutable, deterministic postcondition oracle for a covenant (PRD 10.3).
/// @dev Requirements the covenant contract relies on:
///      - MUST be `view`. A verifier that can write could satisfy itself.
///      - MUST be deterministic for the same chain state and context.
///      - MUST NOT rely on mutable offchain claims.
///      - `stateHash` MUST cover every material state element, so two different worlds
///        cannot produce the same hash.
///      - MUST fail closed: a revert means "not verifiable", and the atomic attempt
///        reverts with it rather than treating the outcome as false-but-survivable.
interface IOutcomeVerifier {
    /// @param covenantId Identifier of the covenant being evaluated.
    /// @param context Verifier-specific committed context. Its hash is fixed at arm time.
    /// @return satisfied True only when the declared safe state holds right now.
    /// @return stateHash Commitment to the observed state, recorded in the receipt.
    /// @return observedValue The single headline measurement, for human-readable proof.
    function evaluate(bytes32 covenantId, bytes calldata context)
        external
        view
        returns (bool satisfied, bytes32 stateHash, uint256 observedValue);
}
