// Eyes (slit pupils + blinking lids), ears, nose, whiskers and tongue.
// These are parented straight onto bones so they follow the skeleton.
import * as THREE from 'three';

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
  const eyeGeo = new THREE.SphereGeometry(0.0112, 26, 20);
  const lidGeo = new THREE.SphereGeometry(0.0121, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
  for (const s of [1, -1]) {
    const pivot = new THREE.Object3D();
    pivot.position.copy(local(s * 0.0212, 0.2800, 0.3720));
    pivot.rotation.y = s * 0.42;
    pivot.rotation.x = -0.06;
    head.add(pivot);

    const eye = new THREE.Mesh(eyeGeo, eyeMaterial(coat));
    eye.castShadow = false;
    pivot.add(eye);
    out.eyes.push(eye);
    out.materials.push(eye.material);

    const upper = new THREE.Mesh(lidGeo, skinMat);
    upper.rotation.x = -0.85;
    pivot.add(upper);
    const lower = new THREE.Mesh(lidGeo, skinMat);
    lower.rotation.x = Math.PI + 1.15;
    pivot.add(lower);
    out.lids.push({ upper, lower });
  }

  // ---- nose ----------------------------------------------------------
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.0082, 18, 14), noseMat);
  nose.scale.set(1.25, 0.85, 0.8);
  nose.position.copy(local(0, 0.2570, 0.4035));
  head.add(nose);

  // ---- ears ----------------------------------------------------------
  const earGeo = new THREE.ConeGeometry(0.029, 0.062, 5, 3);
  earGeo.translate(0, 0.031, 0);
  earGeo.scale(1, 1, 0.42);
  const innerGeo = new THREE.ConeGeometry(0.020, 0.046, 5, 2);
  innerGeo.translate(0, 0.022, 0);
  innerGeo.scale(1, 1, 0.25);
  for (const s of [1, -1]) {
    const bone = s > 0 ? bones.earL : bones.earR;
    const ear = new THREE.Group();
    ear.rotation.set(-0.22, 0, s * 0.30);
    const shell = new THREE.Mesh(earGeo, skinMat);
    shell.castShadow = true;
    ear.add(shell);
    const inner = new THREE.Mesh(innerGeo, innerEarMat);
    inner.position.z = 0.006;
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
      const o = local(s * 0.021, 0.2585 + i * 0.0045, 0.3885 - i * 0.0015);
      push(o, new THREE.Vector3(s * 0.85, 0.16 - i * 0.07, 0.52), 0.085 + i * 0.008, 0.6 + i * 0.2);
    }
    for (let i = 0; i < 3; i++) { // brow whiskers
      const o = local(s * 0.018, 0.2930, 0.3625);
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
  tongue.position.copy(local(0, 0.2455, 0.4055));
  tongue.visible = false;
  head.add(tongue);
  out.tongue = tongue;

  return out;
}
