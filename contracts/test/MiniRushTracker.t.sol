// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MiniRushTracker} from "../src/MiniRushTracker.sol";

contract MiniRushTrackerTest is Test {
    MiniRushTracker tracker;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    event SignedUp(address indexed player, uint256 totalPlayers);
    event RacePlayed(
        address indexed player,
        uint32 score,
        uint16 place,
        uint16 mapId,
        uint16 modeId,
        uint32 playerRaces
    );

    function setUp() public {
        tracker = new MiniRushTracker();
    }

    function test_signUp_registersOnce() public {
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit SignedUp(alice, 1);
        assertTrue(tracker.signUp());

        assertTrue(tracker.hasSignedUp(alice));
        assertEq(tracker.totalPlayers(), 1);

        // idempotent — second call returns false, no new player
        vm.prank(alice);
        assertFalse(tracker.signUp());
        assertEq(tracker.totalPlayers(), 1);
    }

    function test_recordRace_autoSignsUpAndCounts() public {
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit RacePlayed(alice, 1200, 1, 3, 2, 1);
        tracker.recordRace(1200, 1, 3, 2);

        assertTrue(tracker.hasSignedUp(alice), "auto signup");
        assertEq(tracker.totalPlayers(), 1);
        assertEq(tracker.totalRaces(), 1);

        (bool reg, uint32 races, uint32 best, uint64 last) = tracker.statsOf(alice);
        assertTrue(reg);
        assertEq(races, 1);
        assertEq(best, 1200);
        assertEq(last, uint64(block.timestamp));
    }

    function test_bestScore_keepsMax() public {
        vm.startPrank(alice);
        tracker.recordRace(500, 2, 0, 0);
        tracker.recordRace(1500, 1, 0, 0);
        tracker.recordRace(900, 3, 0, 0);
        vm.stopPrank();

        (, uint32 races, uint32 best,) = tracker.statsOf(alice);
        assertEq(races, 3);
        assertEq(best, 1500);
    }

    function test_multiPlayer_countersAggregate() public {
        vm.prank(alice);
        tracker.recordRace(100, 1, 0, 0);
        vm.prank(bob);
        tracker.recordRace(200, 1, 0, 0);
        vm.prank(bob);
        tracker.recordRace(300, 1, 0, 0);

        assertEq(tracker.totalPlayers(), 2);
        assertEq(tracker.totalRaces(), 3);

        (, uint32 aliceRaces,,) = tracker.statsOf(alice);
        (, uint32 bobRaces,,) = tracker.statsOf(bob);
        assertEq(aliceRaces, 1);
        assertEq(bobRaces, 2);
    }
}
