// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MiniRushTracker} from "../src/MiniRushTracker.sol";

/// @notice Deploys MiniRushTracker. Reads the deployer key from DEPLOYER_PRIVATE_KEY.
///
/// Usage (Celo mainnet):
///   forge script script/Deploy.s.sol:Deploy --rpc-url celo --broadcast
contract Deploy is Script {
    function run() external returns (MiniRushTracker tracker) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        tracker = new MiniRushTracker();
        vm.stopBroadcast();
        console.log("MiniRushTracker deployed at:", address(tracker));
    }
}
