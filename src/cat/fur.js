// Shell-based fur: N concentric offset copies of the skinned mesh, each one
// alpha-cutting individual strands out of a procedural hash field, plus a
// procedural mackerel-tabby coat driven by rest-pose object coordinates.
import * as THREE from 'three';

export const COATS = {
  tabby: {
    name: 'Brown tabby',
    under: new THREE.Color('#4a3524'), top: new THREE.Color('#9d7a4e'),
    stripe: new THREE.Color('#3a2a1c'), belly: new THREE.Color('#d9c39b'),
    socks: new THREE.Color('#e6dcc6'), stripes: 1.0, nose: new THREE.Color('#c98f86'),
    eye: new THREE.Color('#9fbb3a'),
  },
  grey: {
    name: 'Russian blue',
    under: new THREE.Color('#3d4750'), top: new THREE.Color('#8e9aa4'),
    stripe: new THREE.Color('#414c56'), belly: new THREE.Color('#b9c3cb'),
    socks: new THREE.Color('#c8d1d7'), stripes: 0.25, nose: new THREE.Color('#8d7f80'),
    eye: new THREE.Color('#7bd06a'),
  },
  ginger: {
    name: 'Ginger',
    under: new THREE.Color('#8a4418'), top: new THREE.Color('#e08a3c'),
    stripe: new THREE.Color('#a4501c'), belly: new THREE.Color('#f5ddb6'),
    socks: new THREE.Color('#fbf0da'), stripes: 0.9, nose: new THREE.Color('#e0a08f'),
    eye: new THREE.Color('#d8a32c'),
  },
  tuxedo: {
    name: 'Tuxedo',
    under: new THREE.Color('#151416'), top: new THREE.Color('#33312f'),
    stripe: new THREE.Color('#0d0d0f'), belly: new THREE.Color('#f2efe8'),
    socks: new THREE.Color('#fbfaf6'), stripes: 0.0, nose: new THREE.Color('#5d5155'),
    eye: new THREE.Color('#e0b23c'),
  },
};

const COMMON_GLSL = /* glsl */`
  varying vec3 vRestPos;
  varying vec3 vRestNormal;
  uniform float uShellT;      // 0 = skin, 1 = fur tip
  uniform float uFurLength;
  uniform float uDensity;
  uniform vec3 uUnder, uTop, uStripe, uBelly, uSocks;
  uniform float uStripes, uFluff, uTime, uWetness;

  float hash13(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n = mix(
      mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
          mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
          mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
    return n;
  }
  float fbm(vec3 p) {
    return 0.55 * noise3(p) + 0.28 * noise3(p * 2.1) + 0.17 * noise3(p * 4.3);
  }
`;

const VERT_HEAD = /* glsl */`
  varying vec3 vRestPos;
  varying vec3 vRestNormal;
  uniform float uShellT;
  uniform float uFurLength;
  uniform float uFluff;
  uniform float uTime;
`;

// `objectNormal` has already been skinned by <skinnormal_vertex> when we reach
// <begin_vertex>, so we stash the rest-pose normal first and displace with that:
// the shell offset then gets skinned along with the vertex.
const VERT_NORMAL = /* glsl */`
  #include <beginnormal_vertex>
  vec3 restNormal = objectNormal;
`;

// Injected in place of <begin_vertex>: push the shell out along the normal,
// with a backward/downward comb so the coat lies along the body.
const VERT_BODY = /* glsl */`
  vRestPos = position;
  vRestNormal = restNormal;
  vec3 transformed = vec3(position);
  #ifdef USE_FUR_SHELL
    float lenScale = uFurLength * (1.0 + 1.1 * uFluff);
    vec3 comb = normalize(vec3(0.0, -0.55, -1.0));
    comb = normalize(comb - restNormal * dot(comb, restNormal) * 0.85);
    float sway = sin(uTime * 1.7 + position.z * 9.0) * 0.12;
    transformed += restNormal * (uShellT * lenScale)
                 + comb * (uShellT * uShellT * lenScale * (0.75 + sway));
  #endif
`;

