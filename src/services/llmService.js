const axios = require('axios');

// Free-tier LLM fallback chain for news summaries. One key per provider, read from env (Fly secrets):
//   1. Google Gemini Flash   GEMINI_API_KEY
//   2. Groq                  GROQ_API_KEY
//   3. OpenRouter ":free"    OPENROUTER_API_KEY
// On 429 / 5xx / timeout / bad output the next provider is tried. Keys are never logged or returned:
// errors are reduced to provider + HTTP status + a short reason.

const TIMEOUT_MS = 45000;

const list = (env, fallback) => (process.env[env] ? process.env[env].split(',').map((s) => s.trim()).filter(Boolean) : fallback);

const PROVIDERS = [
  {
    name: 'gemini',
    env: 'GEMINI_API_KEY',
    // Tried in order; a 404 (model retired) moves on to the next model of the same provider.
    models: list('GEMINI_MODELS', ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash']),
    delayMs: 4500, // free tier ~10-15 requests/minute
    call: async (key, model, prompt) => {
      const { data } = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, responseMimeType: 'application/json' } },
        { headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS }
      );
      return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    }
  },
  {
    name: 'groq',
    env: 'GROQ_API_KEY',
    models: list('GROQ_MODELS', ['llama-3.3-70b-versatile', 'qwen/qwen3-32b', 'llama-3.1-8b-instant']),
    delayMs: 2500, // free tier ~30 requests/minute, token-per-minute bound
    call: async (key, model, prompt) => {
      const { data } = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model, temperature: 0.3, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }]
      }, { headers: { Authorization: `Bearer ${key}` }, timeout: TIMEOUT_MS });
      return data.choices?.[0]?.message?.content || '';
    }
  },
  {
    name: 'openrouter',
    env: 'OPENROUTER_API_KEY',
    models: list('OPENROUTER_MODELS', ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemma-3-27b-it:free', 'mistralai/mistral-small-3.2-24b-instruct:free', 'openrouter/free']),
    delayMs: 4000, // ":free" models ~20 requests/minute
    call: async (key, model, prompt) => {
      const { data } = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model, temperature: 0.3, messages: [{ role: 'user', content: prompt }]
      }, {
        headers: { Authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://american-football-insider.fly.dev', 'X-Title': 'American Football Insider' },
        timeout: TIMEOUT_MS
      });
      return data.choices?.[0]?.message?.content || '';
    }
  }
];

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

const configured = () => PROVIDERS.map((p) => ({ name: p.name, env: p.env, configured: Boolean(process.env[p.env]) }));
const missingKeys = () => PROVIDERS.filter((p) => !process.env[p.env]).map((p) => p.env);

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
  const complete = async (prompt, validate = (x) => x) => {
    for (const p of PROVIDERS) {
      const key = process.env[p.env];
      if (!key || state[p.name]?.down) continue;
      const s = state[p.name] || (state[p.name] = { modelIndex: 0, last: 0 });
      while (s.modelIndex < p.models.length) {
        const model = p.models[s.modelIndex];
        const wait = s.last + p.delayMs - Date.now();
        if (wait > 0) await sleep(wait);
        s.last = Date.now();
        let reply;
        try {
          reply = await p.call(key, model, prompt);
          const json = validate(parseJson(reply));
          log.attempts.push({ provider: p.name, model, ok: true });
          log.used[p.name] = (log.used[p.name] || 0) + 1;
          return { provider: p.name, model, json };
        } catch (error) {
          const e = reply !== undefined ? { status: 'bad_output', reason: `bad output: ${String(error.message).slice(0, 80)}` } : describeError(error);
          log.attempts.push({ provider: p.name, model, ok: false, error: e.reason });
          // Reply arrived but was unusable: let the next provider try this prompt, keep this one for later prompts.
          if (e.status === 'bad_output') break;
          // Model unknown / retired for this key: try the provider's next model.
          if (e.status === 404 || e.status === 400) { s.modelIndex += 1; continue; }
          // 429, 5xx, timeout, auth or unusable output: fall through to the next provider.
          s.down = e.reason;
          break;
        }
      }
      if (s.modelIndex >= p.models.length) s.down = s.down || 'no usable model';
    }
    return null;
  };

  const summary = () => ({
    providers: configured().map((p) => ({ ...p, used: log.used[p.name] || 0, stopped: state[p.name]?.down || null })),
    attempts: log.attempts.length,
    errors: log.attempts.filter((a) => !a.ok).slice(-10)
  });

  return { complete, summary };
};

module.exports = { createSession, configured, missingKeys, parseJson, PROVIDERS };
