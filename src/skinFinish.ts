import * as T from 'three';
import type { SkinDesign } from './skins';

/** Root-space stripes stay aligned across separate hood/roof meshes and through race turns. */
export function applySkinFinish(root: T.Group, design?: SkinDesign): void {
  if (!design) return;
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const bounds = new T.Box3().setFromObject(root).applyMatrix4(inverse);
  const center = (bounds.min.x + bounds.max.x) / 2;
  const halfWidth = Math.max(.1, (bounds.max.x - bounds.min.x) / 2);
  const replaced = new Set<T.Material>();
  root.traverse(obj => {
    if (!(obj instanceof T.Mesh)) return;
    const matrix = inverse.clone().multiply(obj.matrixWorld);
    const convert = (source: T.Material): T.Material => {
      if (!source.userData.isPaint && source.userData.carRole !== 'paint') return source;
      const material = source.clone() as T.MeshPhysicalMaterial;
      material.userData = { ...source.userData, instanceOwned: true, skinPattern: design.pattern, skinFinish: design.finish };
      material.color.setHex(design.color);
      if ('roughness' in material) material.roughness = design.finish === 'satin' ? .65 : .24;
      if ('clearcoat' in material) { material.clearcoat = design.finish === 'satin' ? .12 : 1; material.clearcoatRoughness = .12; }
      if ('shininess' in material) (material as unknown as T.MeshPhongMaterial).shininess = design.finish === 'satin' ? 12 : 90;
      if (design.pattern === 'stripes') {
        material.onBeforeCompile = shader => {
          shader.uniforms.skinMatrix = { value: matrix };
          shader.uniforms.skinAccent = { value: new T.Color(design.accent) };
          shader.uniforms.skinCenter = { value: center };
          shader.uniforms.skinWidth = { value: halfWidth };
          shader.vertexShader = 'uniform mat4 skinMatrix; varying vec3 vSkinPosition;\n' + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkinPosition = (skinMatrix * vec4(position, 1.0)).xyz;');
          shader.fragmentShader = 'uniform vec3 skinAccent; uniform float skinCenter; uniform float skinWidth; varying vec3 vSkinPosition;\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
            float stripeX = abs(vSkinPosition.x - skinCenter) / skinWidth;
            float stripeMask = smoothstep(0.095, 0.11, stripeX) * (1.0 - smoothstep(0.245, 0.26, stripeX));
            diffuseColor.rgb = mix(diffuseColor.rgb, skinAccent, stripeMask);`);
        };
        material.customProgramCacheKey = () => 'minirush-twin-stripes-v1';
      }
      if (source.userData.instanceOwned || root.userData.procedural) replaced.add(source);
      root.userData.ownMaterials = true;
      return material;
    };
    obj.material = Array.isArray(obj.material) ? obj.material.map(convert) : convert(obj.material);
  });
  replaced.forEach(material => material.dispose());
  root.userData.skinDesign = { ...design };
}
