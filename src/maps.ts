// The World Outbreak Tour. Each map has three scenery districts along the lap.
// environment.ts owns the shared lighting/material palette for the whole map, so
// a district carries only what is still local to it: the scenery flavor, an accent
// for the tour card and minimap, and the color its offroad dust kicks up.

import type { TrackLayout } from './track';

export type Flavor =
  | 'towers'       // downtown blocks, streetlights, racing barriers
  | 'palms'        // beachfront — palm trees + low painted buildings
  | 'pagoda'       // tiled-roof houses + red lantern poles
  | 'park'         // round trees, sparse and green
  | 'terrace'      // brick row houses, chimneys, the odd phone box
  | 'market'       // street stalls under striped awnings
  | 'pyramids'     // desert obelisks, ancient ruins & stone pillars
  | 'favela'       // terraced colorful shacks & hillside stairs
  | 'cyberarcade'  // neon hologram signs & arcade arches
  | 'conifers'     // evergreen woodland
  | 'rocks'        // basalt, glacial rock and coastal cuts
  | 'cabins'       // timber lodges
  | 'grandstand';  // purpose-built circuit seating

export interface District {
  label: string;
  flavor: Flavor;
  accent: number; // tour card + minimap tint
  dust: number;   // offroad dust puff color
}

export interface MapSpec {
  id: string;
  name: string;
  flag: string;
  blurb: string;
  // track generator shape: control-point count → corner density,
  // radius spread → how wild the layout swings
  ctlMin: number;
  ctlVar: number;
  rMin: number;
  rVar: number;
  layout?: TrackLayout;
  fogNear: number;
  fogFar: number;
  music?: string;   // optional /assets/music/<name> race loop
  /**
   * A real circuit imported from a model. `model` is the .glb under
   * /assets/models/imported and `path` the centreline baked from it by
   * scripts/bake-track-path.mjs — you drive the circuit's own geometry, so the
   * two names always travel together.
   */
  circuit?: { model: string; path: string };
  alwaysOpen?: boolean; // bonus/imported circuits can bypass passport order
  districts: [District, District, District];
}