const FRAG_COLOR = /* glsl */`
  vec3 p = vRestPos;

  // --- strand cut-out -------------------------------------------------
  float alpha = 1.0;
  #ifdef USE_FUR_SHELL
    vec3 cell = floor(p * uDensity);
    float r = hash13(cell);
    float r2 = hash13(cell + 17.3);
    float strand = 0.35 + 0.65 * r;
    alpha = step(uShellT, strand);
    // thin the strand towards its tip
    alpha *= step(0.15 + 0.55 * uShellT * uShellT, r2 + 0.35);
  #endif

  // --- coat pattern ---------------------------------------------------
  float warp = fbm(p * 12.0) * 0.5;
  float spine = p.z;
  float band = sin(spine * 46.0 + warp * 7.0 + p.y * 4.0);
  float stripeMask = smoothstep(0.25, 0.75, band) * uStripes;
  // tail rings + leg bars
  stripeMask = max(stripeMask, smoothstep(0.35, 0.8, sin(spine * 62.0)) * uStripes * step(p.z, -0.12));
  float dorsal = smoothstep(0.10, 0.30, vRestNormal.y);   // back is darker
  float ventral = smoothstep(0.02, -0.45, vRestNormal.y) * smoothstep(0.24, 0.13, p.y);
  float socks = smoothstep(0.085, 0.03, p.y);
  float chin = smoothstep(0.33, 0.42, p.z) * smoothstep(0.02, -0.5, vRestNormal.y);

  vec3 coat = mix(uUnder, uTop, 0.35 + 0.65 * uShellT);
  coat = mix(coat, uStripe, stripeMask * (0.35 + 0.5 * dorsal));
  coat = mix(coat, uBelly, max(ventral, chin) * 0.92);
  coat = mix(coat, uSocks, socks * 0.9);
  coat *= 0.86 + 0.28 * fbm(p * 70.0);           // per-hair tonal variation
  coat *= mix(0.42, 1.06, uShellT);              // ambient occlusion towards the skin
  coat *= mix(1.0, 0.72, uWetness);

  diffuseColor.rgb *= coat;
  diffuseColor.a *= alpha;
`;

/**
 * @param {object} coat entry from COATS
 * @param {{shells:number, furLength:number, density:number}} cfg
 */
export function createCoatMaterials(coat, cfg) {
  const shared = {
    uFurLength: { value: cfg.furLength },
    uDensity: { value: cfg.density },
    uUnder: { value: coat.under.clone() },
    uTop: { value: coat.top.clone() },
    uStripe: { value: coat.stripe.clone() },
    uBelly: { value: coat.belly.clone() },
    uSocks: { value: coat.socks.clone() },
    uStripes: { value: coat.stripes },
    uFluff: { value: 0.0 },
    uTime: { value: 0 },
    uWetness: { value: 0 },
  };

  const mats = [];
  for (let i = 0; i <= cfg.shells; i++) {
    const t = cfg.shells === 0 ? 0 : i / cfg.shells;
    const isShell = i > 0;
    const m = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: isShell ? 0.92 : 0.78,
      metalness: 0.0,
      sheen: 1.0,
      sheenRoughness: 0.55,
      sheenColor: new THREE.Color(0xffe6c4),
      alphaTest: isShell ? 0.5 : 0.0,
      side: THREE.FrontSide,
      transparent: false,
    });
    m.userData.uniforms = { ...shared, uShellT: { value: t } };
    m.customProgramCacheKey = () => (isShell ? 'catcoat-shell' : 'catcoat-skin');
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, m.userData.uniforms);
      const def = isShell ? '#define USE_FUR_SHELL\n' : '';
      shader.vertexShader = def + VERT_HEAD + shader.vertexShader
        .replace('#include <beginnormal_vertex>', VERT_NORMAL)
        .replace('#include <begin_vertex>', VERT_BODY);
      shader.fragmentShader = def + COMMON_GLSL + shader.fragmentShader.replace(
        '#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR,
      );
    };
    mats.push(m);
  }
  mats.shared = shared;
  return mats;
}
