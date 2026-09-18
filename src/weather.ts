// Weather system: per-map weather conditions that affect grip, visibility,
// and visual mood. Deterministic from the circuit seed so every retry of the
// same track gets the same weather.

export type WeatherType = 'clear' | 'rain' | 'night' | 'sandstorm';

export interface WeatherSpec {
  type: WeatherType;
  label: string;
  icon: string;
  gripMul: number;    // 1.0 = normal, <1 = slippery
  fogMul: number;     // multiplier on fog far distance (<1 = closer fog)
  tint: number;       // overlay tint applied to scene lighting
}

// Wet and dusty weather used to draw streaks over the whole screen, HUD and
// all. Bad weather now reads from the world instead: closer fog, its own light
// tint, less grip, and the label on the HUD.

const SPECS: Record<WeatherType, WeatherSpec> = {
  clear: {
    type: 'clear', label: 'CLEAR', icon: '☀️',
    gripMul: 1.0, fogMul: 1.0, tint: 0xffffff
  },
  rain: {
    type: 'rain', label: 'RAIN', icon: '🌧️',
    gripMul: 0.82, fogMul: 0.65, tint: 0xb0c0d0
  },
  night: {
    type: 'night', label: 'NIGHT', icon: '🌙',
    gripMul: 0.94, fogMul: 0.8, tint: 0x3040608
  },
  sandstorm: {
    type: 'sandstorm', label: 'SANDSTORM', icon: '🏜️',
    gripMul: 0.78, fogMul: 0.5, tint: 0xd8b878
  }
};

// Which weather types each map can roll (besides clear, which is always possible)
const MAP_POOL: Record<string, WeatherType[]> = {
  lagos:   ['clear', 'clear', 'rain'],
  beijing: ['clear', 'clear', 'rain', 'night'],
  mumbai:  ['clear', 'clear', 'rain'],
  neon:    ['rain', 'night', 'night'],
  london:  ['rain', 'rain', 'rain', 'clear'],
  tokyo:   ['clear', 'rain', 'night'],
  rio:     ['clear', 'clear', 'rain'],
  cairo:   ['clear', 'clear', 'sandstorm', 'sandstorm'],
  nairobi: ['clear', 'clear', 'clear', 'night'],
  seoul:   ['clear', 'rain', 'night'],
  accra:   ['clear', 'clear', 'rain'],
  saopaulo:['clear', 'rain', 'night'],
  norway:  ['clear', 'night', 'night', 'rain'],
  iceland: ['clear', 'rain', 'night'],
  canada:  ['clear', 'clear', 'rain'],
  newzealand: ['clear', 'clear', 'rain'],
  finland: ['night', 'night', 'clear']
};

/** Deterministic weather for a map+seed. */
export function rollWeather(mapId: string, seed: number): WeatherSpec {
  const pool = MAP_POOL[mapId] ?? ['clear'];
  if (pool.length === 0) return { ...SPECS.clear };
  // simple hash of the seed to pick from the pool
  const safeSeed = Number.isFinite(seed) ? Math.floor(seed) : 0;
  const hash = Math.abs(Math.imul(safeSeed, 2654435761) >>> 0);
  const type = pool[hash % pool.length];
  return { ...SPECS[type] };
}

export function weatherSpec(type: WeatherType): WeatherSpec {
  return { ...SPECS[type] };
}
