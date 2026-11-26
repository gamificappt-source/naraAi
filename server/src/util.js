// Funções utilitárias compartilhadas (sem dependências externas)
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.NARA_DATA || path.join(ROOT, 'data');
const WEB_DIR = path.resolve(ROOT, '..', 'web');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}
ensureDir(DATA_DIR);

const LOG_FILE = path.join(DATA_DIR, 'nara.log');
const recentLogs = [];

function log(level, ...args) {
  const msg = args
    .map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'object' ? JSON.stringify(a) : String(a)))
    .join(' ');
  const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
  console.log(line);
  recentLogs.push(line);
  if (recentLogs.length > 500) recentLogs.shift();
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
    const st = fs.statSync(LOG_FILE);
    if (st.size > 5 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.old');
  } catch (_) {}
}
const logger = {
  info: (...a) => log('INFO', ...a),
  warn: (...a) => log('WARN', ...a),
  error: (...a) => log('ERRO', ...a),
  recent: () => recentLogs.slice(-200),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}
function writeJSON(file, data) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/** Executa um comando e devolve stdout. Rejeita se o código de saída != 0. */
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { ...opts });
    let out = '';
    let err = '';
    p.stdout && p.stdout.on('data', (d) => (out += d));
    p.stderr && p.stderr.on('data', (d) => {
      err += d;
      if (err.length > 20000) err = err.slice(-20000);
    });
    if (opts.input != null) {
      p.stdin.write(opts.input);
      p.stdin.end();
    }
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} saiu com código ${code}: ${err.slice(-1500)}`));
    });
  });
}

async function commandExists(cmd) {
  try {
    await run('sh', ['-c', `command -v ${cmd}`]);
    return true;
  } catch (_) {
    return false;
  }
}

/** fetch com timeout e tentativas */
async function fetchRetry(url, opts = {}, { tries = 3, timeoutMs = 120000, retryOn = [429, 500, 502, 503, 504] } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(t);
      if (retryOn.includes(res.status) && i < tries - 1) {
        lastErr = new Error(`HTTP ${res.status} em ${url.split('?')[0]}`);
        await sleep(2000 * (i + 1) * (res.status === 429 ? 5 : 1));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (i < tries - 1) await sleep(2000 * (i + 1));
    }
  }
  throw lastErr;
}

/** Extrai o primeiro objeto JSON de um texto (modelos às vezes envolvem em ```json) */
function extractJSON(text) {
  if (!text) throw new Error('Resposta vazia da IA');
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch (_) {}
  const start = t.search(/[[{]/);
  if (start >= 0) {
    const open = t[start];
    const close = open === '{' ? '}' : ']';
    const end = t.lastIndexOf(close);
    if (end > start) return JSON.parse(t.slice(start, end + 1));
  }
  throw new Error('Não consegui ler o JSON da IA: ' + text.slice(0, 300));
}

function slug(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'item';
}

function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Data/hora "agora" no fuso configurado */
function nowInTz(tz) {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t).value;
  const hour = g('hour') === '24' ? '00' : g('hour');
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${hour}:${g('minute')}`, minutes: Number(hour) * 60 + Number(g('minute')) };
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  ROOT, DATA_DIR, WEB_DIR, ensureDir, logger, sleep, readJSON, writeJSON, run, commandExists,
  fetchRetry, extractJSON, slug, uid, nowInTz, addDays,
};
