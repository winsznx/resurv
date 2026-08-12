// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice The protocol RESURV is recovering. PRD 11.1.
///
/// @dev Stands in for a real vault with two emergency levers granted to two different holders.
///      The demo revokes one of them before the trigger, which is the whole point: an emergency
///      plan whose first action has silently stopped working is the ordinary case, not the
///      exotic one.
///
///      Roles are granted to the RESURV action adapters rather than to an agent EOA, which is
///      the arrangement PRD 20.3 requires. An adapter can only do the one bounded thing its
///      code does; an EOA with the same role could do anything the vault permits.
contract DemoVault is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("DEMO_VAULT_PAUSER_ROLE");
    bytes32 public constant RESCUER_ROLE = keccak256("DEMO_VAULT_RESCUER_ROLE");

    bool public paused;

    event VaultPaused(address indexed caller);
    event VaultEvacuated(address indexed token, address indexed safe, uint256 amount);

    error AlreadyPaused();
    error NothingToEvacuate();
    error InvalidRecipient();

    /// @dev Admin is an explicit argument: this contract is deployed through a CREATE2 factory,
    ///      so `msg.sender` in the constructor is the factory.
    constructor(address admin) {
        if (admin == address(0)) revert InvalidRecipient();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        if (paused) revert AlreadyPaused();
        paused = true;
        emit VaultPaused(msg.sender);
    }

    function evacuateToSafe(address token, address safe, uint256 amount)
        external
        onlyRole(RESCUER_ROLE)
    {
        if (safe == address(0)) revert InvalidRecipient();
        if (amount == 0) revert NothingToEvacuate();
        IERC20(token).safeTransfer(safe, amount);
        emit VaultEvacuated(token, safe, amount);
    }

    function tokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
