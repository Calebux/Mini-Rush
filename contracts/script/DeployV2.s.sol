// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MiniRushTrackerV2} from "../src/MiniRushTrackerV2.sol";

/// @notice Deploys MiniRushTrackerV2 alongside the immutable V1 tracker, wiring
///         V1 in as the read-only baseline. Reads DEPLOYER_PRIVATE_KEY for the
///         signer and V1_ADDRESS for the existing tracker (defaults to the
///         deployed mainnet V1 when unset).
///
/// Usage (Celo mainnet):
///   V1_ADDRESS=0x51F572dF0C722DA24cFf02B5FddC949AEe6F293d \
///   forge script script/DeployV2.s.sol:DeployV2 --rpc-url celo --broadcast
contract DeployV2 is Script {
    address constant DEFAULT_V1 = 0x51F572dF0C722DA24cFf02B5FddC949AEe6F293d;

    function run() external returns (MiniRushTrackerV2 tracker) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address v1 = vm.envOr("V1_ADDRESS", DEFAULT_V1);
        vm.startBroadcast(pk);
        tracker = new MiniRushTrackerV2(v1);
        vm.stopBroadcast();
        console.log("MiniRushTrackerV2 deployed at:", address(tracker));
        console.log("Baseline V1:", v1);
    }
}
