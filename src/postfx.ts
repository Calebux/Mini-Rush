import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { QUALITY, QualityTier } from './quality';

/**
 * The finishing pass.
 *
 * Everything up to here renders into a linear HDR buffer — three disables the
 * material-side tone mapping automatically when the target is not the canvas —
 * so this shader owns the whole trip to screen: ACES, then the grade, then the
 * sRGB encode. Doing it in one pass rather than three's OutputPass + a separate
 * grade keeps the phone tier down to a single fullscreen draw.
 *
 * The grade itself is what a flat render is missing: contrast to open up a
 * value range, a shadows-cool/highlights-warm split so the whole frame is not
 * one temperature, and a vignette to stop the edges competing with the road.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    exposure: { value: 1.08 }, // the renderer's own exposure, which the
                               // render-to-target path skips
    contrast: { value: 1.02 },
    saturation: { value: 1.06 },
    vignette: { value: 0.26 },
    split: { value: 0.035 },
    lift: { value: 0.008 },
    flash: { value: 0.0 },  // impact whiteout
    boost: { value: 0.0 },  // 0..1 nitro intensity: streaks, fringe, saturation
    // colour styles (LOOKS): split toning, lens fringe, film grain, monochrome
    shadowTint: { value: new THREE.Color(1, 1, 1) },
    highTint: { value: new THREE.Color(1, 1, 1) },
    tone: { value: 0.0 },
    fringe: { value: 0.0 },
    grain: { value: 0.0 },
    mono: { value: 0.0 },     // 1 = black and white
    keepRed: { value: 0.0 },  // ...except what is strongly red
    time: { value: 0.0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float exposure, contrast, saturation, vignette, split, lift, flash, boost;
    uniform vec3 shadowTint, highTint;
    uniform float tone, fringe, grain, mono, keepRed, time;
    varying vec2 vUv;

    // Match the installed three.js ACES math (MIT) on the direct-render tier.
    // The per-channel approximation clipped saturated paint and made quality
    // changes alter the car's colour. Matrices preserve the highlight hue.
    vec3 aces(vec3 x) {
      const mat3 inputMat = mat3(
        vec3(0.59719, 0.07600, 0.02840),
        vec3(0.35458, 0.90834, 0.13383),
        vec3(0.04823, 0.01566, 0.83777));
      const mat3 outputMat = mat3(
        vec3(1.60475, -0.10208, -0.00327),
        vec3(-0.53108, 1.10813, -0.07276),
        vec3(-0.07367, -0.00605, 1.07602));
      x = inputMat * (x / 0.6);
      vec3 a = x * (x + 0.0245786) - 0.000090537;
      vec3 b = x * (0.983729 * x + 0.4329510) + 0.238081;
      return clamp(outputMat * (a / b), 0.0, 1.0);
    }
    vec3 encodeSRGB(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
        step(vec3(0.0031308), c));
    }

    void main() {
      vec2 toCentre = vUv - 0.5;
      float edge = dot(toCentre, toCentre) * 4.0;
      vec4 texel;
      if (boost > 0.01) {
        // Radial streaks: smear each sample back toward the centre so the world
        // stretches past you. Strength rises with distance from the middle, so
        // the road stays sharp and the edges tear.
        float reach = boost * 0.055 * edge;
        vec3 sum = vec3(0.0);
        for (int i = 0; i < 5; i++) {
          float k = float(i) / 4.0;
          sum += texture2D(tDiffuse, vUv - toCentre * reach * k).rgb;
        }
        texel = vec4(sum / 5.0, 1.0);
        // chromatic fringe pulls red and blue apart at the rim
        float split2 = boost * 0.004 * edge;
        texel.r = texture2D(tDiffuse, vUv - toCentre * split2).r;
        texel.b = texture2D(tDiffuse, vUv + toCentre * split2).b;
      } else {
        texel = texture2D(tDiffuse, vUv);
        if (fringe > 0.0) {
          // a lens that is not quite perfect: red and blue part at the rim
          float f = fringe * edge;
          texel.r = texture2D(tDiffuse, vUv - toCentre * f).r;
          texel.b = texture2D(tDiffuse, vUv + toCentre * f).b;
        }
      }
      vec3 c = aces(texel.rgb * exposure);
      c = c * (1.0 - lift) + lift; // raise the black point before crushing it
      c = (c - 0.5) * contrast + 0.5;
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, saturation);
      // shadows toward blue, highlights toward amber
      c += split * vec3(0.9, 0.35, -0.75) * (luma - 0.45);
      // the style's own split toning
      c = mix(c, c * shadowTint, (1.0 - luma) * tone);
      c = mix(c, c * highTint, luma * tone);
      if (mono > 0.0) {
        float red = smoothstep(0.06, 0.28, c.r - max(c.g, c.b)) * keepRed;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(c, mix(vec3(l), c, red), mono);
      }
      c = mix(c, c * vec3(1.06, 1.0, 0.94), boost);       // boost runs warm
      c *= 1.0 - (vignette + boost * 0.35) * dot(toCentre, toCentre);
      c = mix(c, vec3(1.0), flash);
      if (grain > 0.0) {
        float n = fract(sin(dot(gl_FragCoord.xy + time * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
        c += (n - 0.5) * grain;
      }
      gl_FragColor = vec4(encodeSRGB(clamp(c, 0.0, 1.0)), texel.a);
    }`
};

/** Colour styles, after the ones threejspunk offers. `auto` is the map's own grade. */
export const LOOKS = [
  { id: 'auto', label: 'AUTO' },
  { id: 'neon-noir', label: 'NEON NOIR' },
  { id: 'magenta-rain', label: 'MAGENTA RAIN' },
  { id: 'teal-dusk', label: 'TEAL DUSK' },
  { id: 'silent-hill', label: 'SILENT HILL' },
  { id: 'sin-city', label: 'SIN CITY' },
  { id: 'neutral', label: 'NEUTRAL' }
] as const;
export type LookId = typeof LOOKS[number]['id'];

