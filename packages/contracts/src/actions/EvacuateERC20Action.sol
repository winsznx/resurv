// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IResurvAction} from "../interfaces/IResurvAction.sol";
import {DemoVault} from "../demo/DemoVault.sol";

/// @notice Evacuate a vault's ERC-20 balance to an approved recipient. PRD 11.3.
///
/// @dev Schema, `config = abi.encode(address vault, address token, address safe, uint256
///      minAmount, uint256 maxAmount)`:
///
///      | field     | type    | meaning                                                    |
///      |-----------|---------|------------------------------------------------------------|
///      | vault     | address | the DemoVault to drain                                      |
///      | token     | address | the ERC-20 to move                                          |
///      | safe      | address | the approved recipient, fixed at arm time                   |
///      | minAmount | uint256 | refuse below this, so a dust balance is not read as success |
///      | maxAmount | uint256 | refuse above this, so an unexpected inflow is not swept     |
///
///      The recipient is the field that matters. It is committed in a config whose hash the
///      covenant stores before arming, so neither the planner, nor the API, nor an operator can
///      redirect the evacuation. The amount is the vault's whole balance, bounded on both
///      sides: a bound that only had a maximum would let a nearly-empty vault satisfy an
///      evacuation, and a bound that only had a minimum would let an unexpected deposit ride
///      along.
contract EvacuateERC20Action is IResurvAction {
    /// @notice The only address permitted to invoke this capability.
    address public immutable manager;

    error OnlyManager();
    error ValueNotAccepted();
    error InvalidConfig();
    error AmountOutOfBounds(uint256 observed, uint256 minAmount, uint256 maxAmount);

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
        if (config.length != 160) revert InvalidConfig();

        (address vault, address token, address safe, uint256 minAmount, uint256 maxAmount) =
            abi.decode(config, (address, address, address, uint256, uint256));
        if (vault == address(0) || token == address(0) || safe == address(0)) {
            revert InvalidConfig();
        }
        if (minAmount == 0 || maxAmount < minAmount) revert InvalidConfig();

        uint256 amount = IERC20(token).balanceOf(vault);
        if (amount < minAmount || amount > maxAmount) {
            revert AmountOutOfBounds(amount, minAmount, maxAmount);
        }

        DemoVault(vault).evacuateToSafe(token, safe, amount);

        return
            keccak256(
                abi.encode("resurv.action.evacuate.v1", covenantId, vault, token, safe, amount)
            );
    }
}
