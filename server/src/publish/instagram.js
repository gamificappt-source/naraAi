// Instagram (conta Profissional: Criador ou Empresa) — aceita token do login do Instagram ou do login unificado da Meta
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { fetchRetry, sleep, logger } = require('../util');

// Dois tipos de token:
//  - IGAA… (login do Instagram)      → graph.instagram.com
//  - EAA…  (login unificado da Meta / token de sistema do portfólio) → graph.facebook.com
const IG_API = 'https://graph.instagram.com/v22.0';
const FB_API = 'https://graph.facebook.com/v22.0';
const isFbToken = (p) => /^EAA/.test(String(p.instagram.accessToken || '').trim());
const apiBase = (p) => (isFbToken(p) ? FB_API : IG_API);

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

async function api(p, method, endpoint, params = {}, base = null) {
  const url = new URL((base || apiBase(p)) + endpoint);
  const body = new URLSearchParams({ ...params, access_token: String(p.instagram.accessToken).trim() });
  const res = await fetchRetry(method === 'GET' ? url + '?' + body : url, method === 'GET' ? {} : { method, body }, { timeoutMs: 120000 });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.error) throw new Error('Instagram: ' + JSON.stringify(d.error || d).slice(0, 400));
  return d;
}

async function check(p) {
  if (!p.instagram.accessToken) throw new Error(`Perfil ${p.name}: Instagram não configurado (falta o token)`);
  if (p.instagram.userId) return;
  // descobre o ID da conta sozinho a partir do token
  if (!isFbToken(p)) {
    const d = await api(p, 'GET', '/me', { fields: 'user_id,username' });
    p.instagram.userId = String(d.user_id || d.id);
    if (d.username) p.instagram.username = d.username;
    config.save();
    return;
  }
  // token da Meta (EAA…): procura a conta do Instagram ligada ao token
  const tries = [
    async () => {
      const d = await api(p, 'GET', '/me/accounts', { fields: 'instagram_business_account{id,username}', limit: '50' });
      return (d.data || []).map((x) => x.instagram_business_account).filter(Boolean);
    },
    async () => {
      const d = await api(p, 'GET', '/me', { fields: 'instagram_business_accounts{id,username}' });
      return (d.instagram_business_accounts && d.instagram_business_accounts.data) || [];
    },
    async () => {
      // token que também vale no endereço do Instagram
      const d = await api(p, 'GET', '/me', { fields: 'user_id,username' }, IG_API);
      return d.user_id ? [{ id: d.user_id, username: d.username }] : [];
    },
  ];
  let found = [];
  const errs = [];
  for (const t of tries) {
    try { found = await t(); if (found.length) break; } catch (e) { errs.push(e.message.slice(0, 120)); }
  }
  if (!found.length) {
    throw new Error('Não achei a conta do Instagram ligada a este token. Cole o "ID da conta do Instagram" (aparece na Meta, ao lado da conta, em "Gerar tokens de acesso") no campo do perfil. ' + errs.join(' | '));
  }
  // se o token dá acesso a várias contas, prefere a que tem o @ informado no perfil
  const want = String(p.instagram.username || '').replace(/^@/, '').toLowerCase();
  const pick = found.find((a) => want && String(a.username || '').toLowerCase() === want) || found[0];
  p.instagram.userId = String(pick.id);
  if (pick.username) p.instagram.username = pick.username;
  config.save();
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
    const c = await api(p, 'POST', `/${p.instagram.userId}/media`, { media_type: 'REELS', upload_type: 'resumable', caption, share_to_feed: p.instagram.shareToFeed === false ? 'false' : 'true' });
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
    const c = await api(p, 'POST', `/${p.instagram.userId}/media`, { media_type: 'REELS', video_url: url, caption, share_to_feed: p.instagram.shareToFeed === false ? 'false' : 'true' });
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
  const d = await api(p, 'GET', `/${p.instagram.userId}`, { fields: 'username,followers_count,follows_count,media_count' });
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

/** Média dos últimos posts da conta (inclusive os que não foram feitos pela Nara) */
async function recentAverages(p, n = 12) {
  await check(p);
  const d = await api(p, 'GET', `/${p.instagram.userId}/media`, { fields: 'id,like_count,comments_count,timestamp', limit: String(n) });
  const items = d.data || [];
  if (!items.length) return { avgViews: 0, avgLikes: 0, avgComments: 0, sample: 0 };
  let views = 0, withViews = 0;
  for (const m of items) {
    try {
      const ins = await api(p, 'GET', `/${m.id}/insights`, { metric: 'views' });
      const v = ins.data && ins.data[0] && ins.data[0].values && ins.data[0].values[0] ? ins.data[0].values[0].value : null;
      if (v != null) { views += Number(v) || 0; withViews++; }
    } catch (_) {}
  }
  const sum = (k) => items.reduce((a, m) => a + (Number(m[k]) || 0), 0);
  return {
    avgViews: withViews ? Math.round(views / withViews) : null,
    avgLikes: Math.round(sum('like_count') / items.length),
    avgComments: Math.round(sum('comments_count') / items.length),
    sample: items.length,
  };
}

/** Tokens longos do Instagram duram 60 dias; renovamos a cada ~7 dias */
async function refreshToken(p) {
  if (!p.instagram.accessToken || isFbToken(p)) return; // token da Meta (EAA…) não expira / não usa essa renovação
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

module.exports = { postReel, postImages, accountStats, mediaStats, recentAverages, refreshToken };
