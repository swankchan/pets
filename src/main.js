// Entry point: renderer, camera, input, and the simulation loop.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Cat } from './cat/cat.js';
import { World } from './world/world.js';
import { Brain } from './ai/brain.js';
import { Hud } from './ui/hud.js';
import { CatAudio } from './audio.js';

export const QUALITY = {
  low:    { shells: 4,  voxel: 0.0105, furDensity: 480,  shadowMap: 1024, texSize: 512,  extraShadows: false, pixelRatio: 1.0 },
  medium: { shells: 10, voxel: 0.0080, furDensity: 720,  shadowMap: 2048, texSize: 1024, extraShadows: false, pixelRatio: 1.25 },
  high:   { shells: 18, voxel: 0.0062, furDensity: 950,  shadowMap: 2048, texSize: 1024, extraShadows: true,  pixelRatio: 1.5 },
  ultra:  { shells: 28, voxel: 0.0050, furDensity: 1150, shadowMap: 4096, texSize: 2048, extraShadows: true,  pixelRatio: 2.0 },
};

function detectQuality(renderer) {
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const name = (dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '').toLowerCase();
  const software = /swiftshader|llvmpipe|software|mesa offscreen|angle \(google/.test(name);
  if (software) return 'low';
  if (/rtx|radeon rx|apple m\d|geforce (gtx 16|20|30|40|50)/.test(name)) return 'high';
  return 'medium';
}

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0f12);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 60);
camera.position.set(1.45, 0.95, 1.85);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 0.35;
controls.maxDistance = 6.5;
controls.maxPolarAngle = Math.PI * 0.495;
controls.target.set(0, 0.22, 0);

let qualityKey = localStorage.getItem('pets.quality') || detectQuality(renderer);
document.getElementById('quality').value = qualityKey;
let quality = QUALITY[qualityKey];
renderer.setPixelRatio(Math.min(devicePixelRatio, quality.pixelRatio));

const world = new World(scene, quality);
const audio = new CatAudio();
const hud = new Hud();

let cat = null;
let brain = null;

function spawnCat(coatKey) {
  const prevPos = cat ? cat.group.position.clone() : new THREE.Vector3(0.3, 0, 0.3);
  const prevHeading = cat ? cat.heading : 2.2;
  if (cat) { scene.remove(cat.group); cat.dispose(); }
  cat = new Cat({ coat: coatKey, quality });
  cat.group.position.copy(prevPos);
  cat.obstacles = world.obstacles;
  cat.heading = prevHeading;
  scene.add(cat.group);
  if (brain) { brain.cat = cat; } else {
    brain = new Brain(cat, world);
    brain.events.addEventListener('vocalise', (e) => audio.vocalise(e.kind));
  }
  window.cat = cat; window.brain = brain; window.world = world;
}

// ------------------------------------------------------------------ input
const pointer = new THREE.Vector2(-10, -10);
const ray = new THREE.Raycaster();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const state = {
  handPoint: new THREE.Vector3(0, 0, 0.8),
  hoveringCat: false, petting: false, pointerDown: false,
  laserOn: false, calling: 0, follow: true,
};

function updateHand() {
  ray.setFromCamera(pointer, camera);
  const hit = new THREE.Vector3();
  if (ray.ray.intersectPlane(floorPlane, hit)) {
    hit.x = THREE.MathUtils.clamp(hit.x, -world.bounds.x, world.bounds.x);
    hit.z = THREE.MathUtils.clamp(hit.z, -world.bounds.z, world.bounds.z);
    state.handPoint.copy(hit);
  }
  if (cat) {
    const hits = ray.intersectObject(cat.hitMesh, false);
    state.hoveringCat = hits.length > 0;
    if (hits.length) state.catHitPoint = hits[0].point.clone();
  }
  renderer.domElement.style.cursor = state.laserOn ? 'crosshair' : state.hoveringCat ? 'grab' : 'default';
}

