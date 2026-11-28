// Banco de temas por perfil:
//  - a Claude pesquisa um LOTE de temas de uma vez (1 pesquisa = ~12 vídeos → economiza muito)
//  - histórico permanente de tudo que já foi usado (não depende da lista de produções)
//  - filtro de temas parecidos e rodízio de assuntos (não repete o mesmo tipo seguido)
const path = require('path');
const writer = require('./ai/writer');
const { DATA_DIR, ensureDir, readJSON, writeJSON, logger } = require('./util');

const DIR = ensureDir(path.join(DATA_DIR, 'topics'));
const BATCH = 12; // temas por pesquisa
const MIN_BANK = 2; // quando sobrar menos que isso, pesquisa outro lote

const file = (pid) => path.join(DIR, `${pid}.json`);
function load(pid) {
  const st = readJSON(file(pid), {});
  return { bank: st.bank || [], used: st.used || [], lastResearch: st.lastResearch || '' };
}
function save(pid, st) {
  if (st.used.length > 1500) st.used = st.used.slice(-1500);
  writeJSON(file(pid), st);
}

// ---------- comparação de temas (sem IA, de graça) ----------
const STOP = new Set('para pela pelo pelas pelos como mais menos sobre entre quando onde quem qual quais porque depois antes ainda isso essa esse esta este aquela aquele muito muita uma umas uns dos das nos nas com sem que foi era sao ser ter tem caso casos historia mistério misterio verdade real reais'.split(' '));
function words(s) {
  return new Set(
    String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w))
  );
}
function similar(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const jacc = inter / (A.size + B.size - inter);
  const contain = inter / Math.min(A.size, B.size);
  return jacc >= 0.45 || (contain >= 0.7 && inter >= 2);
}
function isDup(text, list) {
  return list.some((x) => similar(text, x.topic || x) || (x.title && similar(text, x.title)));
}

/** Pesquisa um lote novo de temas (uma só chamada à Claude) */
async function refill(p, st, perf, extraTitles = []) {
  const avoid = [...new Set([...st.used.map((u) => u.title || u.topic), ...extraTitles].filter(Boolean))]
    .slice(-150).map((t) => String(t).slice(0, 90));
  const kinds = ['video', 'carousel'].filter((k) => (k === 'video' ? p.videosPerDay : p.carouselsPerDay + p.imagesPerDay) > 0);
  const r = await writer.researchTopics(p, avoid, st.bank.map((b) => b.topic), perf, BATCH, kinds);
  let added = 0;
  for (const t of r.topics || []) {
    if (!t || !t.topic) continue;
    if (isDup(t.topic, [...st.used, ...st.bank])) continue;
    st.bank.push({ topic: String(t.topic).slice(0, 300), angle: String(t.angle || '').slice(0, 300), category: String(t.category || 'geral').slice(0, 60), why: String(t.why || '').slice(0, 200), addedAt: new Date().toISOString() });
    added++;
  }
  st.lastResearch = new Date().toISOString();
  logger.info(`Banco de temas de ${p.name}: +${added} temas novos (pesquisa em lote)`);
  return added;
}

/** Próximo tema do perfil: tira do banco, alternando o tipo de assunto */
async function next(p, kind, perf = [], extraTitles = []) {
  const st = load(p.id);
  st.bank = st.bank.filter((t) => !isDup(t.topic, st.used));
  if (st.bank.length < MIN_BANK) {
    try {
      await refill(p, st, perf, extraTitles);
    } catch (e) {
      if (!st.bank.length) throw e;
      logger.warn('Pesquisa de temas falhou, usando o que sobrou no banco:', e.message.slice(0, 150));
    }
  }
  if (!st.bank.length) throw new Error('A pesquisa não trouxe temas novos (todos já foram usados). Adicione temas na fila do perfil.');
  // não repete a mesma categoria dos 2 últimos posts, se der
  const recent = st.used.slice(-2).map((u) => String(u.category || '').toLowerCase());
  let i = st.bank.findIndex((t) => !recent.includes(String(t.category || '').toLowerCase()));
  if (i < 0) i = 0;
  const t = st.bank.splice(i, 1)[0];
  st.used.push({ topic: t.topic, angle: t.angle, category: t.category, kind, at: new Date().toISOString() });
  save(p.id, st);
  return t;
}

/** Guarda também o título final (ajuda a não repetir) */
function recordTitle(pid, topic, title) {
  if (!title) return;
  const st = load(pid);
  const u = [...st.used].reverse().find((x) => x.topic === topic);
  if (u) u.title = String(title).slice(0, 150);
  else st.used.push({ topic: topic || title, title: String(title).slice(0, 150), at: new Date().toISOString() });
  save(pid, st);
}
/** Registra um tema escolhido à mão (fila do perfil ou pedido), para não repetir depois */
function recordManual(pid, topic, kind) {
  const st = load(pid);
  st.used.push({ topic, kind, category: 'manual', at: new Date().toISOString() });
  save(pid, st);
}

function view(pid) {
  const st = load(pid);
  return { bank: st.bank, used: st.used.slice(-60).reverse(), total: st.used.length, lastResearch: st.lastResearch };
}
function clearBank(pid) {
  const st = load(pid);
  st.bank = [];
  save(pid, st);
}

module.exports = { next, recordTitle, recordManual, view, clearBank, similar };