interface Look {
  contrast: number; saturation: number; vignette: number; split: number; lift: number;
  shadow: [number, number, number]; high: [number, number, number]; tone: number;
  fringe: number; grain: number; mono: number; keepRed: number; bloom: number;
}

const PLAIN: Omit<Look, 'contrast' | 'saturation' | 'vignette' | 'bloom'> = {
  split: 0, lift: 0, shadow: [1, 1, 1], high: [1, 1, 1], tone: 0, fringe: 0, grain: 0, mono: 0, keepRed: 0
};

const STYLES: Record<Exclude<LookId, 'auto'>, Look> = {
  'neon-noir': { ...PLAIN, contrast: 1.06, saturation: 1.28, vignette: 0.28, lift: 0.02,
    shadow: [0.78, 0.95, 1.25], high: [1.18, 0.93, 1.12], tone: 0.45, fringe: 0.0022, grain: 0.03, bloom: 0.42 },
  'magenta-rain': { ...PLAIN, contrast: 1.08, saturation: 1.35, vignette: 0.3,
    shadow: [1.08, 0.74, 1.3], high: [1.3, 0.86, 1.08], tone: 0.55, fringe: 0.002, grain: 0.03, bloom: 0.5 },
  'teal-dusk': { ...PLAIN, contrast: 1.05, saturation: 1.1, vignette: 0.26,
    shadow: [0.7, 1.05, 1.15], high: [1.2, 1.02, 0.82], tone: 0.5, fringe: 0.0015, grain: 0.025, bloom: 0.75 },
  'silent-hill': { ...PLAIN, contrast: 0.86, saturation: 0.35, vignette: 0.4, lift: 0.07,
    shadow: [0.95, 0.97, 1.0], high: [1.02, 1.0, 0.96], tone: 0.2, grain: 0.05, bloom: 0.4 },
  'sin-city': { ...PLAIN, contrast: 1.35, saturation: 1.0, vignette: 0.4,
    mono: 1, keepRed: 1, fringe: 0.0012, grain: 0.045, bloom: 0.7 },
  neutral: { ...PLAIN, contrast: 1.0, saturation: 1.0, vignette: 0.12, bloom: 0.4 }
};

