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
        float sun = max(dot(dir, sunDirection), 0.0);
        // Day: haze on the horizon, the map's sky colour above it, a deeper zenith overhead.
        // A chase camera only ever sees the lowest third of the dome, so the colour has to
        // arrive early; one slow blend left every daytime map looking overcast.
        vec3 day = mix(bottom, top, smoothstep(0.0, .2, h));
        day = mix(day, top * vec3(.46, .64, .95), smoothstep(.12, .8, h));
        day += vec3(1.0, .74, .44) * (pow(sun, 6.0) * .2 + pow(sun, 48.0) * .3);
        vec3 c = mix(mix(bottom, top, pow(h, .45)), day, daylight);
        if (clouds > .001 && dir.y > .02) {
          // A fixed world-space layer stays stable when the camera turns.
          vec2 p = dir.xz / (dir.y + .32) * 3.1 + vec2(12.0, 4.0);
          float n = noise(p) * .58 + noise(p * 2.07) * .28 + noise(p * 4.13) * .14;
          // Fair weather breaks into separate clouds with blue between; rain closes the gaps.
          float heavy = smoothstep(.6, .9, clouds);
          float edge = mix(.56, .4, heavy);
          float cloud = smoothstep(edge, edge + .16, n) * smoothstep(.03, .2, dir.y);
          // Lit from the sun side: the same field sampled a step towards the sun is thinner there.
          float toSun = noise(p + sunDirection.xz * .22) * .58 + noise((p + sunDirection.xz * .22) * 2.07) * .28;
          float lit = clamp(.55 + (n - toSun / .86) * 2.4 + sun * .25, 0.0, 1.0);
          vec3 shade = mix(mix(vec3(.60, .67, .77), vec3(.50, .54, .60), heavy), mix(vec3(1.0, .98, .94), vec3(.86, .87, .88), heavy), lit);
          c = mix(c, shade, cloud * min(1.0, clouds * 1.6));
        }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false
  });
}
