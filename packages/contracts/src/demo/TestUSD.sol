// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Six-decimal test token standing in for USDC on Base Sepolia.
///
/// @dev Minting is open. That is deliberate: the demo funds itself through the KeeperHub
///      organization wallet, which holds no native currency and cannot be given any without a
///      faucet trip. A permissioned mint would have made the live proof depend on a funded
///      deployer that this project does not have.
///
///      It is a test token and nothing else. It is not used on mainnet, it is not a claim about
///      USDC's behavior, and RESURV's fee-token allowlist exists precisely so a covenant cannot
///      be armed with a token whose transfer semantics were never checked.
contract TestUSD is ERC20 {
    constructor() ERC20("RESURV Test USD", "rUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