export const MAPS: MapSpec[] = [
  {
    id: 'lagos', name: 'LAGOS', flag: '🇳🇬',
    blurb: 'Flowing sweepers from the Island to the market — golden hour, all hour.',
    ctlMin: 10, ctlVar: 3, rMin: 0.7, rVar: 0.5, fogNear: 85, fogFar: 290,
    layout: 'waterfront',
    districts: [
      { label: 'The Island', flavor: 'towers', accent: 0xffb45e, dust: 0xb99e6a },
      { label: 'Bar Beach', flavor: 'palms', accent: 0xbfeef2, dust: 0xe0c78f },
      { label: 'Balogun Market', flavor: 'market', accent: 0xff8a4a, dust: 0xa08858 }
    ]
  },
  {
    id: 'beijing', name: 'BEIJING', flag: '🇨🇳',
    blurb: 'Tight technical corners through hutongs, temple gardens and the CBD haze.',
    ctlMin: 13, ctlVar: 4, rMin: 0.55, rVar: 0.85, fogNear: 35, fogFar: 165,
    layout: 'city-grid',
    districts: [
      { label: 'Hutongs', flavor: 'pagoda', accent: 0xf2c98a, dust: 0xb0987a },
      { label: 'Temple Gardens', flavor: 'park', accent: 0xcfe8c0, dust: 0x8a9a5a },
      { label: 'CBD', flavor: 'towers', accent: 0x8fb8d8, dust: 0x8a8f9a }
    ]
  },
  {
    id: 'mumbai', name: 'MUMBAI', flag: '🇮🇳',
    blurb: 'Chaotic rhythm — painted facades, Marine Drive palms, bazaar squeeze.',
    ctlMin: 12, ctlVar: 4, rMin: 0.6, rVar: 0.75, fogNear: 40, fogFar: 185,
    layout: 'coastal',
    districts: [
      { label: 'Colaba', flavor: 'towers', accent: 0xffd98a, dust: 0xb09a6a },
      { label: 'Marine Drive', flavor: 'palms', accent: 0xa8e8e0, dust: 0xd8bc86 },
      { label: 'Crawford Bazaar', flavor: 'market', accent: 0xff9a5e, dust: 0xa8865a }
    ]
  },
  {
    id: 'neon', name: 'NEON CITY', flag: '🌃',
    blurb: 'Rain-slick cyberpunk streets — all glow, no mercy, midnight forever.',
    ctlMin: 12, ctlVar: 4, rMin: 0.55, rVar: 0.8, fogNear: 26, fogFar: 150,
    layout: 'neon-knot',
    districts: [
      { label: 'Neon Strip', flavor: 'towers', accent: 0xff2e8a, dust: 0x5a4a7a },
      { label: 'Night Market', flavor: 'market', accent: 0x00d9ff, dust: 0x3a5a6a },
      { label: 'Circuit Docks', flavor: 'terrace', accent: 0x8b5cf6, dust: 0x4a3a6a }
    ]
  },
  {
    id: 'london', name: 'LONDON', flag: '🇬🇧',
    blurb: 'A murky, unforgiving street circuit — terraces, Hyde Park, the Square Mile.',
    ctlMin: 14, ctlVar: 3, rMin: 0.5, rVar: 0.7, fogNear: 30, fogFar: 145,
    layout: 'city-grid',
    districts: [
      { label: 'The Terraces', flavor: 'terrace', accent: 0xb8c2d0, dust: 0x707a68 },
      { label: 'Hyde Park', flavor: 'park', accent: 0xcfdce0, dust: 0x6a8a50 },
      { label: 'Square Mile', flavor: 'towers', accent: 0x9fb0c2, dust: 0x788090 }
    ]
  },
  {
    id: 'tokyo', name: 'TOKYO', flag: '🇯🇵',
    blurb: 'Touge drift switchbacks across Shibuya crossing, arcade alleys and Mt. Fuji pass.',
    ctlMin: 16, ctlVar: 4, rMin: 0.45, rVar: 0.9, fogNear: 30, fogFar: 155,
    layout: 'mountain-switchback',
    districts: [
      { label: 'Shibuya Crossing', flavor: 'towers', accent: 0xff3b94, dust: 0x7a508f },
      { label: 'Akihabara Alleys', flavor: 'cyberarcade', accent: 0x00ffcc, dust: 0x408a80 },
      { label: 'Fuji Shrine Pass', flavor: 'pagoda', accent: 0xd5eef8, dust: 0x6e8e7a }
    ]
  },
  {
    id: 'rio', name: 'RIO DE JANEIRO', flag: '🇧🇷',
    blurb: 'High-speed Copacabana curves plunging into tight hillside favela stairways.',
    ctlMin: 11, ctlVar: 3, rMin: 0.65, rVar: 0.6, fogNear: 45, fogFar: 190,
    layout: 'coastal',
    districts: [
      { label: 'Copacabana Beach', flavor: 'palms', accent: 0xffdf78, dust: 0xd9c086 },
      { label: 'Santa Teresa', flavor: 'favela', accent: 0xff9c5b, dust: 0xa28e72 },
      { label: 'Hillside Market', flavor: 'market', accent: 0xff6b4a, dust: 0x967a64 }
    ]
  },
  {
    id: 'cairo', name: 'CAIRO', flag: '🇪🇬',
    blurb: 'Wide-open desert rally straights across ancient pyramids and dusty bazaars.',
    ctlMin: 9, ctlVar: 3, rMin: 0.8, rVar: 0.4, fogNear: 35, fogFar: 200,
    layout: 'desert-rally',
    districts: [
      { label: 'Nile Corniche', flavor: 'palms', accent: 0xfce29c, dust: 0xbca474 },
      { label: 'Khan el-Khalili', flavor: 'market', accent: 0xffaa64, dust: 0xab8c66 },
      { label: 'Giza Excavation', flavor: 'pyramids', accent: 0xffd285, dust: 0xd0b484 }
    ]
  },
  {
    id: 'nairobi', name: 'NAIROBI', flag: '🇰🇪',
    blurb: 'Savanna sun, downtown glass and dusty market alleys — Kenyan speed.',
    ctlMin: 11, ctlVar: 3, rMin: 0.65, rVar: 0.55, fogNear: 40, fogFar: 195,
    layout: 'market-knot',
    districts: [
      { label: 'Uhuru Gardens', flavor: 'palms', accent: 0xffe4a0, dust: 0x9a8a5a },
      { label: 'Westlands', flavor: 'towers', accent: 0xa8c8e8, dust: 0x707868 },
      { label: 'Gikomba Market', flavor: 'market', accent: 0xffa858, dust: 0xa88850 }
    ]
  },
  {
    id: 'seoul', name: 'SEOUL', flag: '🇰🇷',
    blurb: 'K-pop neon meets ancient palace walls. Tight alleys, wide boulevards.',
    ctlMin: 14, ctlVar: 4, rMin: 0.5, rVar: 0.85, fogNear: 28, fogFar: 155,
    layout: 'neon-knot',
    districts: [
      { label: 'Gangnam', flavor: 'towers', accent: 0xff4488, dust: 0x5a4870 },
      { label: 'Gyeongbok Palace', flavor: 'pagoda', accent: 0xd8e0c8, dust: 0x708858 },
      { label: 'Hongdae Arcade', flavor: 'cyberarcade', accent: 0x00ffaa, dust: 0x3a7a68 }
    ]
  },
  {
    id: 'accra', name: 'ACCRA', flag: '🇬🇭',
    blurb: 'Sun-drenched coastal city — Osu palms, Jamestown bricks and Makola chaos.',
    ctlMin: 10, ctlVar: 3, rMin: 0.7, rVar: 0.5, fogNear: 42, fogFar: 190,
    layout: 'waterfront',
    districts: [
      { label: 'Osu Beach', flavor: 'palms', accent: 0xffe898, dust: 0xc0a870 },
      { label: 'Jamestown', flavor: 'terrace', accent: 0xe8d0b0, dust: 0x806a50 },
      { label: 'Makola Market', flavor: 'market', accent: 0xffb050, dust: 0x9a7a48 }
    ]
  },
  {
    id: 'saopaulo', name: 'SÃO PAULO', flag: '🇧🇷',
    blurb: 'Paulista boulevards to painted Vila favelas — concrete jungle alive.',
    ctlMin: 13, ctlVar: 4, rMin: 0.55, rVar: 0.75, fogNear: 32, fogFar: 170,
    layout: 'city-grid',
    districts: [
      { label: 'Av. Paulista', flavor: 'towers', accent: 0xa0b8d0, dust: 0x686e78 },
      { label: 'Vila Madalena', flavor: 'favela', accent: 0xffa060, dust: 0x987a5a },
      { label: 'Liberdade', flavor: 'pagoda', accent: 0xff6870, dust: 0x8a6a68 }
    ]
  },
  {
    id: 'norway', name: 'NORWAY', flag: '🇳🇴',
    blurb: 'Dusk mountain roads under a rising moon — wide sweepers, cold air, no guard rails.',
    ctlMin: 10, ctlVar: 4, rMin: 0.72, rVar: 0.55, fogNear: 42, fogFar: 210,
    layout: 'mountain-switchback',
    music: 'offroad',
    districts: [
      { label: 'Fjord Road', flavor: 'conifers', accent: 0xc07c6a, dust: 0x66745e },
      { label: 'Moon Pass', flavor: 'cabins', accent: 0x815c86, dust: 0x58646e },
      { label: 'Pine Ridge', flavor: 'conifers', accent: 0xa07669, dust: 0x5e6f58 }
    ]
  },
  {
    id: 'iceland', name: 'ICELAND', flag: '🇮🇸',
    blurb: 'Glacial switchbacks across blue ice, black gravel and volcanic frost.',
    ctlMin: 12, ctlVar: 4, rMin: 0.55, rVar: 0.85, fogNear: 30, fogFar: 165,
    layout: 'mountain-switchback',
    music: 'offroad',
    districts: [
      { label: 'Glacier Tongue', flavor: 'rocks', accent: 0xd9f2ff, dust: 0xd6e8ee },
      { label: 'Basalt Flats', flavor: 'rocks', accent: 0xb9d2e1, dust: 0x6d7478 },
      { label: 'Frost Valley', flavor: 'rocks', accent: 0xe1f7ff, dust: 0xc6d6d8 }
    ]
  },
  {
    id: 'canada', name: 'CANADA', flag: '🇨🇦',
    blurb: 'Tall-forest rally lanes through cedar shade, lakeside cabins and mossy cutbacks.',
    ctlMin: 13, ctlVar: 4, rMin: 0.58, rVar: 0.78, fogNear: 36, fogFar: 185,
    layout: 'forest-rally',
    music: 'offroad',
    districts: [
      { label: 'Cedar Run', flavor: 'conifers', accent: 0xbbe8b7, dust: 0x708a50 },
      { label: 'Lake Cabins', flavor: 'cabins', accent: 0xc7efcf, dust: 0x697b52 },
      { label: 'Mossy Cutbacks', flavor: 'conifers', accent: 0x9edfb3, dust: 0x657653 }
    ]
  },
  {
    id: 'newzealand', name: 'NEW ZEALAND', flag: '🇳🇿',
    blurb: 'Bright nature-stage racing over green hills, coastal cliffs and alpine straights.',
    ctlMin: 11, ctlVar: 4, rMin: 0.68, rVar: 0.62, fogNear: 45, fogFar: 205,
    layout: 'coastal',
    music: 'offroad',
    districts: [
      { label: 'Rolling Hills', flavor: 'park', accent: 0xd8f6ff, dust: 0x8daa62 },
      { label: 'Coastal Cliffs', flavor: 'rocks', accent: 0xbfefff, dust: 0xa59c70 },
      { label: 'Alpine Cut', flavor: 'park', accent: 0xe6f5ff, dust: 0x809068 }
    ]
  },
  {
    id: 'finland', name: 'FINLAND', flag: '🇫🇮',
    blurb: 'Snow-laden pines, warm cabins and sharp corners beneath the blue-hour sky.',
    ctlMin: 14, ctlVar: 4, rMin: 0.5, rVar: 0.82, fogNear: 28, fogFar: 160,
    layout: 'forest-rally',
    music: 'offroad',
    districts: [
      { label: 'Stringstar Grove', flavor: 'conifers', accent: 0x668fae, dust: 0xc7dfe9 },
      { label: 'Lantern Lake', flavor: 'cabins', accent: 0xffd398, dust: 0xc7dfe9 },
      { label: 'Midnight Fields', flavor: 'conifers', accent: 0x889dc6, dust: 0xc7dfe9 }
    ]
  },
  {
    id: 'cartoonoval', name: 'CARTOON OVAL', flag: '🏁',
    blurb: 'A bright arcade speedway — long sweepers, wide apron, nowhere to hide.',
    ctlMin: 10, ctlVar: 2, rMin: 0.78, rVar: 0.3, fogNear: 44, fogFar: 200,
    alwaysOpen: true,
    districts: [
      { label: 'Start Park', flavor: 'park', accent: 0xd8f6ff, dust: 0x8da862 },
      { label: 'Grandstand Bend', flavor: 'grandstand', accent: 0xf7d0a0, dust: 0x8b8e58 },
      { label: 'Picnic Straight', flavor: 'grandstand', accent: 0xffc36e, dust: 0x8c8358 }
    ]
  },
  {
    id: 'cota', name: 'LONE STAR GP', flag: '🇺🇸',
    blurb: 'Texas hill-country grand prix — a brutal uphill first turn, then esses.',
    ctlMin: 16, ctlVar: 4, rMin: 0.45, rVar: 0.9, fogNear: 42, fogFar: 205,
    alwaysOpen: true,
    districts: [
      { label: 'Main Straight', flavor: 'grandstand', accent: 0xd8ecff, dust: 0x7a805f },
      { label: 'Esses', flavor: 'park', accent: 0xf0d0a0, dust: 0x927a58 },
      { label: 'Stadium Sector', flavor: 'grandstand', accent: 0xffba78, dust: 0x887054 }
    ]
  }
];
