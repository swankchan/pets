// Eyes (slit pupils + blinking lids), ears, nose, whiskers and tongue.
// These are parented straight onto bones so they follow the skeleton.
import * as THREE from 'three';
import { makeBodyField, raycastField, fieldNormal } from './body.js';
import { FACE, EYE } from './facePaint.js';

function eyeMaterial(coat) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.08, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.03,
  });
  m.userData.uniforms = {
    uPupil: { value: 0.35 },
    uIris: { value: coat.eye.clone() },
  };
  m.customProgramCacheKey = () => 'cateye';
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, m.userData.uniforms);
    shader.vertexShader = 'varying vec3 vEyeLocal;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\n vEyeLocal = normalize(position);',
    );
    shader.fragmentShader = `
      varying vec3 vEyeLocal;
      uniform float uPupil;
      uniform vec3 uIris;
      float eyeHash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
    ` + shader.fragmentShader.replace('#include <color_fragment>', /* glsl */`
      #include <color_fragment>
      vec3 u = normalize(vEyeLocal);
      float rad = length(u.xy);
      float front = smoothstep(-0.05, 0.12, u.z);
      // iris with radial fibres
      float fibre = 0.82 + 0.35 * eyeHash(vec2(floor(atan(u.y, u.x) * 26.0), floor(rad * 5.0)));
      vec3 iris = uIris * fibre;
      iris = mix(iris * 1.35, iris * 0.55, smoothstep(0.15, 0.78, rad));
      vec3 sclera = vec3(0.86, 0.84, 0.80);
      vec3 col = mix(sclera, iris, front * smoothstep(0.80, 0.68, rad));
      // vertical slit pupil, uPupil = 0 slit .. 1 fully dilated
      float pw = 0.055 + 0.50 * uPupil;
      float ph = 0.66 - 0.12 * uPupil;
      float d = length(vec2(u.x / pw, u.y / ph));
      col = mix(col, vec3(0.012), front * (1.0 - smoothstep(0.92, 1.08, d)));
      diffuseColor.rgb *= col;
    `);
  };
  return m;
}

/**
 * Where a frontally-placed feature actually meets the skull.
 * Marching from well in front of the face backwards finds the *front* surface
 * (marching forwards from inside would stop on the back of the head), so the
 * eyes and nose end up sitting on the face instead of buried inside it.
 */
function surfaceAt(field, x, y) {
  const from = new THREE.Vector3(x, y, 0.52);
  const t = raycastField(field, from, DIR_BACK, 0.34, 0.001);
  if (t == null) return null;
  const pos = new THREE.Vector3(x, y, 0.52 - t);
  return { pos, normal: fieldNormal(field, pos.x, pos.y, pos.z) };
}
const DIR_BACK = new THREE.Vector3(0, 0, -1);