const LOOK_KEY = 'minirush.look';

/** The style the player picked; `auto` until they pick one. */
export function savedLook(): LookId {
  try {
    const id = localStorage.getItem(LOOK_KEY);
    return LOOKS.some((l) => l.id === id) ? id as LookId : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveLook(id: LookId): void {
  try { localStorage.setItem(LOOK_KEY, id); } catch { /* it lasts this session */ }
}

export interface PostFX {
  composer: EffectComposer;
  setSize(width: number, height: number, pixelRatio: number): void;
  /**
   * Night maps need the opposite grade to day ones. Crushing an already-dark
   * frame buried the road edges — at night the job is to lift the shadows and
   * back off the blue, because the scene is blue to begin with.
   */
  setMood(night: boolean): void;
  /**
   * The colour style. `auto` keeps the map's own grade; `neon` says the map is
   * one of the neon cities, where auto means Neon Noir.
   */
  setLook(look: LookId, neon: boolean): void;
  /** Advance the film grain. */
  tick(time: number): void;
  /** Per-frame drama: `boost` 0..1 for nitro, `flash` 0..1 for an impact. */
  setDrama(boost: number, flash: number): void;
  dispose(): void;
}

/**
 * Tiers 1 and 2 render through the composer; tier 0 is the "we are already
 * struggling" tier and keeps the direct path with no extra fullscreen work.
 * Bloom is desktop-only — it is several half-res passes on its own.
 */
export function createPostFX(
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, tier: QualityTier
): PostFX | null {
  if (!QUALITY[tier].grade) return null;
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  let bloom: UnrealBloomPass | null = null;
  if (QUALITY[tier].bloom) {
    bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), 0.34, 0.75, 0.92);
    composer.addPass(bloom);
  }
  const grade = new ShaderPass(GradeShader);
  grade.renderToScreen = true;
  composer.addPass(grade);
  const u = grade.uniforms;
  let night = false, look: LookId = 'auto', neonMap = false;
  const apply = (): void => {
    const style = look === 'auto' ? (neonMap ? STYLES['neon-noir'] : null) : STYLES[look];
    if (style) {
      u.contrast.value = style.contrast;
      u.saturation.value = style.saturation;
      u.vignette.value = style.vignette;
      u.split.value = style.split;
      u.lift.value = style.lift;
      (u.shadowTint.value as THREE.Color).setRGB(...style.shadow);
      (u.highTint.value as THREE.Color).setRGB(...style.high);
      u.tone.value = style.tone;
      u.fringe.value = style.fringe;
      u.grain.value = style.grain;
      u.mono.value = style.mono;
      u.keepRed.value = style.keepRed;
      if (bloom) bloom.strength = style.bloom;
      return;
    }
    u.contrast.value = night ? 1.0 : 1.02;
    u.saturation.value = night ? 1.10 : 1.06;
    u.vignette.value = night ? 0.14 : 0.18;
    u.split.value = night ? 0.008 : 0.015;
    u.lift.value = night ? 0.012 : 0.008;
    u.tone.value = u.fringe.value = u.grain.value = u.mono.value = u.keepRed.value = 0;
    if (bloom) bloom.strength = night ? 0.62 : 0.34; // neon signs earn it
  };
  return {
    composer,
    setDrama(boostAmount, flashAmount) {
      u.boost.value = boostAmount;
      u.flash.value = flashAmount;
    },
    setMood(isNight) {
      night = isNight;
      apply();
    },
    setLook(id, neon) {
      look = id;
      neonMap = neon;
      apply();
    },
    tick(time) {
      u.time.value = time % 100;
    },
    setSize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
      bloom?.setSize(width * pixelRatio, height * pixelRatio);
    },
    dispose() {
      composer.dispose();
      bloom?.dispose();
      grade.dispose();
    }
  };
}
