// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal read surface of the original MiniRushTracker (V1). V1 is
///         owner-less and immutable, so V2 can only read it — never migrate it.
interface IMiniRushTrackerV1 {
    function statsOf(address player)
        external
        view
        returns (bool registered, uint32 races, uint32 bestScore, uint64 lastPlayed);
}

/// @title MiniRushTrackerV2
/// @notice Second-generation on-chain tracker for MiniRush on Celo. Adds
///         achievement badges, per-mode race counters and a referral counter
///         on top of the V1 race counter.
/// @dev    V1 (0x51F5…293d) can't be upgraded, so V2 is deployed alongside it
///         and reads it live as a baseline: a player's total races and best
///         score fold in whatever they already accumulated on V1, so badge
///         milestones and the profile display stay continuous across the cut.
///         Like V1: no owner, no funds held, anyone records only their own runs.
contract MiniRushTrackerV2 {
    struct Player {
        bool registered;   // has interacted with V2
        uint32 races;      // races recorded on V2 (V1 races add on top in views)
        uint32 bestScore;  // best score recorded on V2
        uint64 lastPlayed; // block.timestamp of the most recent V2 race
        uint32 badges;     // bitfield of earned badges (see BADGE_* below)
        uint32 referrals;  // players this wallet has referred
        bool referred;     // has already credited a referrer (one-time)
    }

    /// @notice The immutable V1 tracker this contract reads as a baseline.
    IMiniRushTrackerV1 public immutable v1;

    /// @notice Per-player V2 stats, keyed by wallet address.
    mapping(address => Player) public players;
    /// @notice Per-player, per-mode race counts (modeId => count).
    mapping(address => mapping(uint16 => uint32)) public modeRaces;

    /// @notice Distinct wallets that have interacted with V2.
    uint256 public totalPlayers;
    /// @notice Total races recorded on V2 across all players.
    uint256 public totalRaces;

    // Badge bit positions — must match src/wallet.ts BADGES.
    uint8 internal constant BADGE_RACES_10 = 0;
    uint8 internal constant BADGE_RACES_50 = 1;
    uint8 internal constant BADGE_RACES_100 = 2;
    uint8 internal constant BADGE_SCORE_5K = 3;
    uint8 internal constant BADGE_SCORE_10K = 4;
    uint8 internal constant BADGE_SCORE_15K = 5;

    event SignedUp(address indexed player, uint256 totalPlayers);
    event RacePlayed(
        address indexed player,
        uint32 score,
        uint16 place,
        uint16 mapId,
        uint16 modeId,
        uint32 totalRacesForPlayer
    );
    event BadgeEarned(address indexed player, uint8 badgeId);
    event Referred(address indexed referrer, address indexed referee, uint32 referrerTotal);

    /// @param v1Address Deployed MiniRushTracker (V1). address(0) disables the
    ///        baseline (V2 then counts only its own races).
    constructor(address v1Address) {
        v1 = IMiniRushTrackerV1(v1Address);
    }

    /// @notice Record one finished race for the caller. Auto-registers on the
    ///         first call. Awards any newly-reached badges using the combined
    ///         V1 + V2 totals.
    function recordRace(uint32 score, uint16 place, uint16 mapId, uint16 modeId) external {
        Player storage p = players[msg.sender];
        if (!p.registered) {
            p.registered = true;
            unchecked { totalPlayers += 1; }
            emit SignedUp(msg.sender, totalPlayers);
        }

        unchecked {
            p.races += 1;
            totalRaces += 1;
            modeRaces[msg.sender][modeId] += 1;
        }
        if (score > p.bestScore) p.bestScore = score;
        p.lastPlayed = uint64(block.timestamp);

        (uint32 totalRacesForPlayer, uint32 bestScoreForPlayer) = _combined(msg.sender, p);
        _awardBadges(msg.sender, p, totalRacesForPlayer, bestScoreForPlayer);

        emit RacePlayed(msg.sender, score, place, mapId, modeId, totalRacesForPlayer);
    }

    /// @notice Credit `referrer` for referring the caller. One-time per caller;
    ///         no self-referrals. Registers the caller so the guard persists.
    function recordReferral(address referrer) external {
        require(referrer != address(0), "zero referrer");
        require(referrer != msg.sender, "self referral");

        Player storage me = players[msg.sender];
        require(!me.referred, "already referred");
        me.referred = true;
        if (!me.registered) {
            me.registered = true;
            unchecked { totalPlayers += 1; }
            emit SignedUp(msg.sender, totalPlayers);
        }

        Player storage r = players[referrer];
        unchecked { r.referrals += 1; }
        emit Referred(referrer, msg.sender, r.referrals);
    }

    /// @notice Full stats for a wallet, folding in the V1 baseline. Mirrors the
    ///         V1 statsOf shape so the game can read either contract the same way.
    function statsOf(address player)
        external
        view
        returns (bool registered, uint32 races, uint32 bestScore, uint64 lastPlayed)
    {
        Player storage p = players[player];
        (bool v1Reg, , , uint64 v1Last) = _v1Stats(player);
        (uint32 total, uint32 best) = _combined(player, p);
        return (p.registered || v1Reg, total, best, p.lastPlayed > v1Last ? p.lastPlayed : v1Last);
    }

    /// @notice Earned-badge bitfield for a wallet.
    function badgesOf(address player) external view returns (uint32) {
        return players[player].badges;
    }

    /// @notice How many wallets this player has referred.
    function referralsOf(address player) external view returns (uint32) {
        return players[player].referrals;
    }

    /// @notice Race count for a wallet in a single mode (V2 only).
    function modeRacesOf(address player, uint16 modeId) external view returns (uint32) {
        return modeRaces[player][modeId];
    }

    /// @dev Combined V1 + V2 totals for a player.
    function _combined(address player, Player storage p)
        internal
        view
        returns (uint32 totalRacesForPlayer, uint32 bestScoreForPlayer)
    {
        (, uint32 v1Races, uint32 v1Best, ) = _v1Stats(player);
        totalRacesForPlayer = v1Races + p.races;
        bestScoreForPlayer = v1Best > p.bestScore ? v1Best : p.bestScore;
    }

    /// @dev Read V1 stats, tolerating a missing/reverting V1 (returns zeros).
    function _v1Stats(address player)
        internal
        view
        returns (bool registered, uint32 races, uint32 bestScore, uint64 lastPlayed)
    {
        if (address(v1) == address(0)) return (false, 0, 0, 0);
        try v1.statsOf(player) returns (bool reg, uint32 r, uint32 b, uint64 l) {
            return (reg, r, b, l);
        } catch {
            return (false, 0, 0, 0);
        }
    }

    /// @dev Set any newly-reached badge bits and emit one event per new badge.
    function _awardBadges(address player, Player storage p, uint32 totalRacesForPlayer, uint32 bestScoreForPlayer) internal {
        uint32 bits = p.badges;
        bits = _maybe(player, bits, totalRacesForPlayer >= 10, BADGE_RACES_10);
        bits = _maybe(player, bits, totalRacesForPlayer >= 50, BADGE_RACES_50);
        bits = _maybe(player, bits, totalRacesForPlayer >= 100, BADGE_RACES_100);
        bits = _maybe(player, bits, bestScoreForPlayer >= 5000, BADGE_SCORE_5K);
        bits = _maybe(player, bits, bestScoreForPlayer >= 10000, BADGE_SCORE_10K);
        bits = _maybe(player, bits, bestScoreForPlayer >= 15000, BADGE_SCORE_15K);
        if (bits != p.badges) p.badges = bits;
    }

    function _maybe(address player, uint32 bits, bool qualifies, uint8 badgeId) internal returns (uint32) {
        uint32 mask = uint32(1) << badgeId;
        if (qualifies && (bits & mask) == 0) {
            bits |= mask;
            emit BadgeEarned(player, badgeId);
        }
        return bits;
    }
}
