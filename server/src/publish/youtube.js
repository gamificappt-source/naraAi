// YouTube: login (OAuth), upload de vídeo e estatísticas do canal
const fs = require('fs');
const config = require('../config');
const { fetchRetry, logger } = require('../util');

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
].join(' ');

function redirectUri() {
  return 'http://localhost:8080/oauth/youtube/callback';
}

function authUrl(profileId) {
  const s = config.load().settings;
  if (!s.youtubeClientId) throw new Error('Cole primeiro o Client ID e o Client Secret do YouTube em Configurações');
  const q = new URLSearchParams({
    client_id: s.youtubeClientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent select_account',
    state: profileId,
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}

async function exchangeCode(profileId, code) {
  const s = config.load().settings;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: s.youtubeClientId, client_secret: s.youtubeClientSecret,
      redirect_uri: redirectUri(), grant_type: 'authorization_code',
    }),
  });
  const d = await res.json();
  if (!res.ok || !d.refresh_token) throw new Error('Falha no login do YouTube: ' + JSON.stringify(d).slice(0, 300));
  const p = config.getProfile(profileId);
  if (!p) throw new Error('Perfil não encontrado');
  p.youtube.refreshToken = d.refresh_token;
  p.youtube.enabled = true;
  config.save();
  try {
    const ch = await channelStats(p);
    p.youtube.channelTitle = ch.title;
    p.youtube.channelId = ch.id;
    config.save();
  } catch (e) {
    logger.warn('Não consegui ler o canal:', e.message);
  }
  return p;
}

const tokenCache = new Map();
async function accessToken(p) {
  const c = tokenCache.get(p.id);
  if (c && c.exp > Date.now() + 60000) return c.token;
  const s = config.load().settings;
  if (!p.youtube.refreshToken) throw new Error(`Perfil ${p.name} não está conectado ao YouTube`);
  const res = await fetchRetry('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: s.youtubeClientId, client_secret: s.youtubeClientSecret,
      refresh_token: p.youtube.refreshToken, grant_type: 'refresh_token',
    }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error('Token do YouTube inválido (reconecte o perfil): ' + JSON.stringify(d).slice(0, 200));
  tokenCache.set(p.id, { token: d.access_token, exp: Date.now() + d.expires_in * 1000 });
  return d.access_token;
}

async function uploadVideo(p, file, { title, description, tags = [] }) {
  const token = await accessToken(p);
  const isShort = p.videoFormat !== 'long';
  const meta = {
    snippet: {
      title: (title + (isShort && !/#shorts/i.test(title) ? ' #Shorts' : '')).slice(0, 100),
      description: description.slice(0, 4900),
      tags: tags.map((t) => t.replace(/^#/, '')).slice(0, 15),
      categoryId: String(p.youtube.categoryId || '24'),
      defaultLanguage: p.language,
    },
    status: { privacyStatus: p.youtube.privacy || 'public', selfDeclaredMadeForKids: !!p.youtube.madeForKids },
  };
  const size = fs.statSync(file).size;
  const init = await fetchRetry('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify(meta),
  });
  if (!init.ok) throw new Error('YouTube recusou o upload: ' + (await init.text()).slice(0, 400));
  const loc = init.headers.get('location');
  const put = await fetchRetry(loc, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size) },
    body: fs.readFileSync(file),
  }, { timeoutMs: 15 * 60000 });
  const d = await put.json().catch(() => ({}));
  if (!put.ok) throw new Error('Falha ao enviar vídeo ao YouTube: ' + JSON.stringify(d).slice(0, 400));
  logger.info(`YouTube: publicado ${d.id} (${p.name})`);
  return { id: d.id, url: `https://youtu.be/${d.id}` };
}

async function channelStats(p) {
  const token = await accessToken(p);
  const res = await fetchRetry('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await res.json();
  if (!res.ok || !d.items || !d.items[0]) throw new Error('Canal não encontrado: ' + JSON.stringify(d).slice(0, 200));
  const it = d.items[0];
  return {
    id: it.id,
    title: it.snippet.title,
    followers: Number(it.statistics.subscriberCount || 0),
    views: Number(it.statistics.viewCount || 0),
    posts: Number(it.statistics.videoCount || 0),
  };
}

async function videosStats(p, ids) {
  if (!ids.length) return {};
  const token = await accessToken(p);
  const res = await fetchRetry(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.slice(0, 50).join(',')}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await res.json();
  const out = {};
  for (const it of d.items || []) {
    out[it.id] = { views: Number(it.statistics.viewCount || 0), likes: Number(it.statistics.likeCount || 0), comments: Number(it.statistics.commentCount || 0) };
  }
  return out;
}

module.exports = { authUrl, exchangeCode, uploadVideo, channelStats, videosStats, redirectUri };
