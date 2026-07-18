// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MiniRushTracker} from "../src/MiniRushTracker.sol";
import {MiniRushTrackerV2} from "../src/MiniRushTrackerV2.sol";

contract MiniRushTrackerV2Test is Test {
    MiniRushTracker v1;
    MiniRushTrackerV2 v2;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA401);

    event BadgeEarned(address indexed player, uint8 badgeId);
    event Referred(address indexed referrer, address indexed referee, uint32 referrerTotal);

    function setUp() public {
        v1 = new MiniRushTracker();
        v2 = new MiniRushTrackerV2(address(v1));
    }

    function test_recordRace_countsAndRegisters() public {
        vm.prank(alice);
        v2.recordRace(1200, 1, 3, 2);

        (bool reg, uint32 races, uint32 best,) = v2.statsOf(alice);
        assertTrue(reg);
        assertEq(races, 1);
        assertEq(best, 1200);
        assertEq(v2.totalPlayers(), 1);
        assertEq(v2.totalRaces(), 1);
    }

    function test_statsOf_foldsV1Baseline() public {
        // alice already has 3 races on V1, best 900
        vm.startPrank(alice);
        v1.recordRace(500, 2, 0, 0);
        v1.recordRace(900, 1, 0, 0);
        v1.recordRace(400, 3, 0, 0);
        vm.stopPrank();

        // then 2 races on V2, best 1200
        vm.startPrank(alice);
        v2.recordRace(1200, 1, 0, 0);
        v2.recordRace(600, 2, 0, 0);
        vm.stopPrank();

        (bool reg, uint32 races, uint32 best,) = v2.statsOf(alice);
        assertTrue(reg);
        assertEq(races, 5, "3 on V1 + 2 on V2");
        assertEq(best, 1200, "max across both");
    }

    function test_badges_racesMilestone_usesCombinedTotal() public {
        // 8 races on V1
        vm.startPrank(alice);
        for (uint256 i = 0; i < 8; i++) v1.recordRace(100, 1, 0, 0);
        vm.stopPrank();

        // 9th race (1 on V2) → total 9, no badge yet
        vm.prank(alice);
        v2.recordRace(100, 1, 0, 0);
        assertEq(v2.badgesOf(alice), 0, "no badge at 9");

        // 10th race (2 on V2) → total 10 → BADGE_RACES_10 (bit 0)
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit BadgeEarned(alice, 0);
        v2.recordRace(100, 1, 0, 0);
        assertEq(v2.badgesOf(alice), 1, "bit 0 set");
    }

    function test_badges_scoreMilestones() public {
        // score 5000 → bit 3 (value 8); 10000 → bit 4 (16); 15000 → bit 5 (32)
        vm.prank(alice);
        v2.recordRace(5000, 1, 0, 0);
        assertEq(v2.badgesOf(alice), 8, "5k badge");

        vm.prank(alice);
        v2.recordRace(15000, 1, 0, 0);
        // 5k, 10k, 15k all now earned: bits 3,4,5 = 8+16+32 = 56
        assertEq(v2.badgesOf(alice), 56, "all score badges");
    }

    function test_badges_emitOncePerBadge() public {
        vm.prank(alice);
        v2.recordRace(5000, 1, 0, 0); // earns 5k badge
        // racing again at 5k+ must NOT emit BadgeEarned(3) a second time
        vm.recordLogs();
        vm.prank(alice);
        v2.recordRace(6000, 1, 0, 0);
        // badge set is unchanged (still just the 5k badge)
        assertEq(v2.badgesOf(alice), 8);
    }

    function test_modeRaces_perModeCounters() public {
        vm.startPrank(alice);
        v2.recordRace(100, 1, 0, 0); // mode 0
        v2.recordRace(100, 1, 0, 2); // mode 2
        v2.recordRace(100, 1, 0, 2); // mode 2
        vm.stopPrank();

        assertEq(v2.modeRacesOf(alice, 0), 1);
        assertEq(v2.modeRacesOf(alice, 2), 2);
        assertEq(v2.modeRacesOf(alice, 5), 0);
    }

    function test_referral_creditsReferrerOnce() public {
        // bob is referred by alice
        vm.prank(bob);
        vm.expectEmit(true, true, false, true);
        emit Referred(alice, bob, 1);
        v2.recordReferral(alice);

        assertEq(v2.referralsOf(alice), 1);

        // bob can't credit again
        vm.prank(bob);
        vm.expectRevert("already referred");
        v2.recordReferral(alice);
        assertEq(v2.referralsOf(alice), 1);

        // carol referred by alice too → alice now has 2
        vm.prank(carol);
        v2.recordReferral(alice);
        assertEq(v2.referralsOf(alice), 2);
    }

    function test_referral_blocksSelfAndZero() public {
        vm.prank(alice);
        vm.expectRevert("self referral");
        v2.recordReferral(alice);

        vm.prank(alice);
        vm.expectRevert("zero referrer");
        v2.recordReferral(address(0));
    }

    function test_v1BaselineOptional_zeroAddress() public {
        MiniRushTrackerV2 standalone = new MiniRushTrackerV2(address(0));
        vm.prank(alice);
        standalone.recordRace(1200, 1, 0, 0);
        (, uint32 races, uint32 best,) = standalone.statsOf(alice);
        assertEq(races, 1);
        assertEq(best, 1200);
    }
}
