// Instagram (API do Instagram com login do Instagram — conta Profissional: Criador ou Empresa)
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { fetchRetry, sleep, logger } = require('../util');

const API = 'https://graph.instagram.com/v22.0';

/** O Instagram exige imagens em um link público. Subimos temporariamente (24h) no litterbox.catbox.moe */
async function publicUrl(file) {
  const fd = new FormData();
  fd.append('reqtype', 'fileupload');
  fd.append('time', '24h');
  fd.append('fileToUpload', new Blob([fs.readFileSync(file)]), path.basename(file));
  const res = await fetchRetry('https://litterbox.catbox.moe/resources/internals/api.php', { method: 'POST', body: fd }, { timeoutMs: 10 * 60000 });
  const txt = (await res.text()).trim();
  if (!res.ok || !/^https?:\/\//.test(txt)) throw new Error('Falha ao hospedar arquivo temporário: ' + txt.slice(0, 200));
  return txt;
}

async function api(p, method, endpoint, params = {}) {
  const url = new URL(API + endpoint);
  const body = new URLSearchParams({ ...params, access_token: p.instagram.accessToken });
  const res = await fetchRetry(method === 'GET' ? url + '?' + body : url, method === 'GET' ? {} : { method, body }, { timeoutMs: 120000 });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.error) throw new Error('Instagram: ' + JSON.stringify(d.error || d).slice(0, 400));
  return d;
}

async function check(p) {
  if (!p.instagram.accessToken) throw new Error(`Perfil ${p.name}: Instagram não configurado (falta o token)`);
  if (!p.instagram.userId) {
    // descobre o ID da conta sozinho a partir do token
    const d = await api(p, 'GET', '/me', { fields: 'user_id,username' });
    p.instagram.userId = String(d.user_id || d.id);
    if (d.username) p.instagram.username = d.username;
    config.save();
  }
}

async function waitReady(p, id, maxMin = 15) {
  const until = Date.now() + maxMin * 60000;
  while (Date.now() < until) {
    const d = await api(p, 'GET', `/${id}`, { fields: 'status_code,status' });
    if (d.status_code === 'FINISHED') return;
    if (d.status_code === 'ERROR' || d.status_code === 'EXPIRED') throw new Error('Instagram recusou a mídia: ' + (d.status || d.status_code));
    await sleep(8000);
  }
  throw new Error('Instagram demorou demais para processar a mídia');
}

async function publish(p, creationId) {
  const d = await api(p, 'POST', `/${p.instagram.userId}/media_publish`, { creation_id: creationId });
  let permalink = '';
  try {
    permalink = (await api(p, 'GET', `/${d.id}`, { fields: 'permalink' })).permalink;
  } catch (_) {}
  logger.info(`Instagram: publicado ${d.id} (${p.name})`);
  return { id: d.id, url: permalink };
}

async function postReel(p, file, caption) {
  await check(p);
  let containerId;
  // 1ª tentativa: upload direto (resumable) — o arquivo não precisa ficar público
  try {
    const c = await api(p, 'POST', `/${p.instagram.userId}/media`, { media_type: 'REELS', upload_type: 'resumable', caption, share_to_feed: 'true' });
    const size = fs.statSync(file).size;
    const up = await fetchRetry(`https://rupload.facebook.com/ig-api-upload/v22.0/${c.id}`, {
      method: 'POST',
      headers: { Authorization: `OAuth ${p.instagram.accessToken}`, offset: '0', file_size: String(size) },
      body: fs.readFileSync(file),
    }, { timeoutMs: 15 * 60000 });
    if (!up.ok) throw new Error(await up.text());
    containerId = c.id;
  } catch (e) {
    logger.warn('Upload direto do Reels falhou, usando link temporário:', e.message.slice(0, 200));
    const url = await publicUrl(file);
    const c = await api(p, 'POST', `/${p.instagram.userId}/media`, { media_type: 'REELS', video_url: url, caption, share_to_feed: 'true' });
    containerId = c.id;
  }
  await waitReady(p, containerId);
  return publish(p, containerId);
}

async function postImages(p, files, caption) {
  await check(p);
  if (files.length === 1) {
    const url = await publicUrl(files[0]);
    const c = await api(p, 'POST', `/${p.instagram.userId}/media`, { image_url: url, caption });
    await waitReady(p, c.id, 5);
    return publish(p, c.id);
  }
  const children = [];
  for (const f of files.slice(0, 10)) {
    const url = await publicUrl(f);
    const c = await api(p, 'POST', `/${p.instagram.userId}/media`, { image_url: url, is_carousel_item: 'true' });
    children.push(c.id);
  }
  for (const id of children) await waitReady(p, id, 5);
  const c = await api(p, 'POST', `/${p.instagram.userId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption });
  await waitReady(p, c.id, 5);
  return publish(p, c.id);
}

async function accountStats(p) {
  await check(p);
  const d = await api(p, 'GET', '/me', { fields: 'user_id,username,followers_count,follows_count,media_count' });
  if (d.username && p.instagram.username !== d.username) {
    p.instagram.username = d.username;
    config.save();
  }
  return { username: d.username, followers: Number(d.followers_count || 0), posts: Number(d.media_count || 0) };
}

async function mediaStats(p, id) {
  const d = await api(p, 'GET', `/${id}`, { fields: 'like_count,comments_count' });
  let views = 0;
  try {
    const ins = await api(p, 'GET', `/${id}/insights`, { metric: 'views,reach' });
    for (const m of ins.data || []) if (m.name === 'views') views = m.values?.[0]?.value || 0;
  } catch (_) {}
  return { likes: d.like_count || 0, comments: d.comments_count || 0, views };
}

/** Tokens longos do Instagram duram 60 dias; renovamos a cada ~7 dias */
async function refreshToken(p) {
  if (!p.instagram.accessToken) return;
  const last = p.instagram.tokenRefreshedAt ? new Date(p.instagram.tokenRefreshedAt).getTime() : 0;
  if (Date.now() - last < 7 * 86400000) return;
  try {
    const res = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(p.instagram.accessToken)}`);
    const d = await res.json();
    if (d.access_token) {
      p.instagram.accessToken = d.access_token;
      p.instagram.tokenRefreshedAt = new Date().toISOString();
      config.save();
      logger.info(`Instagram: token renovado (${p.name})`);
    } else logger.warn('Não renovou token do Instagram:', JSON.stringify(d).slice(0, 200));
  } catch (e) {
    logger.warn('Erro ao renovar token do Instagram:', e.message);
  }
}

module.exports = { postReel, postImages, accountStats, mediaStats, refreshToken };
