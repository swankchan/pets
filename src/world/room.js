// A small living room, fully procedural: floor, walls, window, furniture and
// every object the cat cares about (bowls, bed, post, litter, perches).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { woodFloor, rugTexture, fabric, wallTexture } from './textures.js';

const W = 6.0, D = 5.0, H = 2.6;

function box(w, h, d, mat, r = 0.02) {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, Math.min(w, h, d) * 0.49));
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function buildRoom(scene, quality) {
  const group = new THREE.Group();
  scene.add(group);

  const floorMat = new THREE.MeshPhysicalMaterial({
    map: woodFloor(quality.texSize), roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.4,
  });
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.95, side: THREE.DoubleSide });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 1 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H;
  group.add(ceiling);

  const mkWall = (w, x, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), wallMat);
    m.position.set(x, H / 2, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  mkWall(W, 0, -D / 2, 0);
  mkWall(W, 0, D / 2, Math.PI);
  mkWall(D, -W / 2, 0, Math.PI / 2);
  mkWall(D, W / 2, 0, -Math.PI / 2);

  const skirt = new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 0.6 });
  for (const [w, x, z, ry] of [[W, 0, -D / 2 + 0.02, 0], [D, -W / 2 + 0.02, 0, Math.PI / 2], [D, W / 2 - 0.02, 0, Math.PI / 2]]) {
    const s = box(w, 0.1, 0.03, skirt);
    s.position.set(x, 0.05, z); s.rotation.y = ry; group.add(s);
  }

  // ---------------- window (light source + view) ----------------
  const winW = 1.9, winH = 1.25, sill = 0.55;
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(winW, winH),
    new THREE.MeshPhysicalMaterial({
      color: 0xdff0ff, transmission: 0.92, transparent: true, opacity: 0.35,
      roughness: 0.06, metalness: 0, thickness: 0.01,
    }),
  );
  glass.position.set(0, sill + winH / 2 + 0.05, -D / 2 + 0.03);
  group.add(glass);
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(winW * 1.02, winH * 1.02),
    new THREE.MeshBasicMaterial({ color: 0xbfe0f5 }),
  );
  sky.position.set(0, sill + winH / 2 + 0.05, -D / 2 - 0.02);
  group.add(sky);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf7f5f0, roughness: 0.5 });
  for (const [w, h, x, y] of [[winW + 0.16, 0.08, 0, sill - 0.02], [winW + 0.16, 0.08, 0, sill + winH + 0.12],
    [0.08, winH + 0.2, -winW / 2 - 0.04, sill + winH / 2 + 0.05], [0.08, winH + 0.2, winW / 2 + 0.04, sill + winH / 2 + 0.05],
    [0.05, winH, 0, sill + winH / 2 + 0.05]]) {
    const f = box(w, h, 0.07, frameMat);
    f.position.set(x, y, -D / 2 + 0.05);
    group.add(f);
  }
  const sillBoard = box(winW + 0.3, 0.06, 0.30, frameMat);
  sillBoard.position.set(0, sill, -D / 2 + 0.15);
  group.add(sillBoard);

  // ---------------- rug ----------------
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.9), new THREE.MeshStandardMaterial({
    map: rugTexture(), roughness: 0.98,
  }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0.5, 0.004, 0.55);
  rug.receiveShadow = true;
  group.add(rug);

  // ---------------- sofa ----------------
  const sofaMat = new THREE.MeshPhysicalMaterial({ map: fabric('#6d7f92'), roughness: 0.92, sheen: 0.5 });
  const sofa = new THREE.Group();
  const seat = box(0.95, 0.16, 2.0, sofaMat, 0.06); seat.position.set(0, 0.34, 0);
  const baseB = box(0.9, 0.28, 1.95, sofaMat, 0.04); baseB.position.set(0, 0.16, 0);
  const back = box(0.22, 0.55, 2.0, sofaMat, 0.07); back.position.set(0.38, 0.62, 0);
  const armA = box(0.95, 0.30, 0.22, sofaMat, 0.09); armA.position.set(0, 0.55, 0.9);
  const armB = armA.clone(); armB.position.z = -0.9;
  sofa.add(seat, baseB, back, armA, armB);
  for (const z of [-0.6, 0.6]) {
    const cushion = box(0.8, 0.14, 0.7, sofaMat, 0.06);
    cushion.position.set(-0.02, 0.48, z);
    sofa.add(cushion);
  }
  sofa.position.set(2.25, 0, 0.2);
  group.add(sofa);

  // ---------------- coffee table ----------------
  const woodMat = new THREE.MeshPhysicalMaterial({ color: 0x6b4a30, roughness: 0.42, clearcoat: 0.4 });
  const table = new THREE.Group();
  const top = box(0.62, 0.05, 1.05, woodMat, 0.02); top.position.y = 0.40;
  table.add(top);
  for (const [x, z] of [[0.24, 0.45], [-0.24, 0.45], [0.24, -0.45], [-0.24, -0.45]]) {
    const leg = box(0.05, 0.40, 0.05, woodMat, 0.01);
    leg.position.set(x, 0.20, z);
    table.add(leg);
  }
  table.position.set(0.9, 0, 0.4);
  group.add(table);

  // ---------------- cat bed ----------------
  const bedMat = new THREE.MeshPhysicalMaterial({ map: fabric('#b8724f'), roughness: 0.95, sheen: 0.8 });
  const bed = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.075, 12, 32), bedMat);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.075;
  ring.castShadow = true; ring.receiveShadow = true;
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.265, 0.25, 0.06, 28), bedMat);
  pad.position.y = 0.045; pad.receiveShadow = true;
  bed.add(ring, pad);
  bed.position.set(-2.1, 0, 1.55);
  group.add(bed);

  // ---------------- bowls ----------------
  const matMat = new THREE.MeshStandardMaterial({ color: 0x38404a, roughness: 0.9 });
  const placemat = box(0.5, 0.012, 0.34, matMat, 0.02);
  placemat.position.set(-2.35, 0.006, -1.2);
  group.add(placemat);
  const ceramic = new THREE.MeshPhysicalMaterial({ color: 0xf3f1ea, roughness: 0.18, clearcoat: 0.9 });
  const mkBowl = (x, z) => {
    const g = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.065, 0.055, 26, 1, false), ceramic);
    outer.position.y = 0.028; outer.castShadow = true; outer.receiveShadow = true;
    g.add(outer);
    g.position.set(x, 0.012, z);
    group.add(g);
    return g;
  };
  const foodBowl = mkBowl(-2.35, -1.31);
  const waterBowl = mkBowl(-2.35, -1.09);
  const kibble = new THREE.Mesh(
    new THREE.CylinderGeometry(0.072, 0.06, 0.03, 22),
    new THREE.MeshStandardMaterial({ color: 0x7d5433, roughness: 1 }),
  );
  kibble.position.y = 0.042; kibble.visible = false;
  foodBowl.add(kibble);
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.062, 0.028, 24),
    new THREE.MeshPhysicalMaterial({ color: 0xa8d8e8, roughness: 0.05, transmission: 0.8, transparent: true, thickness: 0.02 }),
  );
  water.position.y = 0.040;
  waterBowl.add(water);

  // ---------------- scratching post ----------------
  const post = new THREE.Group();
  const postBase = box(0.36, 0.05, 0.36, new THREE.MeshStandardMaterial({ color: 0x8b6f4e, roughness: 0.8 }), 0.02);
  postBase.position.y = 0.025;
  const sisal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.058, 0.062, 0.60, 20, 6),
    new THREE.MeshStandardMaterial({ map: fabric('#c8b183', 128, 45), roughness: 1 }),
  );
  sisal.position.y = 0.35; sisal.castShadow = true;
  const perchTop = box(0.32, 0.05, 0.32, new THREE.MeshPhysicalMaterial({ map: fabric('#9aa7a0'), roughness: 0.95 }), 0.02);
  perchTop.position.y = 0.675;
  post.add(postBase, sisal, perchTop);
  post.position.set(-2.4, 0, 0.45);
  group.add(post);

  // ---------------- litter box ----------------
  const litter = new THREE.Group();
  const tray = box(0.48, 0.16, 0.36, new THREE.MeshStandardMaterial({ color: 0x5b6470, roughness: 0.8 }), 0.03);
  tray.position.y = 0.08;
  const sand = box(0.44, 0.06, 0.32, new THREE.MeshStandardMaterial({ color: 0xd9d2c2, roughness: 1 }), 0.01);
  sand.position.y = 0.12;
  litter.add(tray, sand);
  // clumps appear one by one as the tray gets used, so "needs scooping" is
  // something you can actually see across the room rather than a hidden number
  const clumpMat = new THREE.MeshStandardMaterial({ color: 0x8e8069, roughness: 1 });
  const clumps = [];
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.030 + (i % 3) * 0.006, 8, 6), clumpMat);
    c.scale.y = 0.55;
    c.position.set(-0.15 + (i % 3) * 0.15, 0.148, -0.07 + Math.floor(i / 3) * 0.13);
    c.castShadow = true;
    c.visible = false;
    litter.add(c);
    clumps.push(c);
  }
  litter.position.set(2.35, 0, -1.9);
  group.add(litter);

  // ---------------- wall shelf ----------------
  const shelf = box(0.30, 0.04, 1.1, woodMat, 0.01);
  shelf.position.set(-W / 2 + 0.16, 1.05, -0.6);
  group.add(shelf);
  for (const z of [-1.0, -0.2]) {
    const bracket = box(0.22, 0.16, 0.03, woodMat, 0.01);
    bracket.position.set(-W / 2 + 0.13, 0.96, z);
    group.add(bracket);
  }

  // ---------------- toy ball ----------------
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 24, 18),
    new THREE.MeshPhysicalMaterial({ color: 0xe0563f, roughness: 0.45, clearcoat: 0.6 }),
  );
  ball.castShadow = true;
  ball.position.set(0.4, 0.035, -0.6);
  ball.userData.vel = new THREE.Vector3();
  group.add(ball);

  // ---------------- lighting ----------------
  const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
  sun.position.set(-1.2, 3.0, -6.0);
  sun.target.position.set(0.6, 0, 1.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 14;
  const s = 3.6;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.012;
  sun.shadow.radius = 2.5;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);

  const bounce = new THREE.HemisphereLight(0xdfeaff, 0x8c7a63, 0.55);
  scene.add(bounce);

  const lamp = new THREE.PointLight(0xffd9a8, 6, 6, 2);
  lamp.position.set(2.0, 2.0, 1.6);
  lamp.castShadow = quality.extraShadows;
  if (lamp.castShadow) lamp.shadow.mapSize.set(1024, 1024);
  scene.add(lamp);

  const fill = new THREE.DirectionalLight(0xbdd4ff, 0.35);
  fill.position.set(3, 2, 3);
  scene.add(fill);

  // ---------------- semantic map for the AI ----------------
  const points = {
    food: { pos: new THREE.Vector3(-2.15, 0, -1.31), stand: new THREE.Vector3(-1.95, 0, -1.31), yaw: -Math.PI / 2 },
    water: { pos: new THREE.Vector3(-2.15, 0, -1.09), stand: new THREE.Vector3(-1.95, 0, -1.05), yaw: -Math.PI / 2 },
    bed: { pos: new THREE.Vector3(-2.1, 0.05, 1.55), stand: new THREE.Vector3(-2.1, 0.05, 1.55) },
    post: { pos: new THREE.Vector3(-2.4, 0, 0.45), stand: new THREE.Vector3(-2.05, 0, 0.45), yaw: -Math.PI / 2 },
    litter: { pos: new THREE.Vector3(2.35, 0.14, -1.9), stand: new THREE.Vector3(2.35, 0.14, -1.9) },
    sofa: { pos: new THREE.Vector3(2.15, 0.42, 0.2), stand: new THREE.Vector3(1.55, 0, 0.2), jump: true },
    sill: { pos: new THREE.Vector3(0, 0.58, -2.32), stand: new THREE.Vector3(0, 0, -1.95), jump: true },
    shelf: { pos: new THREE.Vector3(-2.82, 1.07, -0.6), stand: new THREE.Vector3(-2.3, 0, -0.6), jump: true },
    sunspot: { pos: new THREE.Vector3(-0.15, 0, -1.25), stand: new THREE.Vector3(-0.15, 0, -1.25) },
    table: { pos: new THREE.Vector3(0.9, 0.425, 0.4), stand: new THREE.Vector3(0.35, 0, 0.4), jump: true },
  };

  // circular obstacles used by the cat's steering
  const obstacles = [
    { x: 2.25, z: 0.2, r: 0.62 },
    { x: 0.9, z: 0.4, r: 0.42 },
    { x: -2.4, z: 0.45, r: 0.24 },
    { x: 2.35, z: -1.9, r: 0.32 },
  ];

  return {
    group, points, obstacles, ball, foodBowl, waterBowl, kibble, water, clumps, sun, lamp,
    bounds: { x: W / 2 - 0.35, z: D / 2 - 0.35 },
    litterBox: litter, bed, post, sofa, table, shelf,
  };
}
