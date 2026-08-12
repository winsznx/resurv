// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IResurvAction} from "../interfaces/IResurvAction.sol";
import {DemoVault} from "../demo/DemoVault.sol";

/// @notice Pause a vault. PRD 11.2.
///
/// @dev A capability, not calldata. The only thing this contract knows how to do is call
///      `pause()` on the address its committed config names, and that config's hash is fixed
///      before the covenant is armed. There is no path from a model's output to a different
///      target, a different selector or a different argument.
///
///      Schema, `config = abi.encode(address vault)`:
///
///      | field | type    | meaning                                    |
///      |-------|---------|--------------------------------------------|
///      | vault | address | the DemoVault whose `pause()` is called    |
///
///      In the canonical demo this action is the *primary* and it cannot succeed: the vault's
///      `PAUSER_ROLE` is revoked from this adapter before the trigger, so KeeperHub's
///      simulation predicts a revert and nothing is broadcast.
contract PauseAction is IResurvAction {
    /// @notice The only address permitted to invoke this capability.
    address public immutable manager;

    error OnlyManager();
    error ValueNotAccepted();
    error InvalidConfig();

    constructor(address covenantManager) {
        if (covenantManager == address(0)) revert InvalidConfig();
        manager = covenantManager;
    }

    /// @inheritdoc IResurvAction
    function execute(bytes32 covenantId, bytes calldata config)
        external
        payable
        returns (bytes32 actionResultHash)
    {
        if (msg.sender != manager) revert OnlyManager();
        if (msg.value != 0) revert ValueNotAccepted();
        if (config.length != 32) revert InvalidConfig();

        address vault = abi.decode(config, (address));
        if (vault == address(0)) revert InvalidConfig();

        // Reverts if this adapter no longer holds PAUSER_ROLE, or if the vault is already
        // paused. Either way the attempt fails whole: PRD 10.4 forbids partial success.
        DemoVault(vault).pause();

        return keccak256(abi.encode("resurv.action.pause.v1", covenantId, vault));
    }
}
