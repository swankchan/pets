// Exercises the llama.cpp bridge against a mock OpenAI-compatible server.
//   npm run llmtest
import http from 'node:http';
import * as THREE from 'three';

// --- browser globals the bridge expects -------------------------------
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
globalThis.location = { protocol: 'http:' };
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const { LlamaBridge } = await import('../src/ai/llm.js');
const { Cortex } = await import('../src/ai/cortex.js');
const { Brain } = await import('../src/ai/brain.js');
const { Cat } = await import('../src/cat/cat.js');

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${msg}`); if (!ok) failures++; };

// --- mock llama-server -------------------------------------------------
let reply = '';
let rejectSchema = false;
let lastBody = null;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url.endsWith('/v1/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'gemma-3n-E4B-it-Q4_K_M.gguf' }] }));
    }
    lastBody = JSON.parse(raw || '{}');
    if (rejectSchema && lastBody.response_format) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end('{"error":"response_format not supported"}');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { content: reply } }],
      usage: { completion_tokens: 42 },
    }));
  });
});
await new Promise((r) => server.listen(8099, '127.0.0.1', r));

const llm = new LlamaBridge({ baseUrl: 'http://127.0.0.1:8099' });
check(await llm.connect(), `connect → model "${llm.model}"`);
check(llm.status === 'ready' && llm.enabled, 'status ready');

const state = { needs: { hunger: 0.2 }, mood: 'hungry' };

reply = '{"action":"eat","thought":"個碗空空如也，你係咪想餓死我？","vocalise":"meow","commit_seconds":15}';
let out = await llm.think(state);
check(out?.action === 'eat' && out.vocalise === 'meow' && out.commit_seconds === 15, 'clean JSON parsed');
check(out?.thought.includes('餓死'), 'Cantonese thought preserved');

reply = 'Sure! Here you go:\n```json\n{"action":"sleep","thought":"眼瞓。","vocalise":"purr"}\n```';
out = await llm.think(state);
check(out?.action === 'sleep' && out.commit_seconds === 10, 'JSON extracted from markdown fence + default commit');

reply = '{"action":"open_the_fridge","thought":"hack","vocalise":"meow"}';
check((await llm.think(state)) === null, 'invalid action rejected');

reply = 'I am a language model and cannot be a cat.';
check((await llm.think(state)) === null, 'non-JSON reply rejected (sim keeps running)');

reply = '{"action":"play","thought":"波波！","vocalise":"chirp","commit_seconds":999}';
out = await llm.think(state);
check(out?.commit_seconds === 40, 'commit_seconds clamped');

check(lastBody?.response_format?.type === 'json_schema', 'json_schema constraint sent to llama.cpp');
rejectSchema = true;
llm.schemaSupported = true;
reply = '{"action":"groom","thought":"舔下毛先。","vocalise":"none"}';
out = await llm.think(state);
check(out?.action === 'groom' && !lastBody.response_format, 'HTTP 400 → retries without json_schema (old builds)');

// --- cortex wiring ----------------------------------------------------
const cat = new Cat({ quality: { shells: 0, voxel: 0.012, furDensity: 400 } });
new THREE.Scene().add(cat.group);
const world = {
  points: Object.fromEntries(['food', 'water', 'bed', 'post', 'litter', 'sofa', 'sill', 'shelf', 'sunspot', 'table']
    .map((n, i) => [n, {
      pos: new THREE.Vector3(-2 + i * 0.4, 0, -1.3 + i * 0.2),
      stand: new THREE.Vector3(-1.8 + i * 0.4, 0, -1.3 + i * 0.2),
      jump: ['sofa', 'sill', 'shelf', 'table'].includes(n),
    }])),
  obstacles: [], bounds: { x: 2.5, z: 2 },
  ball: { position: new THREE.Vector3(1, 0, 1), userData: { vel: new THREE.Vector3() } },
  consumeFood() {},
};
const brain = new Brain(cat, world);
const thoughts = [];
const cortex = new Cortex({ llm, brain, world, audio: null, onThought: (t) => thoughts.push(t) });

const ctx = { handPoint: new THREE.Vector3(0.5, 0, 0.5), foodAvailable: true, petting: false };
const snap = cortex.snapshot(ctx);
check(typeof snap.needs.hunger === 'number' && snap.where && snap.human, 'snapshot has needs / place / human');
check(JSON.stringify(snap).length < 700, `snapshot is compact (${JSON.stringify(snap).length} chars → fast prompt)`);

reply = '{"action":"perch","thought":"我要去窗台睇雀。","vocalise":"chirp","commit_seconds":20}';
cortex.say('Mochi 過嚟啦');
cortex.update(0.016, ctx);
await new Promise((r) => setTimeout(r, 250));
check(brain.llmBias?.action === 'perch', 'cortex applied the LLM bias to the brain');
check(brain.action.id === 'perch', 'brain switched behaviour');
check(thoughts.length === 1 && brain.llmThought.includes('窗台'), 'thought delivered to the UI');
const scored = brain.scores({ foodAvailable: true });
check(scored.perch > 1.4, `biased action outscores the rest (perch=${scored.perch.toFixed(2)})`);

// reflexes must still beat the LLM
const reflex = brain.scores({ foodAvailable: true, petting: true });
check(reflex.pet > reflex.perch, 'being petted still overrides the LLM choice');

// simulation must survive the model going away mid-session
server.close();
llm.baseUrl = 'http://127.0.0.1:8099';
const dead = await llm.think(state);
check(dead === null && llm.status === 'error', 'server death handled gracefully');
let crashed = false;
try {
  for (let i = 0; i < 600; i++) { brain.update(1 / 60, ctx); cortex.update(1 / 60, ctx); cat.update(1 / 60, {}); }
} catch (e) { crashed = true; console.log(e.message); }
check(!crashed, 'simulation keeps running with the LLM offline');

console.log(failures ? `\n${failures} FAILURES` : '\nall good ✓');
process.exit(failures ? 1 : 0);
