// The World Outbreak Tour. Each map is a city with three districts along the
// lap — its own cel palette, scenery flavor, fog mood, and track shape.
// Districts blend into each other as you drive (game.ts blendBiome).

export type Flavor =
  | 'towers'       // downtown blocks, streetlights, racing barriers
  | 'palms'        // beachfront — palm trees + low painted buildings
  | 'pagoda'       // tiled-roof houses + red lantern poles
  | 'park'         // round trees, sparse and green
  | 'terrace'      // brick row houses, chimneys, the odd phone box
  | 'market'       // street stalls under striped awnings
  | 'pyramids'     // desert obelisks, ancient ruins & stone pillars
  | 'favela'       // terraced colorful shacks & hillside stairs
  | 'cyberarcade'; // neon hologram signs & arcade arches

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
  },
  {
    id: 'tokyo', name: 'TOKYO', flag: '🇯🇵',
    blurb: 'Touge drift switchbacks across Shibuya crossing, arcade alleys and Mt. Fuji pass.',
    ctlMin: 16, ctlVar: 4, rMin: 0.45, rVar: 0.9, fogNear: 30, fogFar: 155,
    skyline: 'skyline_tokyo',
    districts: [
      { label: 'Shibuya Crossing', flavor: 'towers',
        skyTop: 0x1a0d35, skyBottom: 0xff3b94, fog: 0x5c2b6a, ground: 0x241a34, road: 0x423c52, hemi: 0xff8cd5, dust: 0x7a508f },
      { label: 'Akihabara Alleys', flavor: 'cyberarcade',
        skyTop: 0x0f1b3e, skyBottom: 0x00ffcc, fog: 0x1f4e5a, ground: 0x182638, road: 0x3e4856, hemi: 0xaaffea, dust: 0x408a80 },
      { label: 'Fuji Shrine Pass', flavor: 'pagoda',
        skyTop: 0x2b4f6a, skyBottom: 0xd5eef8, fog: 0x8aadb8, ground: 0x4a6e56, road: 0x869498, hemi: 0xe6f8ff, dust: 0x6e8e7a }
    ]
  },
  {
    id: 'rio', name: 'RIO DE JANEIRO', flag: '🇧🇷',
    blurb: 'High-speed Copacabana curves plunging into tight hillside favela stairways.',
    ctlMin: 11, ctlVar: 3, rMin: 0.65, rVar: 0.6, fogNear: 45, fogFar: 190,
    skyline: 'skyline_rio',
    districts: [
      { label: 'Copacabana Beach', flavor: 'palms',
        skyTop: 0x1e8adb, skyBottom: 0xffdf78, fog: 0xcadaab, ground: 0xd9c086, road: 0x95999e, hemi: 0xfffae0, dust: 0xd9c086 },
      { label: 'Santa Teresa', flavor: 'favela',
        skyTop: 0x3868ab, skyBottom: 0xff9c5b, fog: 0xcb8e72, ground: 0x6e6252, road: 0x888a8e, hemi: 0xffe2c4, dust: 0xa28e72 },
      { label: 'Hillside Market', flavor: 'market',
        skyTop: 0x5a347e, skyBottom: 0xff6b4a, fog: 0xb86c5e, ground: 0x5c5044, road: 0x808086, hemi: 0xffd2ba, dust: 0x967a64 }
    ]
  },
  {
    id: 'cairo', name: 'CAIRO', flag: '🇪🇬',
    blurb: 'Wide-open desert rally straights across ancient pyramids and dusty bazaars.',
    ctlMin: 9, ctlVar: 3, rMin: 0.8, rVar: 0.4, fogNear: 35, fogFar: 200,
    skyline: 'skyline_cairo',
    districts: [
      { label: 'Nile Corniche', flavor: 'palms',
        skyTop: 0x2f78b8, skyBottom: 0xfce29c, fog: 0xd8c898, ground: 0xa89466, road: 0x9a968e, hemi: 0xfffae8, dust: 0xbca474 },
      { label: 'Khan el-Khalili', flavor: 'market',
        skyTop: 0x8a4b32, skyBottom: 0xffaa64, fog: 0xd68f6a, ground: 0x7c664c, road: 0x8e867a, hemi: 0xffe0c2, dust: 0xab8c66 },
      { label: 'Giza Excavation', flavor: 'pyramids',
        skyTop: 0x4b6e8a, skyBottom: 0xffd285, fog: 0xcaa67e, ground: 0xc8aa78, road: 0x9c988c, hemi: 0xfff4d6, dust: 0xd0b484 }
    ]
  },
  {
    id: 'nairobi', name: 'NAIROBI', flag: '🇰🇪',
    blurb: 'Savanna sun, downtown glass and dusty market alleys — Kenyan speed.',
    ctlMin: 11, ctlVar: 3, rMin: 0.65, rVar: 0.55, fogNear: 40, fogFar: 195,
    districts: [
      { label: 'Uhuru Gardens', flavor: 'palms',
        skyTop: 0x2a88c8, skyBottom: 0xffe4a0, fog: 0xd0b888, ground: 0x7a9a52, road: 0x969892, hemi: 0xfff6d8, dust: 0x9a8a5a },
      { label: 'Westlands', flavor: 'towers',
        skyTop: 0x2e5a8f, skyBottom: 0xa8c8e8, fog: 0x98b0c8, ground: 0x4a524a, road: 0x8e929a, hemi: 0xd8e6f2, dust: 0x707868 },
      { label: 'Gikomba Market', flavor: 'market',
        skyTop: 0x6a3e28, skyBottom: 0xffa858, fog: 0xc88858, ground: 0x6e5a3a, road: 0x8a8480, hemi: 0xffd0a0, dust: 0xa88850 }
    ]
  },
  {
    id: 'seoul', name: 'SEOUL', flag: '🇰🇷',
    blurb: 'K-pop neon meets ancient palace walls. Tight alleys, wide boulevards.',
    ctlMin: 14, ctlVar: 4, rMin: 0.5, rVar: 0.85, fogNear: 28, fogFar: 155,
    skyline: 'skyline_neon',
    districts: [
      { label: 'Gangnam', flavor: 'towers',
        skyTop: 0x1a1040, skyBottom: 0xff4488, fog: 0x4a2058, ground: 0x1e1a30, road: 0x3e3a50, hemi: 0xcc80ff, dust: 0x5a4870 },
      { label: 'Gyeongbok Palace', flavor: 'pagoda',
        skyTop: 0x2a5a7a, skyBottom: 0xd8e0c8, fog: 0xa0b8a0, ground: 0x506a48, road: 0x8a9088, hemi: 0xe0f0d8, dust: 0x708858 },
      { label: 'Hongdae Arcade', flavor: 'cyberarcade',
        skyTop: 0x0e1838, skyBottom: 0x00ffaa, fog: 0x1a4858, ground: 0x141e30, road: 0x3a4250, hemi: 0x88ffe0, dust: 0x3a7a68 }
    ]
  },
  {
    id: 'accra', name: 'ACCRA', flag: '🇬🇭',
    blurb: 'Sun-drenched coastal city — Osu palms, Jamestown bricks and Makola chaos.',
    ctlMin: 10, ctlVar: 3, rMin: 0.7, rVar: 0.5, fogNear: 42, fogFar: 190,
    districts: [
      { label: 'Osu Beach', flavor: 'palms',
        skyTop: 0x2590c8, skyBottom: 0xffe898, fog: 0xc8c098, ground: 0xd0b480, road: 0x949690, hemi: 0xfff8e0, dust: 0xc0a870 },
      { label: 'Jamestown', flavor: 'terrace',
        skyTop: 0x5a6880, skyBottom: 0xe8d0b0, fog: 0xb0a890, ground: 0x605848, road: 0x7e807a, hemi: 0xe8e0d0, dust: 0x806a50 },
      { label: 'Makola Market', flavor: 'market',
        skyTop: 0x6e4028, skyBottom: 0xffb050, fog: 0xc09050, ground: 0x685838, road: 0x888480, hemi: 0xffd8a0, dust: 0x9a7a48 }
    ]
  },
  {
    id: 'saopaulo', name: 'SÃO PAULO', flag: '🇧🇷',
    blurb: 'Paulista boulevards to painted Vila favelas — concrete jungle alive.',
    ctlMin: 13, ctlVar: 4, rMin: 0.55, rVar: 0.75, fogNear: 32, fogFar: 170,
    districts: [
      { label: 'Av. Paulista', flavor: 'towers',
        skyTop: 0x2a4878, skyBottom: 0xa0b8d0, fog: 0x90a8b8, ground: 0x404848, road: 0x8a8e98, hemi: 0xd0dce8, dust: 0x686e78 },
      { label: 'Vila Madalena', flavor: 'favela',
        skyTop: 0x4a6a9a, skyBottom: 0xffa060, fog: 0xc09068, ground: 0x6a5a4a, road: 0x868480, hemi: 0xffe0c0, dust: 0x987a5a },
      { label: 'Liberdade', flavor: 'pagoda',
        skyTop: 0x5a2848, skyBottom: 0xff6870, fog: 0xb86068, ground: 0x584a48, road: 0x8a8488, hemi: 0xffc8c8, dust: 0x8a6a68 }
    ]
  }
];
