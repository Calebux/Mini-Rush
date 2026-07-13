// The World Outbreak Tour. Each map is a city with three districts along the
// lap — its own cel palette, scenery flavor, fog mood, and track shape.
// Districts blend into each other as you drive (game.ts blendBiome).

export type Flavor =
  | 'towers'   // downtown blocks, streetlights, racing barriers
  | 'palms'    // beachfront — palm trees + low painted buildings
  | 'pagoda'   // tiled-roof houses + red lantern poles
  | 'park'     // round trees, sparse and green
  | 'terrace'  // brick row houses, chimneys, the odd phone box
  | 'market';  // street stalls under striped awnings

export interface District {
  label: string;
  flavor: Flavor;
  skyTop: number;
  skyBottom: number;
  fog: number;
  ground: number;
  road: number;
  hemi: number;
  dust: number; // offroad dust puff color
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
  fogNear: number;
  fogFar: number;
  skyline?: string; // horizon panorama sprite (assets/sprites/<name>.png)
  districts: [District, District, District];
}

export const MAPS: MapSpec[] = [
  {
    id: 'lagos', name: 'LAGOS', flag: '🇳🇬',
    blurb: 'Flowing sweepers from the Island to the market — golden hour, all hour.',
    ctlMin: 10, ctlVar: 3, rMin: 0.7, rVar: 0.5, fogNear: 40, fogFar: 185,
    districts: [
      { label: 'The Island', flavor: 'towers',
        skyTop: 0x35418f, skyBottom: 0xffb45e, fog: 0xd88a5a, ground: 0x46543e, road: 0x8f939f, hemi: 0xffd9b0, dust: 0xb99e6a },
      { label: 'Bar Beach', flavor: 'palms',
        skyTop: 0x2f9fd8, skyBottom: 0xbfeef2, fog: 0xa8d8d8, ground: 0xe0c78f, road: 0x9aa0a8, hemi: 0xfff2d0, dust: 0xe0c78f },
      { label: 'Balogun Market', flavor: 'market',
        skyTop: 0x5a3a8f, skyBottom: 0xff8a4a, fog: 0xc47a50, ground: 0x6b5a40, road: 0x8a8a90, hemi: 0xffc9a0, dust: 0xa08858 }
    ]
  },
  {
    id: 'beijing', name: 'BEIJING', flag: '🇨🇳',
    blurb: 'Tight technical corners through hutongs, temple gardens and the CBD haze.',
    ctlMin: 13, ctlVar: 4, rMin: 0.55, rVar: 0.85, fogNear: 35, fogFar: 165,
    districts: [
      { label: 'Hutongs', flavor: 'pagoda',
        skyTop: 0xc76a55, skyBottom: 0xf2c98a, fog: 0xe0b088, ground: 0x8a7a5f, road: 0xa39a8a, hemi: 0xffe0c0, dust: 0xb0987a },
      { label: 'Temple Gardens', flavor: 'park',
        skyTop: 0x4a9fd8, skyBottom: 0xcfe8c0, fog: 0xb8d0a8, ground: 0x5f9a4f, road: 0xa8a49a, hemi: 0xe8f6d8, dust: 0x8a9a5a },
      { label: 'CBD', flavor: 'towers',
        skyTop: 0x2a3a6f, skyBottom: 0x8fb8d8, fog: 0x8fa0b8, ground: 0x3a4252, road: 0x9aa0b4, hemi: 0xcfe0ff, dust: 0x8a8f9a }
    ]
  },
  {
    id: 'mumbai', name: 'MUMBAI', flag: '🇮🇳',
    blurb: 'Chaotic rhythm — painted facades, Marine Drive palms, bazaar squeeze.',
    ctlMin: 12, ctlVar: 4, rMin: 0.6, rVar: 0.75, fogNear: 40, fogFar: 185,
    districts: [
      { label: 'Colaba', flavor: 'towers',
        skyTop: 0x2a7fd8, skyBottom: 0xffd98a, fog: 0xe8c890, ground: 0x7a6a4a, road: 0x9a948a, hemi: 0xfff0c8, dust: 0xb09a6a },
      { label: 'Marine Drive', flavor: 'palms',
        skyTop: 0x1f8fb8, skyBottom: 0xa8e8e0, fog: 0x98c8c8, ground: 0xd8bc86, road: 0x9aa0a8, hemi: 0xf0fae0, dust: 0xd8bc86 },
      { label: 'Crawford Bazaar', flavor: 'market',
        skyTop: 0x6f2a8f, skyBottom: 0xff9a5e, fog: 0xd08a68, ground: 0x6a5540, road: 0x8a8580, hemi: 0xffd0a8, dust: 0xa8865a }
    ]
  },
  {
    id: 'neon', name: 'NEON CITY', flag: '🌃',
    blurb: 'Rain-slick cyberpunk streets — all glow, no mercy, midnight forever.',
    ctlMin: 12, ctlVar: 4, rMin: 0.55, rVar: 0.8, fogNear: 26, fogFar: 150,
    skyline: 'skyline_neon',
    districts: [
      { label: 'Neon Strip', flavor: 'towers',
        skyTop: 0x070b24, skyBottom: 0xff2e8a, fog: 0x3a1048, ground: 0x131832, road: 0x3a4054, hemi: 0x9a7aff, dust: 0x5a4a7a },
      { label: 'Night Market', flavor: 'market',
        skyTop: 0x0a1030, skyBottom: 0x00d9ff, fog: 0x14354e, ground: 0x101a2c, road: 0x38404e, hemi: 0x7adfff, dust: 0x3a5a6a },
      { label: 'Circuit Docks', flavor: 'terrace',
        skyTop: 0x120a2e, skyBottom: 0x8b5cf6, fog: 0x2a1a46, ground: 0x141228, road: 0x3c3a52, hemi: 0xa98aff, dust: 0x4a3a6a }
    ]
  },
  {
    id: 'london', name: 'LONDON', flag: '🇬🇧',
    blurb: 'A murky, unforgiving street circuit — terraces, Hyde Park, the Square Mile.',
    ctlMin: 14, ctlVar: 3, rMin: 0.5, rVar: 0.7, fogNear: 30, fogFar: 145,
    districts: [
      { label: 'The Terraces', flavor: 'terrace',
        skyTop: 0x5a6a8a, skyBottom: 0xb8c2d0, fog: 0xaab4c2, ground: 0x4a5548, road: 0x767c88, hemi: 0xd8e0ea, dust: 0x707a68 },
      { label: 'Hyde Park', flavor: 'park',
        skyTop: 0x6a8ab0, skyBottom: 0xcfdce0, fog: 0xb0c2b8, ground: 0x4f7a42, road: 0x8a8f8a, hemi: 0xe0ecda, dust: 0x6a8a50 },
      { label: 'Square Mile', flavor: 'towers',
        skyTop: 0x3f4f6f, skyBottom: 0x9fb0c2, fog: 0x92a0b2, ground: 0x39404e, road: 0x8a92a2, hemi: 0xc8d6e8, dust: 0x788090 }
    ]
  }
];
