// Busca imagens na internet (Openverse, Wikimedia, Pexels) e gera por IA (Pollinations, grátis)
const fs = require('fs');
const config = require('../config');
const { fetchRetry, run, logger } = require('../util');

const UA = { 'User-Agent': 'NaraContentBot/1.0 (personal automation)' };

async function searchOpenverse(q) {
  const res = await fetchRetry(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=10&mature=false`, { headers: UA }, { tries: 2, timeoutMs: 20000 });
  if (!res.ok) return [];
  const d = await res.json();
  return (d.results || []).filter((r) => (r.width || 0) >= 600).map((r) => r.url);
}

async function searchWikimedia(q) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=10&gsrsearch=${encodeURIComponent(q)}&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=1600`;
  const res = await fetchRetry(url, { headers: UA }, { tries: 2, timeoutMs: 20000 });
  if (!res.ok) return [];
  const d = await res.json();
  const pages = Object.values((d.query && d.query.pages) || {});
  return pages
    .map((p) => p.imageinfo && p.imageinfo[0])
    .filter((i) => i && /jpeg|png/.test(i.mime) && i.width >= 600)
    .map((i) => i.thumburl || i.url);
}

async function searchPexels(q, orientation) {
  const key = config.load().settings.pexelsKey;
  if (!key) return [];
  const res = await fetchRetry(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=10&orientation=${orientation}`, { headers: { Authorization: key } }, { tries: 2, timeoutMs: 20000 });
  if (!res.ok) return [];
  const d = await res.json();
  return (d.photos || []).map((p) => p.src.large2x || p.src.large);
}

function pollinationsUrl(prompt, w, h) {
  const seed = Math.floor(Math.random() * 1e9);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 900))}?width=${w}&height=${h}&nologo=true&seed=${seed}&model=flux`;
}

async function download(url, dest) {
  const res = await fetchRetry(url, { headers: UA }, { tries: 2, timeoutMs: 90000 });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 8000) throw new Error('imagem muito pequena');
  fs.writeFileSync(dest + '.src', buf);
  // normaliza para JPG (valida que é imagem de verdade)
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', dest + '.src', '-frames:v', '1', '-q:v', '3', dest]);
  fs.unlinkSync(dest + '.src');
  return dest;
}

const usedUrls = new Set();

/**
 * Consegue uma imagem para a cena.
 * source: web | ai | mix ; orientation: portrait | landscape | square
 */
async function getImage({ search, visual, styleHint, source, orientation, dest, index = 0 }) {
  const [w, h] = orientation === 'landscape' ? [1600, 900] : orientation === 'square' ? [1200, 1200] : [1080, 1920];
  const useAiFirst = source === 'ai' || (source === 'mix' && index % 2 === 1);
  const tryWeb = async () => {
    if (!search) return null;
    const lists = await Promise.all([
      searchPexels(search, orientation === 'square' ? 'square' : orientation).catch(() => []),
      searchOpenverse(search).catch(() => []),
      searchWikimedia(search).catch(() => []),
    ]);
    const urls = lists.flat().filter((u) => !usedUrls.has(u));
    for (const u of urls.slice(0, 6)) {
      try {
        await download(u, dest);
        usedUrls.add(u);
        if (usedUrls.size > 2000) usedUrls.clear();
        return dest;
      } catch (_) {}
    }
    return null;
  };
  const tryAi = async () => {
    const prompt = [visual || search, styleHint, 'no text, no watermark, high detail'].filter(Boolean).join(', ');
    try {
      return await download(pollinationsUrl(prompt, w, h), dest);
    } catch (e) {
      logger.warn('Imagem por IA falhou:', e.message);
      return null;
    }
  };
  const order = source === 'web' ? [tryWeb, tryAi] : useAiFirst ? [tryAi, tryWeb] : [tryWeb, tryAi];
  for (const fn of order) {
    const r = await fn();
    if (r) return r;
  }
  return null; // quem chamou cria um fundo de cor sólida
}

module.exports = { getImage, download };