export function buildFeatures(bones, rest, coat) {
  const out = { eyes: [], lids: [], ears: [], materials: [] };
  const skinMat = new THREE.MeshPhysicalMaterial({
    color: coat.top.clone().multiplyScalar(0.85), roughness: 0.85, sheen: 0.6,
    sheenColor: new THREE.Color(0xffd9b0),
  });
  const innerEarMat = new THREE.MeshPhysicalMaterial({ color: 0xc98d8a, roughness: 0.6 });
  const noseMat = new THREE.MeshPhysicalMaterial({
    color: coat.nose.clone(), roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.25,
  });

  const head = bones.head;
  const headRest = rest.head;
  const local = (x, y, z) => new THREE.Vector3(x, y, z).sub(headRest);

  // ---- eyes ----------------------------------------------------------
  // Radius, aperture and spacing come from the reference photo: the visible
  // almond is ~26 mm wide on a 90 mm head, and the cornea bulges out of it.
  const field = makeBodyField(rest);
  const EYE_R = EYE.ballR;
  const eyeGeo = new THREE.SphereGeometry(EYE_R, 28, 22);
  const lidGeo = new THREE.SphereGeometry(EYE_R * 1.10, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.60);
  const eyeHit = surfaceAt(field, FACE.eye.x, FACE.eye.y);
  const eyeSurf = eyeHit ? eyeHit.pos : new THREE.Vector3(FACE.eye.x, FACE.eye.y, 0.393);
  // Face outwards, but damped towards straight ahead — cats are binocular.
  const eyeDir = (eyeHit ? eyeHit.normal.clone() : new THREE.Vector3(0.6, 0.3, 0.7))
    .lerp(new THREE.Vector3(0, 0, 1), 0.5).normalize();

  // Registration matters more than anatomy here: the ball is pushed straight
  // back in z so that, seen from the front, it lands exactly inside the
  // painted eyelid aperture. Only ~3.5 mm of cornea is left proud.
  const BULGE = EYE.bulge;
  for (const s of [1, -1]) {
    const pivot = new THREE.Object3D();
    pivot.position.copy(local(s * FACE.eye.x, FACE.eye.y, eyeSurf.z - (EYE_R - BULGE)));
    pivot.userData.surfaceZ = eyeSurf.z;
    pivot.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(s * eyeDir.x, eyeDir.y, eyeDir.z));
    head.add(pivot);

    const eye = new THREE.Mesh(eyeGeo, eyeMaterial(coat));
    eye.castShadow = false;
    eye.renderOrder = 2;
    pivot.add(eye);
    out.eyes.push(eye);
    out.materials.push(eye.material);

    // Lids are caps that ride just above the ball; the closed/open angles are
    // what gives the eye its almond aperture rather than a round porthole.
    const upper = new THREE.Mesh(lidGeo, skinMat);
    upper.rotation.x = -1.02;
    upper.renderOrder = 3;
    pivot.add(upper);
    const lower = new THREE.Mesh(lidGeo, skinMat);
    lower.rotation.x = Math.PI + 1.00;
    lower.renderOrder = 3;
    pivot.add(lower);
    out.lids.push({ upper, lower });
  }

  // ---- nose ----------------------------------------------------------
  const noseHit = surfaceAt(field, 0, FACE.nose.y);
  const noseSurf = noseHit ? noseHit.pos : new THREE.Vector3(0, FACE.nose.y, 0.408);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.0074, 20, 16), noseMat);
  nose.scale.set(1.05, 0.62, 0.38);
  nose.position.copy(local(0, noseSurf.y + 0.0006, noseSurf.z - 0.0074 * 0.38 * 0.70));
  nose.renderOrder = 2;
  head.add(nose);

  // ---- ears ----------------------------------------------------------
  // Rounder base, flatter shell, and the inner pinna tucked well inside the
  // outer one so it cannot poke through the rim.
  const earGeo = new THREE.ConeGeometry(0.030, 0.064, 12, 4);
  earGeo.translate(0, 0.032, 0);
  earGeo.scale(1, 1, 0.34);
  const innerGeo = new THREE.ConeGeometry(0.0205, 0.044, 12, 3);
  innerGeo.translate(0, 0.020, 0);
  innerGeo.scale(1, 1, 0.16);
  for (const s of [1, -1]) {
    const bone = s > 0 ? bones.earL : bones.earR;
    const ear = new THREE.Group();
    ear.rotation.set(-0.22, 0, s * 0.30);
    const shell = new THREE.Mesh(earGeo, skinMat);
    shell.castShadow = true;
    ear.add(shell);
    const inner = new THREE.Mesh(innerGeo, innerEarMat);
    inner.position.set(0, 0.004, 0.0045);
    ear.add(inner);
    bone.add(ear);
    out.ears.push(ear);
  }

  // ---- whiskers ------------------------------------------------------
  const pts = [];
  const push = (origin, dir, len, droop) => {
    let p = origin.clone();
    const d = dir.clone().normalize();
    const seg = 5;
    for (let i = 0; i < seg; i++) {
      const a = p.clone();
      d.y -= droop * 0.22;
      p = p.clone().addScaledVector(d, len / seg);
      pts.push(a, p);
    }
  };
  for (const s of [1, -1]) {
    for (let i = 0; i < 5; i++) {
      // roots planted on the whisker pad itself, not floating in front of it
      const wy = 0.2440 + i * 0.0048;
      const hit = surfaceAt(field, 0.0150, wy);
      const wz = (hit ? hit.pos.z : 0.398) - 0.0015;
      const o = local(s * 0.0150, wy, wz);
      push(o, new THREE.Vector3(s * 0.92, 0.18 - i * 0.08, 0.36), 0.085 + i * 0.008, 0.6 + i * 0.2);
    }
    for (let i = 0; i < 3; i++) { // brow whiskers
      const bh = surfaceAt(field, 0.0180, 0.2980);
      const o = local(s * 0.0180, 0.2980, (bh ? bh.pos.z : 0.382) - 0.002);
      push(o, new THREE.Vector3(s * (0.4 + i * 0.18), 0.75 - i * 0.12, 0.42), 0.05, 0.3);
    }
  }
  const whiskerGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const whiskers = new THREE.LineSegments(whiskerGeo, new THREE.LineBasicMaterial({
    color: 0xfaf4e6, transparent: true, opacity: 0.55, depthWrite: false,
  }));
  head.add(whiskers);
  out.whiskers = whiskers;

  // ---- tongue (only shown while grooming / drinking) -------------------
  const tongue = new THREE.Mesh(
    new THREE.SphereGeometry(0.010, 12, 8),
    new THREE.MeshPhysicalMaterial({ color: 0xe08a94, roughness: 0.35, clearcoat: 0.8 }),
  );
  tongue.scale.set(0.7, 0.28, 1.5);
  const tongueHit = surfaceAt(field, 0, 0.2420);
  tongue.position.copy(local(0, 0.2420, (tongueHit ? tongueHit.pos.z : 0.403) + 0.002));
  tongue.visible = false;
  head.add(tongue);
  out.tongue = tongue;

  return out;
}
