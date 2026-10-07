const axios = require('axios');

// Free-tier LLM fallback chain for news summaries. One key per provider, read from env (Fly secrets):
//   1. Groq                  GROQ_API_KEY
//   2. OpenRouter ":free"    OPENROUTER_API_KEY
// On 429 / 5xx / timeout / bad output the next provider is tried. Keys are never logged or returned:
// errors are reduced to provider + HTTP status + a short reason.

const TIMEOUT_MS = 45000;

const list = (env, fallback) => (process.env[env] ? process.env[env].split(',').map((s) => s.trim()).filter(Boolean) : fallback);

// Free-tier model IDs change often, so each provider's current model list is fetched (once per 6h) and
// ranked by the preference patterns below. <PROVIDER>_MODELS env vars override discovery.
const rank = (ids, prefs, exclude) => {
  const ok = ids.filter((id) => !exclude.test(id));
  const score = (id) => { const i = prefs.findIndex((re) => re.test(id)); return i === -1 ? prefs.length : i; };
  // Higher version numbers first within the same preference bucket.
  return ok.sort((a, b) => score(a) - score(b) || b.localeCompare(a, undefined, { numeric: true }));
};

const PROVIDERS = [
  {
    name: 'groq',
    env: 'GROQ_API_KEY',
    models: list('GROQ_MODELS', null),
    fallbackModels: ['llama-3.3-70b-versatile'],
    discover: async (key) => {
      const { data } = await axios.get('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` }, timeout: 15000 });
      return rank((data.data || []).map((m) => m.id), [/llama-[\d.]+-70b/, /qwen/, /gpt-oss-120b/, /llama/, /gpt-oss/], /guard|whisper|orpheus|tts|allam|safeguard|vision|compound/);
    },
    delayMs: 15000, // free tier: tokens-per-minute is the binding limit
    call: async (key, model, prompt) => {
      const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model, temperature: 0.3, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }]
      }, { headers: { Authorization: `Bearer ${key}` }, timeout: TIMEOUT_MS });
      return { text: response.data.choices?.[0]?.message?.content || '', usage: response.data.usage, headers: response.headers };
    }
  },
  {
    name: 'openrouter',
    env: 'OPENROUTER_API_KEY',
    models: list('OPENROUTER_MODELS', null),
    fallbackModels: ['meta-llama/llama-3.3-70b-instruct:free'],
    discover: async () => {
      const { data } = await axios.get('https://openrouter.ai/api/v1/models', { timeout: 15000 });
      const free = (data.data || []).map((m) => m.id).filter((id) => id.endsWith(':free'));
      return rank(free, [/llama-[\d.]+-70b/, /gemma-\d+-3\d?b/, /gemma/, /qwen/, /nemotron-[\d.]+-super/, /mistral/], /safety|guard|code|coder|omni|vision|-vl|nano|mini|lightning|2\.6b|preview/).slice(0, 4);
    },
    delayMs: 4000, // ":free" models ~20 requests/minute
    call: async (key, model, prompt) => {
      const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model, temperature: 0.3, messages: [{ role: 'user', content: prompt }]
      }, {
        headers: { Authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://american-football-insider.fly.dev', 'X-Title': 'American Football Insider' },
        timeout: TIMEOUT_MS
      });
      return { text: response.data.choices?.[0]?.message?.content || '', usage: response.data.usage, headers: response.headers };
    }
  }
];

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

const discovered = {};
const modelsFor = async (p, key) => {
  if (p.models) return p.models;
  const hit = discovered[p.name];
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.models;
  try {
    const models = await p.discover(key);
    if (models.length) { discovered[p.name] = { at: Date.now(), models }; return models; }
  } catch (error) {
    console.warn(`[llm] ${p.name} model discovery failed (${error.response ? `HTTP ${error.response.status}` : error.code || 'error'})`);
  }
  return p.fallbackModels;
};

// Hard deadline for a provider call (axios' timeout is per socket inactivity, not total time).
const withDeadline = (promise, ms) => Promise.race([promise, new Promise((_, reject) => { setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })), ms).unref(); })]);

const configured = () => PROVIDERS.map((p) => ({ name: p.name, env: p.env, configured: Boolean(process.env[p.env]) }));
const missingKeys = () => PROVIDERS.filter((p) => !process.env[p.env]).map((p) => p.env);

