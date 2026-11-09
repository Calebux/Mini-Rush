import * as THREE from 'three';
import type { EnvironmentTheme } from './environment';

/** Directional daylight and cloud layers, evaluated on the existing sky dome. */
export function raceSkyMaterial(theme: EnvironmentTheme): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(theme.sky) },
      bottom: { value: new THREE.Color(theme.horizon) },
      sunDirection: { value: new THREE.Vector3(-35, 30, -30).normalize() },
      clouds: { value: .38 },
      daylight: { value: 1 }
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top, bottom, sunDirection;
      uniform float clouds, daylight;
      varying vec3 vDirection;
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
      }
      void main() {
        vec3 dir = normalize(vDirection);
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 c = mix(bottom, top, pow(h, .45));
        float sun = max(dot(dir, sunDirection), 0.0);
        c += vec3(1.0, .77, .46) * pow(sun, 32.0) * .16 * daylight;
        if (clouds > .001 && dir.y > .02) {
          // A fixed world-space layer stays stable when the camera turns.
          vec2 p = dir.xz / (dir.y + .32) * 3.1 + vec2(12.0, 4.0);
          float n = noise(p) * .58 + noise(p * 2.07) * .28 + noise(p * 4.13) * .14;
          float cloud = smoothstep(.47, .72, n) * smoothstep(.02, .18, dir.y);
          vec3 shade = mix(vec3(.52, .59, .65), vec3(.95, .91, .83), n);
          c = mix(c, shade, cloud * clouds);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false
  });
}
