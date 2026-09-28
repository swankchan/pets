// Bridge to a local llama.cpp server (llama-server, OpenAI-compatible API).
// The LLM is a *deliberative* layer: it proposes what the cat should do next
// and what she is thinking. It never blocks the simulation — if the model is
// slow, offline or returns rubbish, the utility AI just carries on.

/** Actions the model is allowed to pick. Anything else is ignored. */
export const LLM_ACTIONS = [
  'idle', 'wander', 'eat', 'drink', 'beg', 'sleep', 'groom', 'play',
  'affection', 'litter', 'scratch', 'perch', 'zoomies',
];

const SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: LLM_ACTIONS },
    thought: { type: 'string' },
    vocalise: { type: 'string', enum: ['none', 'meow', 'chirp', 'hiss', 'purr'] },
    commit_seconds: { type: 'integer', minimum: 2, maximum: 40 },
  },
  required: ['action', 'thought', 'vocalise'],
};

export const DEFAULT_PERSONA = `你係一隻叫 Mochi 嘅家貓。你唔識講人話，但你有豐富嘅內心世界。
你嘅 thought 要用香港廣東話口語，一句起兩句止，好似貓咁自我中心、好奇、有時傲嬌。`;

const SYSTEM = `You are the mind of a house cat in a simulation. You will receive the cat's
body state as JSON. Decide what she does next.

Rules:
- Reply with ONE JSON object only. No markdown, no explanation.
- "action" must be one of: ${LLM_ACTIONS.join(', ')}.
- Pick the action a real cat would pick given her needs (values 0..1, LOW = urgent).
  hunger/thirst/energy/hygiene/social/play/litter are SATISFACTION levels:
  0.1 hunger means starving, 0.9 means full.
- Cats are not obedient. If the human calls you and social is already high, or you are
  sleepy, you are allowed to ignore them.
- "thought" is her inner monologue, in Hong Kong Cantonese, max 2 short sentences.
  Never write human dialogue for the cat — she cannot talk.
- "vocalise": meow (demanding/greeting), chirp (hunting/excited), hiss (scared/angry),
  purr (content), none.
- "commit_seconds": how long to stick with this action before rethinking (2-40).`;

export class LlamaBridge {
  constructor(opts = {}) {
    this.baseUrl = opts.baseUrl || localStorage.getItem('pets.llm.url') || 'http://127.0.0.1:8080';
    this.persona = localStorage.getItem('pets.llm.persona') || DEFAULT_PERSONA;
    this.enabled = false;
    this.model = null;
    this.status = 'off';          // off | connecting | ready | error | thinking
    this.lastError = '';
    this.lastLatency = 0;
    this.tokensPerSecond = 0;
    this.inFlight = null;
    this.schemaSupported = true;
    this.history = [];            // rolling memory of what she recently did
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this); }

  setUrl(url) {
    this.baseUrl = url.replace(/\/+$/, '').replace(/\/v1$/, '');
    localStorage.setItem('pets.llm.url', this.baseUrl);
  }

  setPersona(text) {
    this.persona = text;
    localStorage.setItem('pets.llm.persona', text);
  }

  /** Candidate base URLs: what the user typed, then the dev-server proxy. */
  candidates() {
    const list = [this.baseUrl];
    if (location.protocol.startsWith('http') && !this.baseUrl.startsWith('/')) list.push('/llm');
    return list;
  }

  async connect() {
    this.status = 'connecting';
    this.lastError = '';
    this.emit();
    for (const base of this.candidates()) {
      try {
        const res = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.baseUrl = base;
        this.model = data?.data?.[0]?.id || 'local-model';
        this.status = 'ready';
        this.enabled = true;
        this.emit();
        return true;
      } catch (e) {
        this.lastError = e.name === 'TimeoutError' ? '連線逾時' : (e.message || String(e));
      }
    }
    this.status = 'error';
    this.enabled = false;
    this.emit();
    return false;
  }

  disconnect() {
    this.enabled = false;
    this.status = 'off';
    this.inFlight?.abort();
    this.inFlight = null;
    this.emit();
  }

  remember(line) {
    this.history.push(line);
    if (this.history.length > 6) this.history.shift();
  }

  /**
   * Ask the model for the cat's next move.
   * @param {object} state  compact snapshot of needs / world / recent events
   * @param {string|null} userMessage  something the human just said to the cat
   * @returns {Promise<null|{action:string,thought:string,vocalise:string,commit_seconds:number}>}
   */
  async think(state, userMessage = null) {
    if (!this.enabled || this.inFlight) return null;
    const ctrl = new AbortController();
    this.inFlight = ctrl;
    this.status = 'thinking';
    this.emit();
    const t0 = performance.now();

    const user = [
      `CAT STATE:\n${JSON.stringify(state)}`,
      this.history.length ? `RECENTLY:\n- ${this.history.join('\n- ')}` : '',
      userMessage ? `THE HUMAN SAYS: "${userMessage}"` : '',
      'What does she do now? JSON only.',
    ].filter(Boolean).join('\n\n');

    const body = {
      model: this.model || 'local-model',
      messages: [
        { role: 'system', content: `${SYSTEM}\n\nPERSONA:\n${this.persona}` },
        { role: 'user', content: user },
      ],
      temperature: 0.85,
      top_p: 0.92,
      max_tokens: 180,
      stream: false,
      cache_prompt: true,
    };
    if (this.schemaSupported) {
      body.response_format = { type: 'json_schema', json_schema: { name: 'cat_move', strict: true, schema: SCHEMA } };
    }

    try {
      let res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(25000)]),
      });
      if (res.status === 400 && this.schemaSupported) {
        // older llama.cpp builds: retry without the JSON schema constraint
        this.schemaSupported = false;
        delete body.response_format;
        res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(25000)]),
        });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content ?? '';
      this.lastLatency = performance.now() - t0;
      const outTok = data?.usage?.completion_tokens || 0;
      if (outTok) this.tokensPerSecond = outTok / (this.lastLatency / 1000);
      this.status = 'ready';
      this.emit();
      return this.parse(text);
    } catch (e) {
      if (e.name !== 'AbortError') {
        this.lastError = e.name === 'TimeoutError' ? '推理逾時' : (e.message || String(e));
        this.status = 'error';
        this.emit();
      }
      return null;
    } finally {
      this.inFlight = null;
    }
  }

  parse(text) {
    let obj = null;
    try { obj = JSON.parse(text); } catch { /* fall through */ }
    if (!obj) {
      const m = text.match(/\{[\s\S]*\}/);           // model wrapped it in prose / fences
      if (m) { try { obj = JSON.parse(m[0]); } catch { /* give up */ } }
    }
    if (!obj || typeof obj !== 'object') return null;
    const action = LLM_ACTIONS.includes(obj.action) ? obj.action : null;
    if (!action) return null;
    return {
      action,
      thought: String(obj.thought ?? '').slice(0, 140),
      vocalise: ['meow', 'chirp', 'hiss', 'purr'].includes(obj.vocalise) ? obj.vocalise : 'none',
      commit_seconds: Math.min(40, Math.max(2, Number(obj.commit_seconds) || 10)),
    };
  }
}
