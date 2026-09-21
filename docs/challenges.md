# Challenge a friend

Any finished run can become a link. **CHALLENGE** on the results screen
publishes the run — the circuit it was set on, plus the packed lap line
(`src/ghostShare.ts`) — and hands the player a URL like:

```
https://minirush.site/?c=k3f9x1qd
```

Opening that link drops the friend on the **same circuit, city, mode and lap
count**, with the setter's car running beside them as a ghost. At the finish
the game says who was quicker and by how much, and their own run can be sent
back the same way.

## How it works

- `convex/challenges.ts` holds one row per shared run, keyed by an 8-character
  code and dropped after 30 days. The mutation is public — the game writes it
  from the phone — so it validates everything it can: code shape, seed, laps,
  lap length, time, score, map and mode ids, and a ghost that is under 24 kB
  and really is a packed lap line.
- `src/challenge.ts` makes the code, builds the link and reads it back.
- The lap count is **locked** to the setter's while a challenge is loaded,
  otherwise the two times would not be comparable.
- Police Chase links are refused: that mode has no ghosts to race.

## Getting the link to the player

The link goes to the clipboard first and on screen either way, and only then is
the share sheet offered. Some in-app browsers open a share sheet whose promise
never settles; waiting on it would leave the player staring at "making your
link…" with nothing to send.

## Limits

- A challenge is a replay: it cannot react to you, and there is no contact.
- Times come from the phone, like every other board in the game. A challenge is
  a bragging link, not a prize — those stay on the on-chain bounty entries.
- Without Convex configured, the CHALLENGE button simply reports that it could
  not make a link; nothing else changes.
