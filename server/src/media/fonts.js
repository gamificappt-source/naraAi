// Biblioteca de fontes: você cola o código de incorporação do Google Fonts
// (<link href="https://fonts.googleapis.com/css2?family=...">, @import ou só o link)
// e a Nara baixa cada variação (peso/itálico) em .ttf para usar nos vídeos e carrosséis.
const fs = require('fs');
const path = require('path');
const { DATA_DIR, ensureDir, readJSON, writeJSON, logger } = require('../util');

const FONTS_DIR = ensureDir(path.join(DATA_DIR, 'fonts'));
const META = path.join(FONTS_DIR, 'fonts.json');
const DEFAULTS = 'https://fonts.googleapis.com/css2?family=Anton&family=Bebas+Neue&family=Poppins:wght@400;700;800&family=Montserrat:wght@400;700;900&family=Oswald:wght@500;700&family=Inter:wght@400;700&display=swap';
const WEIGHT_NAMES = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };

/** Lê os nomes de dentro do arquivo .ttf (tabela "name") */
function ttfNames(buf) {
  const out = {};
  try {
    const n = buf.readUInt16BE(4);
    for (let i = 0; i < n; i++) {
      const rec = 12 + 16 * i;
      if (buf.toString('ascii', rec, rec + 4) !== 'name') continue;
      const off = buf.readUInt32BE(rec + 8);
      const count = buf.readUInt16BE(off + 2);
      const strOff = off + buf.readUInt16BE(off + 4);
      for (let k = 0; k < count; k++) {
        const r = off + 6 + 12 * k;
        const platform = buf.readUInt16BE(r);
        const lang = buf.readUInt16BE(r + 4);
        const id = buf.readUInt16BE(r + 6);
        const len = buf.readUInt16BE(r + 8);
        const so = strOff + buf.readUInt16BE(r + 10);
        if (platform !== 3 || (lang !== 0x409 && out[id])) continue;
        const raw = Buffer.from(buf.subarray(so, so + len));
        for (let j = 0; j + 1 < raw.length; j += 2) { const t = raw[j]; raw[j] = raw[j + 1]; raw[j + 1] = t; }
        out[id] = raw.toString('utf16le');
      }
    }
  } catch (_) {}
  return { family: out[16] || out[1] || '', sub: out[17] || out[2] || '', full: out[4] || '' };
}

function list() {
  const meta = readJSON(META, []);
  return meta.filter((f) => fs.existsSync(path.join(FONTS_DIR, f.file)));
}

/** Extrai os links do Google Fonts do que você colou (ou monta a partir de nomes: "Inter, Oswald") */
function urlsFrom(code) {
  const txt = String(code || '').replace(/&amp;/g, '&');
  const urls = [...txt.matchAll(/https?:\/\/fonts\.googleapis\.com\/css2?\?[^"'\s)<>]+/g)].map((m) => m[0]);
  if (urls.length) return [...new Set(urls)];
  const names = txt.split(/[,\n;]+/).map((s) => s.trim()).filter((s) => /^[A-Za-z0-9 ]{2,40}$/.test(s));
  if (!names.length) return [];
  return ['https://fonts.googleapis.com/css2?' + names.map((n) => 'family=' + n.replace(/ /g, '+') + ':wght@400;700').join('&') + '&display=swap'];
}

async function addFromEmbed(code) {
  const urls = urlsFrom(code);
  if (!urls.length) throw new Error('Não achei nenhum link do Google Fonts. Cole o código de incorporação (<link ...> ou @import).');
  const meta = readJSON(META, []);
  const added = [];
  for (const url of urls) {
    // sem "navegador" no pedido o Google entrega .ttf (o formato que o ffmpeg usa)
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Google Fonts recusou (${res.status}). Confira o nome da fonte.`);
    const css = await res.text();
    for (const block of css.match(/@font-face\s*{[^}]+}/g) || []) {
      const fam = (block.match(/font-family:\s*'([^']+)'/) || [])[1];
      const weight = Number((block.match(/font-weight:\s*(\d+)/) || [])[1] || 400);
      const italic = /font-style:\s*italic/.test(block);
      const src = (block.match(/url\((https:[^)]+\.ttf)\)/) || [])[1];
      if (!fam || !src) continue;
      const file = `${fam.replace(/[^A-Za-z0-9]/g, '')}-${weight}${italic ? 'i' : ''}.ttf`;
      const dest = path.join(FONTS_DIR, file);
      if (!fs.existsSync(dest)) {
        const r = await fetch(src);
        if (!r.ok) continue;
        fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      }
      const n = ttfNames(fs.readFileSync(dest));
      const entry = {
        file, family: fam, weight, italic,
        // nome que o montador de vídeo (libass) procura dentro do arquivo
        name: n.full || `${fam} ${WEIGHT_NAMES[weight] || weight}`,
        label: `${fam} ${WEIGHT_NAMES[weight] || weight}${italic ? ' Itálico' : ''}`,
      };
      const i = meta.findIndex((x) => x.file === file);
      if (i >= 0) meta[i] = entry; else meta.push(entry);
      added.push(entry);
    }
  }
  meta.sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight || Number(a.italic) - Number(b.italic));
  writeJSON(META, meta);
  if (!added.length) throw new Error('O Google Fonts não devolveu nenhum arquivo para esse código.');
  return added;
}

function remove(file) {
  const meta = readJSON(META, []).filter((x) => x.file !== file);
  fs.rmSync(path.join(FONTS_DIR, path.basename(file)), { force: true });
  writeJSON(META, meta);
}

/** Na primeira vez, baixa um pacote de fontes boas para começar */
async function ensureDefaults() {
  if (fs.existsSync(META) && readJSON(META, []).length) return;
  try {
    const a = await addFromEmbed(DEFAULTS);
    logger.info(`Fontes iniciais instaladas (${a.length})`);
  } catch (e) {
    logger.warn('Não consegui baixar as fontes iniciais:', e.message);
  }
}

/** Nome que vai no estilo das legendas: aceita o nome salvo no perfil (novo ou antigo) */
function resolve(value, fallback = 'Anton') {
  const v = String(value || '').trim() || fallback;
  const all = list();
  const hit = all.find((f) => f.name === v || f.label === v || f.file === v) || all.find((f) => f.family === v);
  return hit ? hit.name : v;
}

module.exports = { list, addFromEmbed, remove, ensureDefaults, resolve, FONTS_DIR, ttfNames };
