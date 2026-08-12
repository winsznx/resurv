// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {ResurvCovenantManager} from "../../src/ResurvCovenantManager.sol";
import {PauseAction} from "../../src/actions/PauseAction.sol";
import {EvacuateERC20Action} from "../../src/actions/EvacuateERC20Action.sol";
import {VaultSafeStateVerifier} from "../../src/verifiers/VaultSafeStateVerifier.sol";
import {DemoVault} from "../../src/demo/DemoVault.sol";
import {TestUSD} from "../../src/demo/TestUSD.sol";

/// @notice The canonical world every covenant test starts from: one vault holding one test
///         dollar, two committed recovery actions, one verifier, and a funded covenant.
///
/// @dev Deliberately not a mock. These are the same contracts the Base Sepolia demo deploys, so
///      a test that passes here is a statement about the deployed system rather than about a
///      convenience double.
abstract contract CovenantFixture is Test {
    uint256 internal constant ONE_USD = 1_000_000;

    ResurvCovenantManager internal manager;
    PauseAction internal pauseAction;
    EvacuateERC20Action internal evacuateAction;
    VaultSafeStateVerifier internal verifier;
    DemoVault internal vault;
    TestUSD internal token;

    address internal admin = makeAddr("admin");
    address internal pauser = makeAddr("pauser");
    address internal executor = makeAddr("keeperhub-org-wallet");
    address internal requester = makeAddr("requester");
    address internal responder = makeAddr("responder");
    address internal safe = makeAddr("approved-safe");
    address internal stranger = makeAddr("stranger");

    uint256 internal triggerAuthorityKey;
    address internal triggerAuthority;

    uint64 internal deadline;

    function _deployWorld() internal {
        (triggerAuthority, triggerAuthorityKey) = makeAddrAndKey("trigger-authority");

        token = new TestUSD();
        address[] memory feeTokens = new address[](1);
        feeTokens[0] = address(token);

        manager = new ResurvCovenantManager(admin, pauser, executor, feeTokens);
        pauseAction = new PauseAction(address(manager));
        evacuateAction = new EvacuateERC20Action(address(manager));
        verifier = new VaultSafeStateVerifier();
        vault = new DemoVault(admin);

        vm.startPrank(admin);
        vault.grantRole(vault.PAUSER_ROLE(), address(pauseAction));
        vault.grantRole(vault.RESCUER_ROLE(), address(evacuateAction));
        vm.stopPrank();

        token.mint(address(vault), ONE_USD);
        deadline = uint64(block.timestamp + 7 days);
    }

    function _verifierContext() internal view returns (bytes memory) {
        return abi.encode(address(vault), safe, address(token), uint256(0), ONE_USD);
    }

    function _pauseConfig() internal view returns (bytes memory) {
        return abi.encode(address(vault));
    }

    function _evacuateConfig() internal view returns (bytes memory) {
        return abi.encode(address(vault), address(token), safe, ONE_USD, ONE_USD);
    }

    function _defaultActions()
        internal
        view
        returns (ResurvCovenantManager.ActionInput[] memory actions)
    {
        actions = new ResurvCovenantManager.ActionInput[](2);
        actions[0] = ResurvCovenantManager.ActionInput({
            adapter: address(pauseAction), config: _pauseConfig(), maxAttempts: 2
        });
        actions[1] = ResurvCovenantManager.ActionInput({
            adapter: address(evacuateAction), config: _evacuateConfig(), maxAttempts: 2
        });
    }

    function _defaultParams()
        internal
        view
        returns (ResurvCovenantManager.CovenantParams memory params)
    {
        params = ResurvCovenantManager.CovenantParams({
            triggerAuthority: triggerAuthority,
            responder: responder,
            verifier: address(verifier),
            feeToken: address(token),
            // One test dollar, six decimals.
            // forge-lint: disable-next-line(unsafe-typecast)
            feeAmount: uint128(ONE_USD),
            deadline: deadline,
            maxTotalAttempts: 4,
            verifierContext: _verifierContext(),
            salt: bytes32(uint256(1))
        });
    }

    function _createCovenant(ResurvCovenantManager.CovenantParams memory params)
        internal
        returns (bytes32 covenantId)
    {
        vm.prank(requester);
        covenantId = manager.createCovenant(params, _defaultActions());
    }

    function _fundAndArm(bytes32 covenantId, uint256 feeAmount) internal {
        token.mint(requester, feeAmount);
        vm.startPrank(requester);
        token.approve(address(manager), feeAmount);
        manager.fundAndArm(covenantId);
        vm.stopPrank();
    }

    /// @notice Create, fund and arm the canonical covenant.
    function _armedCovenant() internal returns (bytes32 covenantId) {
        covenantId = _createCovenant(_defaultParams());
        _fundAndArm(covenantId, ONE_USD);
    }

    function _sign(bytes32 covenantId, bytes32 signalHash, uint32 nonce)
        internal
        view
        returns (bytes memory signature)
    {
        bytes32 digest = manager.triggerDigest(
            covenantId,
            signalHash,
            nonce,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 hours)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(triggerAuthorityKey, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function _trigger(bytes32 covenantId, bytes32 signalHash, uint32 nonce) internal {
        manager.trigger(
            covenantId,
            signalHash,
            nonce,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 hours),
            _sign(covenantId, signalHash, nonce)
        );
    }

    /// @notice The demo's decisive setup step: the primary action's authority is revoked, so
    ///         `pause()` can no longer succeed and the covenant has to fall back.
    /// @dev The role is read before the prank. `vm.prank` applies to the next call, and
    ///      `vault.PAUSER_ROLE()` is a call: inlining it consumes the prank and the revoke runs
    ///      as the test contract.
    function _revokePauseAuthority() internal {
        bytes32 role = vault.PAUSER_ROLE();
        vm.prank(admin);
        vault.revokeRole(role, address(pauseAction));
    }

    function _executeAttempt(bytes32 covenantId, uint256 actionIndex, uint64 sequence)
        internal
        returns (bytes32)
    {
        vm.prank(executor);
        return manager.executeAttempt(
            covenantId,
            actionIndex,
            actionIndex == 0 ? _pauseConfig() : _evacuateConfig(),
            _verifierContext(),
            bytes32(0),
            sequence
        );
    }
}
