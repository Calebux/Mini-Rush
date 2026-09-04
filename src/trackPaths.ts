// Racing lines extracted from imported circuit models by
// scripts/bake-track-path.mjs. Each file is the real centreline of the .glb it
// was baked from, in that model's own units, so the drivable route and the
// rendered circuit are locked to each other by construction.
//
// Loaded once at boot into a synchronous registry: buildRace() is called from a
// dozen places and stays sync.

export interface BakedPath {
  /** Lap distance in model units. */
  length: number;
  /** Median tarmac width in model units. */
  roadWidth: number;
  /** Width of the circuit's narrowest stretch — what the ribbon has to fit in. */
  roadWidthMin: number;
  /** Model-space height of the road surface — used to sit the shell at y=0. */
  roadY: number;
  /** Model-space centroid of the lap, subtracted from every point below. */
  center: [number, number];
  /** Closed centreline, centred on the origin. */
  points: [number, number][];
}

const paths = new Map<string, BakedPath>();

/** Preload every baked path a map might ask for. Missing files fail soft. */
export async function loadTrackPaths(names: string[]): Promise<void> {
  await Promise.all([...new Set(names)].map(async (name) => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}assets/tracks/${name}.json`);
      if (!res.ok) return;
      const data = (await res.json()) as BakedPath;
      if (Array.isArray(data.points) && data.points.length > 16) paths.set(name, data);
    } catch {
      // An imported circuit that fails to load falls back to the generated
      // route rather than taking the whole boot down with it.
    }
  }));
}

export function bakedPath(name: string | undefined): BakedPath | null {
  return name ? paths.get(name) ?? null : null;
}
