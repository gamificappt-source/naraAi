// Coleta seguidores/visualizações por perfil e guarda um retrato por dia
const path = require('path');
const config = require('./config');
const jobs = require('./jobs');
const youtube = require('./publish/youtube');
const instagram = require('./publish/instagram');
const { DATA_DIR, readJSON, writeJSON, nowInTz, addDays, logger } = require('./util');

const STATS_FILE = path.join(DATA_DIR, 'stats.json');

function all() {
  return readJSON(STATS_FILE, {});
}

/** Números de um perfil (seguidores, posts e média dos últimos posts da conta) */
async function profileStats(p) {
  const s = { name: p.name, at: new Date().toISOString() };
  if (p.youtube.refreshToken) {
    try { s.youtube = await youtube.channelStats(p); } catch (e) { s.youtubeError = e.message; }
  }
  if (p.instagram.accessToken) {
    try {
      s.instagram = await instagram.accountStats(p);
      try { Object.assign(s.instagram, await instagram.recentAverages(p)); } catch (e) { logger.warn('Média do Instagram:', e.message.slice(0, 150)); }
    } catch (e) { s.instagramError = e.message; }
  }
  return s;
}

/** Atualiza só um perfil (usado ao abrir a página do perfil e no "Testar conexão") */
async function refreshProfile(profileId) {
  const p = config.getProfile(profileId);
  if (!p) throw new Error('Perfil não encontrado');
  const today = nowInTz(config.load().settings.timezone).date;
  const s = await profileStats(p);
  const stats = all();
  stats[today] = stats[today] || {};
  stats[today][p.id] = s;
  writeJSON(STATS_FILE, stats);
  return s;
}

async function snapshot() {
  const c = config.load();
  const today = nowInTz(c.settings.timezone).date;
  const stats = all();
  stats[today] = stats[today] || {};
  for (const p of c.profiles) stats[today][p.id] = await profileStats(p);
  // desempenho dos posts dos últimos 3 dias
  const since = Date.now() - 3 * 86400000;
  const recent = jobs.list().filter((j) => j.status === 'done' && j.postedAt && new Date(j.postedAt).getTime() > since);
  const byProfile = {};
  for (const j of recent) (byProfile[j.profileId] = byProfile[j.profileId] || []).push(j);
  for (const [pid, js] of Object.entries(byProfile)) {
    const p = config.getProfile(pid);
    if (!p) continue;
    const ytIds = js.map((j) => j.results.youtube && j.results.youtube.id).filter(Boolean);
    let yt = {};
    try { yt = await youtube.videosStats(p, ytIds); } catch (_) {}
    for (const j of js) {
      j.metrics = j.metrics || {};
      if (j.results.youtube && yt[j.results.youtube.id]) j.metrics.youtube = yt[j.results.youtube.id];
      if (j.results.instagram && j.results.instagram.id) {
        try { j.metrics.instagram = await instagram.mediaStats(p, j.results.instagram.id); } catch (_) {}
      }
    }
  }
  jobs.persist();
  // guarda só 120 dias
  const keys = Object.keys(stats).sort();
  while (keys.length > 120) delete stats[keys.shift()];
  writeJSON(STATS_FILE, stats);
  logger.info('Estatísticas atualizadas');
  return stats[today];
}

/** Resumo comparando hoje com ontem (ou o último dia disponível) */
function summary() {
  const c = config.load();
  const today = nowInTz(c.settings.timezone).date;
  const stats = all();
  const days = Object.keys(stats).sort();
  const cur = stats[today] || stats[days[days.length - 1]] || {};
  const prevKey = days.filter((d) => d < today).pop();
  const prev = (prevKey && stats[prevKey]) || {};
  const out = [];
  for (const p of c.profiles) {
    const a = cur[p.id] || {};
    const b = prev[p.id] || {};
    const row = { profile: p.name };
    if (a.youtube) row.youtube = { inscritos: a.youtube.followers, variacao: b.youtube ? a.youtube.followers - b.youtube.followers : null, views_total: a.youtube.views };
    if (a.instagram) row.instagram = { seguidores: a.instagram.followers, variacao: b.instagram ? a.instagram.followers - b.instagram.followers : null };
    out.push(row);
  }
  const yday = addDays(today, -1);
  const posts = jobs.list()
    .filter((j) => j.postedAt && (j.postedAt.slice(0, 10) === yday || j.postedAt.slice(0, 10) === today))
    .map((j) => ({ perfil: j.profileName, tipo: j.type, titulo: j.title, metricas: j.metrics || {} }));
  const failures = jobs.list()
    .filter((j) => j.status === 'failed' && (j.updatedAt || j.createdAt) > addDays(today, -1))
    .map((j) => ({ perfil: j.profileName, erro: (j.error || '').slice(0, 160) }));
  return { comparadoCom: prevKey || null, perfis: out, postsRecentes: posts, falhas: failures };
}

module.exports = { snapshot, summary, all, refreshProfile };
