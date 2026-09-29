import * as THREE from 'three';

/**
 * Rain that falls in the world, not on the glass. A box of streaks wraps
 * around the camera on the GPU: each drop's position is a fixed random point
 * shifted by time and folded back into the box with mod(), so there is no
 * per-frame CPU work and the drops stay put in the world — drive fast and you
 * tear through them, which is most of what makes rain read as speed.
 *
 * One LineSegments draw. The count is the only knob the quality tier turns.
 */
const BOX = new THREE.Vector3(46, 24, 46);

export class Rain {
  readonly object: THREE.LineSegments;
  private material: THREE.ShaderMaterial;

  constructor(drops: number, color = 0xa9c2ff, opacity = 0.42) {
    const position = new Float32Array(drops * 2 * 3);
    const end = new Float32Array(drops * 2);
    for (let i = 0; i < drops; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      position.set([x, y, z, x, y, z], i * 6);
      end[i * 2 + 1] = 1;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uBox: { value: BOX.clone() },
        uFall: { value: 19 },
        uLen: { value: 0.95 },
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity }
      },
      vertexShader: `
        attribute float aEnd;
        uniform float uTime, uFall, uLen;
        uniform vec3 uCam, uBox;
        varying float vAlpha;
        void main() {
          vec3 origin = vec3(uCam.x - uBox.x * 0.5, -0.6, uCam.z - uBox.z * 0.5);
          vec3 p = position * uBox;
          p.y -= uTime * uFall;
          vec3 world = origin + mod(p - origin, uBox);
          // the tail trails up and slightly upwind of the head
          world += vec3(0.1, 1.0, 0.04) * aEnd * uLen;
          float d = length(world.xz - uCam.xz);
          vAlpha = (1.0 - smoothstep(9.0, uBox.x * 0.5, d)) * (1.0 - aEnd * 0.85)
                 * smoothstep(-0.6, 0.6, world.y);
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(uColor, vAlpha * uOpacity);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.object = new THREE.LineSegments(geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 3;
  }

  update(camera: THREE.Camera, time: number): void {
    this.material.uniforms.uTime.value = time;
    (this.material.uniforms.uCam.value as THREE.Vector3).copy(camera.position);
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}
