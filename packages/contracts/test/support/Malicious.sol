// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IOutcomeVerifier} from "../../src/interfaces/IOutcomeVerifier.sol";
import {IResurvAction} from "../../src/interfaces/IResurvAction.sol";
import {ResurvCovenantManager} from "../../src/ResurvCovenantManager.sol";

/// @notice Hostile counterparties for the two trust boundaries the threat model calls the
///         riskiest: covenant manager to adapter, and covenant manager to verifier.

/// @dev Calls back into `executeAttempt` while the manager is mid-attempt.
contract ReentrantAdapter is IResurvAction {
    ResurvCovenantManager public immutable manager;
    bytes32 public covenantId;
    bytes public actionConfig;
    bytes public verifierContext;
    bool public reentered;
    bytes public lastRevertData;

    constructor(ResurvCovenantManager covenantManager) {
        manager = covenantManager;
    }

    function arm(bytes32 id, bytes calldata config, bytes calldata context) external {
        covenantId = id;
        actionConfig = config;
        verifierContext = context;
    }

    function execute(bytes32, bytes calldata) external payable returns (bytes32) {
        reentered = true;
        try manager.executeAttempt(
            covenantId, 0, actionConfig, verifierContext, bytes32(0), 99
        ) returns (
            bytes32
        ) {
            lastRevertData = hex"";
        } catch (bytes memory reason) {
            lastRevertData = reason;
        }
        return keccak256("reentrant");
    }
}

/// @dev Does nothing at all and reports success. The covenant's postcondition is the only thing
///      standing between this and a paid fee.
contract NoOpAdapter is IResurvAction {
    function execute(bytes32, bytes calldata) external payable returns (bytes32) {
        return keccak256("no-op");
    }
}

/// @dev Not declared as `IOutcomeVerifier`, so the compiler permits a state write. The manager
///      casts it to the view interface and therefore reaches it through STATICCALL, which is
///      what turns the write into a revert.
contract SelfSatisfyingVerifier {
    uint256 public counter;

    function evaluate(bytes32, bytes calldata)
        external
        returns (bool satisfied, bytes32 stateHash, uint256 observedValue)
    {
        counter += 1;
        return (true, keccak256("satisfied-by-writing"), counter);
    }
}

/// @dev Fails closed, which the interface requires. An attempt against it must revert whole
///      rather than treat "not verifiable" as "not satisfied but survivable".
contract RevertingVerifier is IOutcomeVerifier {
    error NotVerifiable();

    function evaluate(bytes32, bytes calldata) external pure returns (bool, bytes32, uint256) {
        revert NotVerifiable();
    }
}

/// @dev Answers true unconditionally. Encodes a poor definition of safety rather than a bug,
///      and is here to pin what RESURV does and does not promise: the contract enforces that
///      *the declared* verifier returned true, never that the declaration was wise.
contract AlwaysTrueVerifier is IOutcomeVerifier {
    function evaluate(bytes32, bytes calldata) external pure returns (bool, bytes32, uint256) {
        return (true, keccak256("always"), 0);
    }
}

/// @dev Keeps one percent of every transfer. `fundAndArm` measures what arrives, so a covenant
///      can never be armed with a token that would leave the escrow short.
contract FeeOnTransferToken is ERC20 {
    constructor() ERC20("Fee On Transfer", "FOT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0)) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = value / 100;
        super._update(from, to, value - fee);
        if (fee > 0) super._update(from, address(0xdead), fee);
    }
}

/// @dev Calls back into the manager from inside `transfer`, which is the ERC-777 shape. The
///      reentrancy guard and the settle-before-transfer ordering both have to hold.
contract ReentrantFeeToken is ERC20 {
    ResurvCovenantManager public manager;
    bytes32 public covenantId;
    bool public armed;
    bool public reentered;

    constructor() ERC20("Reentrant", "RNT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(ResurvCovenantManager covenantManager, bytes32 id) external {
        manager = covenantManager;
        covenantId = id;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (!armed || from == address(0)) return;
        armed = false;
        reentered = true;
        // Try to take the escrow a second time while the first transfer is still unwinding.
        try manager.cancelCovenant(covenantId) {} catch {}
    }
}
