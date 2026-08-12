// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IOutcomeVerifier} from "../interfaces/IOutcomeVerifier.sol";
import {DemoVault} from "../demo/DemoVault.sol";

/// @notice The declared definition of "safe" for the canonical demo. PRD 11.4.
///
/// @dev Safe when either lever produced its effect:
///
///        vault.paused == true
///        OR (vault.tokenBalance == 0 AND safe.tokenBalance >= safeBaseline + minimumReceived)
///
///      Two properties this contract has to have, and a third it has to not have.
///
///      It must be `view`. The covenant manager calls it through the `view` interface, so the
///      compiler emits STATICCALL and a verifier that tried to write would revert rather than
///      satisfy itself.
///
///      Its state hash must cover every element that decided the answer, so two different
///      worlds cannot produce the same commitment. `chainId`, the covenant id and all five
///      committed context fields are in it alongside the three live readings.
///
///      It must not depend on anything mutable offchain, and it does not: three chain reads
///      and five numbers fixed before arming.
///
///      Context, `abi.encode(address vault, address safe, address token, uint256 safeBaseline,
///      uint256 minimumReceived)`. `safeBaseline` is the recipient's balance at arm time, so
///      the covenant measures a *delivery* rather than a balance that might have been there
///      already.
contract VaultSafeStateVerifier is IOutcomeVerifier {
    error InvalidContext();

    /// @inheritdoc IOutcomeVerifier
    function evaluate(bytes32 covenantId, bytes calldata context)
        external
        view
        returns (bool satisfied, bytes32 stateHash, uint256 observedValue)
    {
        if (context.length != 160) revert InvalidContext();
        (
            address vault,
            address safe,
            address token,
            uint256 safeBaseline,
            uint256 minimumReceived
        ) = abi.decode(context, (address, address, address, uint256, uint256));
        if (vault == address(0) || safe == address(0) || token == address(0)) {
            revert InvalidContext();
        }

        // Fails closed. A revert from any of these three means "not verifiable", and the
        // covenant manager lets that revert unwind the whole attempt.
        bool isPaused = DemoVault(vault).paused();
        uint256 vaultBalance = IERC20(token).balanceOf(vault);
        uint256 safeBalance = IERC20(token).balanceOf(safe);

        bool evacuated = vaultBalance == 0 && safeBalance >= safeBaseline + minimumReceived;
        satisfied = isPaused || evacuated;

        stateHash = keccak256(
            abi.encode(
                block.chainid,
                covenantId,
                vault,
                safe,
                token,
                safeBaseline,
                minimumReceived,
                isPaused,
                vaultBalance,
                safeBalance
            )
        );

        // The headline number a human reads: how much the approved recipient actually received
        // since the covenant was armed.
        observedValue = safeBalance > safeBaseline ? safeBalance - safeBaseline : 0;
    }
}
