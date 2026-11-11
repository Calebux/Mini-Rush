import * as T from 'three';

/** A quiet photo stage. Reuses the showroom renderer, car and reflection map. */
export function buildMarketStudio(): T.Group {
  const set = new T.Group(); set.name = 'market-photo-studio';
  const floor = new T.Mesh(new T.PlaneGeometry(90, 90), new T.MeshStandardMaterial({ color: 0x0b1421, metalness: .48, roughness: .39 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.075; floor.receiveShadow = true; set.add(floor);
  const glow = new T.MeshBasicMaterial({ color: 0x83d7ed, toneMapped: false });
  const dark = new T.MeshStandardMaterial({ color: 0x152536, metalness: .5, roughness: .4 });
  // A low horizon ring and vertical light fins give orbit shots depth.
  const horizon = new T.Mesh(new T.TorusGeometry(11, .018, 6, 128), glow);
  horizon.rotation.x = Math.PI / 2; horizon.position.y = .04; set.add(horizon);
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    const fin = new T.Mesh(new T.BoxGeometry(.11, 3.8, .18), dark);
    fin.position.set(Math.sin(angle)*11, 1.9, Math.cos(angle)*11); fin.rotation.y = angle;
    const light = new T.Mesh(new T.BoxGeometry(.025, 3.35, .025), glow);
    light.position.set(-Math.sin(angle)*.11,0,-Math.cos(angle)*.11); fin.add(light); set.add(fin);
  }
  set.add(new T.HemisphereLight(0xbad7ef, 0x101520, .8));
  const key = new T.DirectionalLight(0xfff2dd, 3.3); key.position.set(-3,6,5); key.castShadow = true;
  key.shadow.mapSize.set(1024,1024); key.shadow.camera.left=-4; key.shadow.camera.right=4;
  key.shadow.camera.top=4; key.shadow.camera.bottom=-4; key.shadow.bias=-.0004; set.add(key);
  const rim = new T.DirectionalLight(0x83dfff, 2.5); rim.position.set(4,3,-4); set.add(rim);
  const fill = new T.DirectionalLight(0xcedaff, .8); fill.position.set(-4,2,-2); set.add(fill);
  return set;
}