renderer.domElement.addEventListener('pointermove', (e) => {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  updateHand();
  if (state.pointerDown && state.hoveringCat) state.petting = true;
});
renderer.domElement.addEventListener('pointerdown', (e) => {
  audio.ensure();
  state.pointerDown = true;
  updateHand();
  if (state.hoveringCat && !state.laserOn) {
    state.petting = true;
    controls.enabled = false;
    renderer.domElement.style.cursor = 'grabbing';
  }
});
addEventListener('pointerup', () => {
  state.pointerDown = false;
  state.petting = false;
  controls.enabled = true;
});
renderer.domElement.addEventListener('wheel', () => audio.ensure(), { passive: true });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const btn = (id, fn) => document.getElementById(id).addEventListener('click', fn);
btn('btn-feed', () => { audio.ensure(); world.refillFood(); flash('btn-feed'); });
btn('btn-toy', () => {
  audio.ensure();
  world.throwBall(state.handPoint, camera.position.clone().lerp(state.handPoint, 0.25).setY(0.9));
  flash('btn-toy');
});
btn('btn-laser', () => toggleLaser());
btn('btn-call', () => call());

function flash(id) {
  const b = document.getElementById(id);
  b.classList.add('on');
  setTimeout(() => b.classList.remove('on'), 350);
}
function toggleLaser() {
  state.laserOn = !state.laserOn;
  document.getElementById('btn-laser').classList.toggle('on', state.laserOn);
  if (!state.laserOn) world.setLaser(null);
  audio.ensure();
}
function call() {
  audio.ensure();
  state.calling = 4;
  flash('btn-call');
}

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'f') { world.refillFood(); flash('btn-feed'); }
  if (k === 'l') toggleLaser();
  if (k === 't') document.getElementById('btn-toy').click();
  if (k === ' ') { e.preventDefault(); call(); }
  if (k === 'g') brain && brain.spook(1);
});

document.getElementById('quality').addEventListener('change', (e) => {
  qualityKey = e.target.value;
  localStorage.setItem('pets.quality', qualityKey);
  quality = QUALITY[qualityKey];
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality.pixelRatio));
  world.sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
  if (world.sun.shadow.map) { world.sun.shadow.map.dispose(); world.sun.shadow.map = null; }
  showLoading('rebuilding fur…', () => spawnCat(document.getElementById('coat').value));
});
document.getElementById('coat').addEventListener('change', (e) => {
  showLoading('changing coat…', () => spawnCat(e.target.value));
});
document.getElementById('timescale').addEventListener('input', (e) => {
  if (brain) brain.timeScale = parseFloat(e.target.value);
});
document.getElementById('follow').addEventListener('change', (e) => { state.follow = e.target.checked; });
document.getElementById('sound').addEventListener('change', (e) => { audio.enabled = e.target.checked; });

function showLoading(msg, fn) {
  const el = document.getElementById('loading');
  document.getElementById('loadmsg').textContent = msg;
  el.style.display = 'grid';
  el.style.opacity = '1';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fn();
    el.style.opacity = '0';
    setTimeout(() => { el.style.display = 'none'; }, 600);
  }));
}

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
const camTarget = new THREE.Vector3(0, 0.22, 0);

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (cat && brain) {
    state.calling = Math.max(0, state.calling - dt);
    if (state.laserOn) {
      const p = state.handPoint.clone();
      p.y = 0.002;
      world.setLaser(p);
    }
    world.update(dt);

    const petting = state.petting && state.hoveringCat;
    brain.update(dt, {
      handPoint: state.handPoint,
      petting,
      calling: state.calling > 0,
      laser: state.laserOn ? world.laser : null,
      foodAvailable: world.foodLevel > 0.02,
      ballMoving: world.ballMoving,
      attention: world.ballMoving ? world.ball.position : null,
    });
    cat.update(dt, { stalking: brain.stalking, licking: brain.licking });
    audio.setPurr(cat.purr);
    hud.update(dt, brain, renderer);

    if (state.follow) {
      camTarget.lerp(cat.group.position.clone().setY(cat.group.position.y + 0.20), Math.min(1, dt * 1.6));
      controls.target.copy(camTarget);
    }
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

showLoading('sculpting the cat…', () => spawnCat('tabby'));
animate();
