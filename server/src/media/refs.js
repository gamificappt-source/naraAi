// Pastas de referências por perfil:  C:\NARA\Referencias\<Perfil>\Video  e  \Carrossel
// Você joga várias imagens lá; a cada post a Nara usa uma DIFERENTE (rodízio).
// Cada imagem é analisada pela Claude UMA vez só (o resultado fica guardado → economiza).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');
const llm = require('../ai/llm');
const { ROOT, DATA_DIR, ensureDir, readJSON, writeJSON, logger } = require('../util');

const CACHE = path.join(DATA_DIR, 'refcache.json'); // análises já feitas
const STATE = path.join(DATA_DIR, 'refstate.json'); // quando cada imagem foi usada
const KINDS = { video: 'Video', carousel: 'Carrossel' };
const IMG = /\.(jpe?g|png|webp)$/i;
const OLD_REFS = path.join(DATA_DIR, 'refs');

function baseDir() {
  const s = config.load().settings;
  return s.refsRoot || path.resolve(ROOT, '..', '..', 'Referencias');
}
function safeName(n) {
  return String(n || 'Perfil').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Perfil';
}

/** Cria (se faltar) as pastas do perfil e devolve os caminhos */
function folders(p) {
  if (!p.refFolder) {
    p.refFolder = safeName(p.name);
    config.save();
  }
  const root = ensureDir(path.join(baseDir(), p.refFolder));
  const out = {};
  for (const [k, sub] of Object.entries(KINDS)) out[k] = ensureDir(path.join(root, sub));
  // traz a referência única antiga para a pasta nova (uma vez)
  for (const [k, field] of [['video', 'referenceImage'], ['carousel', 'carouselReference']]) {
    const old = p[field] && path.join(OLD_REFS, p[field]);
    if (old && fs.existsSync(old) && !files(out[k]).length) {
      try { fs.copyFileSync(old, path.join(out[k], 'referencia-1' + path.extname(old))); } catch (_) {}
    }
  }
  return { root, ...out };
}
function files(dir) {
  try { return fs.readdirSync(dir).filter((f) => IMG.test(f)).sort(); } catch (_) { return []; }
}

function cacheKey(abs) {
  const st = fs.statSync(abs);
  return `${abs}|${st.size}|${Math.round(st.mtimeMs)}`;
}

/** Análise de uma imagem (guardada para sempre; só chama a Claude se for nova/alterada) */
async function analysis(abs) {
  const cache = readJSON(CACHE, {});
  const key = cacheKey(abs);
  if (cache[key]) return cache[key];
  const st = await llm.analyzeStyle(abs);
  const r = { style: (st.style_prompt || '') + (st.mood ? ` (clima: ${st.mood})` : ''), palette: Array.isArray(st.palette) ? st.palette : [] };
  cache[key] = r;
  writeJSON(CACHE, cache);
  return r;
}

/** Escolhe a próxima referência (a que está há mais tempo sem uso) */
async function pick(p, kind) {
  const dir = folders(p)[kind];
  const list = files(dir);
  if (!list.length) return null;
  const state = readJSON(STATE, {});
  const used = (state[p.id] && state[p.id][kind]) || {};
  const sorted = list
    .map((f) => ({ f, t: used[f] ? new Date(used[f]).getTime() : 0, r: Math.random() }))
    .sort((a, b) => a.t - b.t || a.r - b.r);
  for (const { f } of sorted) {
    const abs = path.join(dir, f);
    try {
      const a = await analysis(abs);
      state[p.id] = state[p.id] || {};
      state[p.id][kind] = { ...used, [f]: new Date().toISOString() };
      writeJSON(STATE, state);
      return { file: f, abs, analysis: a.style, palette: a.palette };
    } catch (e) {
      logger.warn(`Referência ${f} não pôde ser analisada:`, e.message.slice(0, 150));
    }
  }
  return null;
}

/** Para a página: pastas e imagens de cada tipo */
function list(p) {
  const f = folders(p);
  const cache = readJSON(CACHE, {});
  const state = readJSON(STATE, {});
  const info = (kind) => files(f[kind]).map((name) => {
    const abs = path.join(f[kind], name);
    let analysed = false;
    try { analysed = !!cache[cacheKey(abs)]; } catch (_) {}
    const lu = state[p.id] && state[p.id][kind] && state[p.id][kind][name];
    return { name, analysed, lastUsed: lu || '' };
  });
  return { root: f.root, video: { dir: f.video, files: info('video') }, carousel: { dir: f.carousel, files: info('carousel') } };
}

function fileOf(p, kind, name) {
  if (!KINDS[kind]) throw new Error('tipo inválido');
  const dir = folders(p)[kind];
  const abs = path.resolve(dir, path.basename(String(name || '')));
  if (!abs.startsWith(path.resolve(dir) + path.sep) || !IMG.test(abs)) throw new Error('arquivo inválido');
  return abs;
}

function add(p, kind, dataUrl, name) {
  const m = String(dataUrl).match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
  if (!m) throw new Error('Envie imagens PNG, JPG ou WEBP');
  const ext = '.' + m[1].replace('jpeg', 'jpg');
  const dir = folders(p)[kind];
  let base = path.basename(String(name || 'referencia'), path.extname(String(name || ''))).replace(/[^\w\- ]/g, '').trim() || 'referencia';
  let out = path.join(dir, base + ext);
  for (let i = 2; fs.existsSync(out); i++) out = path.join(dir, `${base}-${i}${ext}`);
  fs.writeFileSync(out, Buffer.from(m[2], 'base64'));
  return path.basename(out);
}

function remove(p, kind, name) {
  fs.rmSync(fileOf(p, kind, name), { force: true });
}

/** Abre a pasta no Explorador de Arquivos do Windows */
function open(p, kind) {
  const f = folders(p);
  const dir = KINDS[kind] ? f[kind] : f.root;
  const cmd = process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  spawn(cmd, [dir], { detached: true, stdio: 'ignore' }).unref();
  return dir;
}

module.exports = { pick, list, add, remove, open, fileOf, folders, KINDS };
