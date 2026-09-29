/**
 * The open city's plan: a grid of blocks cut by streets, ringed by a wide
 * expressway, with the harbour water to the south.
 *
 * Everything is axis-aligned so collision is rectangle tests and the minimap
 * is a handful of fillRects. Coordinates are metres, centred on the origin;
 * +z is south (toward the water).
 */

export const BLOCKS = 12;          // blocks per side
export const PITCH = 84;           // block + one street, centre to centre
export const STREET = 16;          // street width, kerb to kerb
export const RING = 26;            // expressway width
export const HALF = (BLOCKS * PITCH) / 2;
/** Outer edge of the drivable city, the expressway's far kerb. */
export const EDGE = HALF + STREET / 2 + RING;
/** Where the harbour water starts, past the south expressway. */
export const SHORE = EDGE + 6;

// The east freeway leaves the old ring over the harbour and lands on a second
// island. Keep these coordinates separate from the original grid so the main
// city can stay cheap to stream while the expansion gets its own dressing.
export const EAST_ISLAND_X0 = EDGE + 72;
export const EAST_ISLAND_X1 = EDGE + 620;
export const EAST_ISLAND_Z0 = -330;
export const EAST_ISLAND_Z1 = 300;
export const BRIDGE_Z = -126;
export const BRIDGE_HALF = 24;
export const CITY_EXTENT = EAST_ISLAND_X1 + 36;

export type District = 'downtown' | 'midtown' | 'market' | 'harbour' | 'plaza';

export interface Block {
  i: number; j: number;
  /** kerb rectangle: the car cannot enter it */
  x0: number; z0: number; x1: number; z1: number;
  district: District;
}

export const DISTRICT_NAME: Record<District, string> = {
  downtown: 'DOWNTOWN', midtown: 'MIDTOWN', market: 'NIGHT MARKET',
  harbour: 'HARBOUR', plaza: 'PLAZA'
};

/** Centre line of street number k (0..BLOCKS) along either axis. */
export const streetAt = (k: number): number => -HALF + k * PITCH;

function districtOf(i: number, j: number): District {
  const ci = i - (BLOCKS - 1) / 2, cj = j - (BLOCKS - 1) / 2;
  if (j === BLOCKS - 1) return 'harbour';
  if (i <= 1) return 'market';
  // two open squares break the grid up and give shortcuts across it
  if ((i === 3 && j === 3) || (i === 8 && j === 7)) return 'plaza';
  if (Math.abs(ci) <= 2.5 && Math.abs(cj) <= 2.5) return 'downtown';
  return 'midtown';
}

export const CITY_BLOCKS: Block[] = [];
for (let i = 0; i < BLOCKS; i++) {
  for (let j = 0; j < BLOCKS; j++) {
    const cx = streetAt(i) + PITCH / 2, cz = streetAt(j) + PITCH / 2;
    const half = (PITCH - STREET) / 2;
    CITY_BLOCKS.push({ i, j, x0: cx - half, z0: cz - half, x1: cx + half, z1: cz + half,
      district: districtOf(i, j) });
  }
}

/** The block a point sits in or beside, by grid cell; null off the grid. */
export function blockAt(x: number, z: number): Block | null {
  const i = Math.floor((x + HALF) / PITCH), j = Math.floor((z + HALF) / PITCH);
  if (i < 0 || j < 0 || i >= BLOCKS || j >= BLOCKS) return null;
  return CITY_BLOCKS[i * BLOCKS + j];
}

/** The district name to announce for a point. Out on the ring it is the expressway. */
export function districtAt(x: number, z: number): string {
  if (x > EAST_ISLAND_X0 && x < EAST_ISLAND_X1 && z > EAST_ISLAND_Z0 && z < EAST_ISLAND_Z1) {
    return 'EAST ISLAND';
  }
  if (x > EDGE && x <= EAST_ISLAND_X0 && Math.abs(z - BRIDGE_Z) < BRIDGE_HALF) {
    return 'EAST FREEWAY';
  }
  if (Math.abs(x) > HALF + STREET / 2 || Math.abs(z) > HALF + STREET / 2) return 'EXPRESSWAY';
  const b = blockAt(x, z);
  return b ? DISTRICT_NAME[b.district] : 'EXPRESSWAY';
}

/** Where a new drive starts: the middle of a downtown street, facing north. */
export const SPAWN = { x: streetAt(6), z: streetAt(7) - PITCH * 0.3, yaw: Math.PI };
