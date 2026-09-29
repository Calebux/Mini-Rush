/**
 * The wallet profile on Convex (convex/profiles.ts): the driver name and the
 * cars bought for NIM, keyed by the Nimiq address. Everything else in the
 * profile lives on the phone, and Nimiq Pay can clear that storage — without
 * this a player lost their name and every car they paid for.
 *
 * Fails silently like the boards: offline or without a Convex URL the game
 * keeps running on what the phone holds.
 */
import { convexCall } from './convexBoard';
import { driverName, hasUsername, setUsername } from './driver';
import { grantCar, owned } from './economy';

interface Remote {
  name: string | null;
  cars: string[];
}

/**
 * Sign-in: take the wallet's saved name and cars onto this phone, then back
 * up whatever the phone has that the wallet didn't. True when anything on the
 * phone changed and the menu or garage should redraw.
 */
export async function syncProfile(address: string): Promise<boolean> {
  const remote = (await convexCall('query', 'profiles:get', { address })) as Remote | null;
  let changed = false;
  if (remote) {
    // the wallet's name wins: it is the one the player raced under before
    if (remote.name && remote.name !== driverName() && setUsername(remote.name) === null) changed = true;
    const mine = owned();
    for (const car of remote.cars) {
      if (!mine.has(car)) {
        grantCar(car);
        changed = true;
      }
    }
  }
  await convexCall('mutation', 'profiles:sync', {
    address,
    cars: [...owned()],
    ...(hasUsername() ? { name: driverName() } : {})
  });
  return changed;
}

/** A username picked while signed in. */
export function saveProfileName(address: string, name: string): void {
  void convexCall('mutation', 'profiles:setName', { address, name });
}

/** A car paid for in NIM: unlock it on the wallet, not just this phone. */
export function saveProfileCar(address: string, car: string, tx: string): void {
  void convexCall('mutation', 'profiles:addCar', { address, car, tx });
}
