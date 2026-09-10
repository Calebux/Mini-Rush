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
    boost: { value: 0.0 }   // 0..1 nitro intensity: streaks, fringe, saturation
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
      }
      vec3 c = aces(texel.rgb * exposure);
      c = c * (1.0 - lift) + lift; // raise the black point before crushing it
      c = (c - 0.5) * contrast + 0.5;
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, saturation);
      // shadows toward blue, highlights toward amber
      c += split * vec3(0.9, 0.35, -0.75) * (luma - 0.45);
      c = mix(c, c * vec3(1.06, 1.0, 0.94), boost);       // boost runs warm
      c *= 1.0 - (vignette + boost * 0.35) * dot(toCentre, toCentre);
      c = mix(c, vec3(1.0), flash);
      gl_FragColor = vec4(encodeSRGB(clamp(c, 0.0, 1.0)), texel.a);
    }`
};

export interface PostFX {
  composer: EffectComposer;
  setSize(width: number, height: number, pixelRatio: number): void;
  /**
   * Night maps need the opposite grade to day ones. Crushing an already-dark
   * frame buried the road edges — at night the job is to lift the shadows and
   * back off the blue, because the scene is blue to begin with.
   */
  setMood(night: boolean): void;
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
  return {
    composer,
    setDrama(boostAmount, flashAmount) {
      u.boost.value = boostAmount;
      u.flash.value = flashAmount;
    },
    setMood(night) {
      u.contrast.value = night ? 1.0 : 1.02;
      u.saturation.value = night ? 1.10 : 1.06;
      u.vignette.value = night ? 0.14 : 0.18;
      u.split.value = night ? 0.008 : 0.015;
      u.lift.value = night ? 0.012 : 0.008;
      if (bloom) bloom.strength = night ? 0.62 : 0.34; // neon signs earn it
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