// OpenRouter exposes credit usage/limit for the authenticated key. Return only accounting fields;
// credentials and the rest of the key metadata never leave this module.
const fetchProviderLimits = async () => {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return {};
  try {
    const { data } = await axios.get('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` }, timeout: 15000 });
    return { openrouter: {
      remaining_requests: data?.data?.limit_remaining == null ? null : String(data.data.limit_remaining),
      remaining_tokens: data?.data?.usage == null ? null : String(data.data.usage),
      reset_requests: data?.data?.limit == null ? null : String(data.data.limit)
    } };
  } catch (error) {
    console.warn(`[llm] openrouter limit lookup failed (${describeError(error).reason})`);
    return {};
  }
};

// Pulls the first JSON object out of a model reply (handles ```json fences and <think> blocks).
const parseJson = (text) => {
  const cleaned = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON in reply');
  return JSON.parse(cleaned.slice(start, end + 1));
};

const describeError = (error) => {
  if (error.response) return { status: error.response.status, reason: `HTTP ${error.response.status}` };
  if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message)) return { status: 'timeout', reason: 'timeout' };
  return { status: 'error', reason: String(error.message || 'error').slice(0, 120) };
};

// Provider state for one run: once a provider is rate limited or down it is skipped for the rest of the run.
const createSession = () => {
  const state = {};
  const log = { attempts: [], used: {} };

  // Returns { provider, model, json } or null when every provider failed. `validate` throws on bad output.
  const complete = async (prompt, validate = (x) => x, retried = false) => {
    for (const p of PROVIDERS) {
      const key = process.env[p.env];
      if (!key || state[p.name]?.down || state[p.name]?.coolUntil > Date.now()) continue;
      const s = state[p.name] || (state[p.name] = { modelIndex: 0, last: 0, models: await modelsFor(p, key) });
      while (s.modelIndex < s.models.length) {
        const model = s.models[s.modelIndex];
        const wait = s.last + p.delayMs - Date.now();
        if (wait > 0) await sleep(wait);
        s.last = Date.now();
        let reply;
        try {
          reply = await withDeadline(p.call(key, model, prompt), TIMEOUT_MS + 5000);
          const json = validate(parseJson(reply.text));
          const headers = reply.headers || {};
          log.attempts.push({ provider: p.name, model, ok: true, usage: reply.usage || {}, limits: {
            remaining_requests: headers['x-ratelimit-remaining-requests'] || headers['x-ratelimit-remaining-requests-day'] || null,
            remaining_tokens: headers['x-ratelimit-remaining-tokens'] || null,
            reset_requests: headers['x-ratelimit-reset-requests'] || null,
            reset_tokens: headers['x-ratelimit-reset-tokens'] || null
          } });
          log.used[p.name] = (log.used[p.name] || 0) + 1;
          return { provider: p.name, model, json };
        } catch (error) {
          const e = reply !== undefined ? { status: 'bad_output', reason: `bad output: ${String(error.message).slice(0, 80)}` } : describeError(error);
          log.attempts.push({ provider: p.name, model, ok: false, status: e.status, error: e.reason, at: new Date().toISOString() });
          // Reply arrived but was unusable: let the next provider try this prompt, keep this one for later prompts.
          if (e.status === 'bad_output') break;
          // Model unknown / retired / overloaded: try the provider's next model.
          if ([400, 404, 503].includes(e.status)) { s.modelIndex += 1; continue; }
          // 429: rate limited — cool down 65s and fall through to the next provider for this prompt.
          if (e.status === 429) { s.coolUntil = Date.now() + 65000; break; }
          // 5xx, timeout, auth: provider is out for this run.
          s.down = e.reason;
          break;
        }
      }
      if (s.modelIndex >= s.models.length) s.down = s.down || 'no usable model';
    }
    // Everyone is rate limited: wait once for the first cooldown to end, then try again.
    const cooling = Object.values(state).filter((x) => !x.down && x.coolUntil > Date.now()).map((x) => x.coolUntil);
    if (!retried && cooling.length) {
      await sleep(Math.min(...cooling) - Date.now() + 500);
      return complete(prompt, validate, true);
    }
    return null;
  };

  const summary = () => ({
    providers: configured().map((p) => ({ ...p, used: log.used[p.name] || 0, models_tried: state[p.name] ? state[p.name].models.slice(0, state[p.name].modelIndex + 1) : [], stopped: state[p.name]?.down || (state[p.name]?.coolUntil > Date.now() ? 'rate limited (429)' : null) })),
    attempts: log.attempts.length,
    errors: log.attempts.filter((a) => !a.ok).slice(-10),
    attempts_detail: log.attempts
  });

  return { complete, summary };
};

module.exports = { createSession, configured, missingKeys, parseJson, modelsFor, fetchProviderLimits, PROVIDERS };
