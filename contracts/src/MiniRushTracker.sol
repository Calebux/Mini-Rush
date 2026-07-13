// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MiniRushTracker
/// @notice On-chain signup + race counter for MiniRush (Outbreak GP) on Celo.
///         Deliberately tiny: MiniPay only sends legacy (type-0) transactions
///         and pays network fees in stablecoins, so every write path is a
///         single SSTORE-light call with minimal calldata.
/// @dev    No owner, no upgradeability, no funds held. Anyone can record their
///         own runs; there is nothing to steal and nothing to pause.
contract MiniRushTracker {
    struct Player {
        bool registered;   // has signed up at least once
        uint32 races;      // races this player has recorded
        uint32 bestScore;  // best score this player has recorded
        uint64 lastPlayed; // block.timestamp of the most recent race
    }

    /// @notice Per-player stats, keyed by wallet address.
    mapping(address => Player) public players;

    /// @notice Distinct wallets that have ever signed up.
    uint256 public totalPlayers;

    /// @notice Total races recorded across all players.
    uint256 public totalRaces;

    /// @notice Emitted the first time a wallet signs up.
    event SignedUp(address indexed player, uint256 totalPlayers);

    /// @notice Emitted on every recorded race.
    event RacePlayed(
        address indexed player,
        uint32 score,
        uint16 place,
        uint16 mapId,
        uint16 modeId,
        uint32 playerRaces
    );

    /// @notice Register the caller. Idempotent — safe to call on every connect.
    /// @return true if this call registered a new player, false if already signed up.
    function signUp() public returns (bool) {
        return _register(msg.sender);
    }

    /// @notice Record one finished race for the caller. Auto-signs-up on the
    ///         first race so the game can skip a separate signup transaction.
    /// @param score  Final score for the run.
    /// @param place  Finishing position (1 = win).
    /// @param mapId  City / map index the race was run on.
    /// @param modeId Game mode index.
    function recordRace(uint32 score, uint16 place, uint16 mapId, uint16 modeId) external {
        _register(msg.sender);

        Player storage p = players[msg.sender];
        unchecked {
            p.races += 1;
            totalRaces += 1;
        }
        if (score > p.bestScore) p.bestScore = score;
        p.lastPlayed = uint64(block.timestamp);

        emit RacePlayed(msg.sender, score, place, mapId, modeId, p.races);
    }

    /// @notice Whether a wallet has ever signed up.
    function hasSignedUp(address player) external view returns (bool) {
        return players[player].registered;
    }

    /// @notice Convenience read: full stats for a wallet in one call.
    function statsOf(address player)
        external
        view
        returns (bool registered, uint32 races, uint32 bestScore, uint64 lastPlayed)
    {
        Player storage p = players[player];
        return (p.registered, p.races, p.bestScore, p.lastPlayed);
    }

    function _register(address player) internal returns (bool) {
        Player storage p = players[player];
        if (p.registered) return false;
        p.registered = true;
        unchecked {
            totalPlayers += 1;
        }
        emit SignedUp(player, totalPlayers);
        return true;
    }
}
