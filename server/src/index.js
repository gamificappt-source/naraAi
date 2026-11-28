// Nara — servidor principal (roda 24h neste PC; a página pode ficar fechada)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');
const jobs = require('./jobs');
const scheduler = require('./scheduler');
const analytics = require('./analytics');
const nara = require('./nara');
const llm = require('./ai/llm');
const voice = require('./ai/voice');
const youtube = require('./publish/youtube');
const instagram = require('./publish/instagram');
const { DATA_DIR, WEB_DIR, logger, nowInTz, uid } = require('./util');
const { FONTS_DIR } = require('./media/render');
const fonts = require('./media/fonts');

const PORT = Number(process.env.PORT) || 8080;
const MIME = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function send(res, code, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json', ...headers });
  res.end(data);
}

function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Arquivo grande demais'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function json(req) {
  const b = await readBody(req);
  return b.length ? JSON.parse(b.toString('utf8')) : {};
}

function serveFile(res, file, req) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'não encontrado' });
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const size = fs.statSync(file).size;
  const range = req.headers.range;
  if (range && type === 'video/mp4') {
    const [s, e] = range.replace('bytes=', '').split('-');
    const start = Number(s);
    const end = e ? Number(e) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

function authed(req, url, allowDevice = false) {
  const s = config.load().settings;
  const t = req.headers['x-nara-token'] || url.searchParams.get('t') || '';
  return t === s.adminToken || (allowDevice && t === s.deviceToken);
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}

function state() {
  const c = config.load();
  return {
    ...config.publicView(),
    now: nowInTz(c.settings.timezone),
    today: scheduler.today(),
    jobs: jobs.list().slice(-80).reverse(),
    busy: jobs.isBusy(),
    stats: analytics.summary(),
    statsHistory: analytics.all(),
    conversation: nara.conversation().slice(-30),
    logs: logger.recent().slice(-120),
    system: { addresses: lanAddresses(), port: PORT, uptime: Math.round(process.uptime()), node: process.version, freeMem: Math.round(os.freemem() / 1048576) },
  };
}

const okPage = (msg) => `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;background:#0d1117;color:#e6edf3;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:16px"><div><h2>${msg}</h2><p><a style="color:#7ee0c3" href="/">Voltar para a Nara</a></p></div>`;

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const m = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-nara-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (m === 'OPTIONS') return send(res, 204, '');

  // ---------- páginas ----------
  if (m === 'GET' && (p === '/' || p === '/index.html')) return serveFile(res, path.join(WEB_DIR, 'index.html'), req);
  if (m === 'GET' && p === '/api/ping') return send(res, 200, { ok: true, name: 'Nara' });
  // fontes da página (Anton, Bebas, Poppins...) — mesmas das legendas
  if (m === 'GET' && p.startsWith('/assets/fonts/')) {
    const file = path.join(FONTS_DIR, path.basename(decodeURIComponent(p)));
    return serveFile(res, file, req);
  }

  if (m === 'GET' && p === '/oauth/youtube/callback') {
    try {
      if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error'));
      const prof = await youtube.exchangeCode(url.searchParams.get('state'), url.searchParams.get('code'));
      return send(res, 200, okPage(`✅ YouTube conectado ao perfil “${prof.name}” (${prof.youtube.channelTitle || 'canal'})`));
    } catch (e) {
      return send(res, 400, okPage('❌ ' + e.message));
    }
  }

  // ---------- Atom S3R ----------
  if (p.startsWith('/api/device/')) {
    if (!authed(req, url, true)) return send(res, 401, { error: 'token inválido' });
    if (m === 'POST' && p === '/api/device/wake') return send(res, 200, { ...(await nara.wake()), audio: !!nara.lastAudio() });
    if (m === 'POST' && p === '/api/device/voice') {
      const wav = await readBody(req, 4 * 1024 * 1024);
      const r = await nara.voice(wav, { requireWake: url.searchParams.get('wake') !== '0' });
      return send(res, 200, { heard: r.heard, reply: r.reply, audio: !!(r.reply && nara.lastAudio()) });
    }
    if (m === 'GET' && p === '/api/device/audio') {
      const a = nara.lastAudio();
      return a ? send(res, 200, a, { 'Content-Type': 'application/octet-stream', 'X-Sample-Rate': '24000' }) : send(res, 404, { error: 'sem áudio' });
    }
    if (m === 'GET' && p === '/api/device/status') {
      const t = scheduler.today();
      return send(res, 200, { ok: true, done: t.filter((s) => s.status === 'done').length, total: t.length, busy: jobs.isBusy() });
    }
  }

  // ---------- arquivos gerados (vídeos/imagens) ----------
  if (m === 'GET' && p.startsWith('/files/')) {
    if (!authed(req, url)) return send(res, 401, { error: 'token inválido' });
    const rel = decodeURIComponent(p.slice(7));
    const file = path.resolve(DATA_DIR, rel);
    if (!file.startsWith(path.resolve(DATA_DIR) + path.sep) || /config\.json|\.log/.test(file)) return send(res, 403, { error: 'proibido' });
    return serveFile(res, file, req);
  }

  if (!p.startsWith('/api/')) {
    const file = path.resolve(WEB_DIR, '.' + p);
    if (file.startsWith(WEB_DIR)) return serveFile(res, file, req);
    return send(res, 404, { error: 'não encontrado' });
  }

  // ---------- API da página (precisa da senha) ----------
  if (p === '/api/login' && m === 'POST') {
    const b = await json(req);
    return b.token === config.load().settings.adminToken ? send(res, 200, { ok: true }) : send(res, 401, { error: 'Senha errada' });
  }
  if (!authed(req, url)) return send(res, 401, { error: 'Senha necessária' });

  if (m === 'GET' && p === '/api/state') return send(res, 200, state());

  if (m === 'POST' && p === '/api/settings') {
    config.updateSettings(await json(req));
    return send(res, 200, state());
  }
  if (m === 'POST' && p === '/api/profiles') {
    const prof = config.upsertProfile(await json(req));
    return send(res, 200, { profile: config.publicView().profiles.find((x) => x.id === prof.id) });
  }
  let mm;
  if ((mm = p.match(/^\/api\/profiles\/([\w-]+)$/)) && m === 'DELETE') {
    config.deleteProfile(mm[1]);
    return send(res, 200, { ok: true });
  }
  // capa, logo, referência do vídeo e referência do carrossel
  if ((mm = p.match(/^\/api\/profiles\/([\w-]+)\/image$/)) && m === 'POST') {
    const b = await json(req);
    const prof = config.getProfile(mm[1]);
    if (!prof) return send(res, 404, { error: 'perfil não encontrado' });
    const field = { cover: 'coverImage', logo: 'logoImage', reference: 'referenceImage', carousel: 'carouselReference' }[b.kind];
    if (!field) return send(res, 400, { error: 'tipo de imagem inválido' });
    const analysisField = { reference: 'styleAnalysis', carousel: 'carouselStyleAnalysis' }[b.kind];
    if (!b.dataUrl) {
      prof[field] = '';
      if (analysisField) prof[analysisField] = '';
      config.save();
      return send(res, 200, { ok: true });
    }
    const match = String(b.dataUrl).match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
    if (!match) return send(res, 400, { error: 'Envie uma imagem PNG, JPG ou WEBP' });
    const name = `${prof.id}_${b.kind}_${uid()}.${match[1].replace('jpeg', 'jpg')}`;
    fs.writeFileSync(path.join(jobs.REFS_DIR, name), Buffer.from(match[2], 'base64'));
    const old = prof[field];
    if (old && old !== name) fs.rmSync(path.join(jobs.REFS_DIR, old), { force: true });
    prof[field] = name;
    if (analysisField) prof[analysisField] = '';
    config.save();
    if (!analysisField) return send(res, 200, { ok: true, file: name });
    try {
      const st = await llm.analyzeStyle(path.join(jobs.REFS_DIR, name));
      prof[analysisField] = (st.style_prompt || '') + (st.mood ? ` (clima: ${st.mood})` : '');
      config.save();
      return send(res, 200, { ok: true, file: name, analysis: prof[analysisField], palette: st.palette || [] });
    } catch (e) {
      return send(res, 200, { ok: true, file: name, analysis: '', warning: 'Imagem salva. A análise do estilo será feita na próxima produção: ' + e.message });
    }
  }
  if (m === 'GET' && p === '/api/voices') {
    return send(res, 200, { google: llm.GOOGLE_VOICES, nara: voice.NARA_VOICES });
  }
  if (m === 'GET' && p === '/api/fonts') return send(res, 200, { fonts: fonts.list() });
  if (m === 'POST' && p === '/api/fonts') {
    const b = await json(req);
    const added = await fonts.addFromEmbed(b.code);
    return send(res, 200, { added, fonts: fonts.list() });
  }
  if ((mm = p.match(/^\/api\/fonts\/([\w.-]+)$/)) && m === 'DELETE') {
    fonts.remove(mm[1]);
    return send(res, 200, { fonts: fonts.list() });
  }
  if (m === 'GET' && p === '/api/google/status') return send(res, 200, { keys: llm.keyStatus() });
  // amostra da voz de narração (gasta um pouquinho da cota do Google)
  if (m === 'POST' && p === '/api/voice/preview') {
    const b = await json(req);
    const text = String(b.text || 'Olá! Esta é a voz que vai narrar os vídeos deste perfil.').slice(0, 300);
    const pcm = await llm.tts(text, b.voice || 'Kore', String(b.style || '').slice(0, 500));
    return send(res, 200, llm.pcmToWav(pcm), { 'Content-Type': 'audio/wav' });
  }
  if ((mm = p.match(/^\/api\/profiles\/([\w-]+)\/reference$/)) && m === 'POST') {
    const b = await json(req);
    const prof = config.getProfile(mm[1]);
    if (!prof) return send(res, 404, { error: 'perfil não encontrado' });
    if (!b.dataUrl) {
      prof.referenceImage = '';
      prof.styleAnalysis = '';
      config.save();
      return send(res, 200, { ok: true });
    }
    const match = String(b.dataUrl).match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
    if (!match) return send(res, 400, { error: 'Envie uma imagem PNG, JPG ou WEBP' });
    const name = `${prof.id}_${uid()}.${match[1].replace('jpeg', 'jpg')}`;
    fs.writeFileSync(path.join(jobs.REFS_DIR, name), Buffer.from(match[2], 'base64'));
    prof.referenceImage = name;
    prof.styleAnalysis = '';
    config.save();
    try {
      const st = await llm.analyzeStyle(path.join(jobs.REFS_DIR, name));
      prof.styleAnalysis = (st.style_prompt || '') + (st.mood ? ` (clima: ${st.mood})` : '');
      config.save();
      return send(res, 200, { ok: true, analysis: prof.styleAnalysis, palette: st.palette || [] });
    } catch (e) {
      return send(res, 200, { ok: true, analysis: '', warning: 'Imagem salva. A análise do estilo será feita depois: ' + e.message });
    }
  }
  if (m === 'POST' && p === '/api/jobs') {
    const b = await json(req);
    return send(res, 200, { job: jobs.enqueue({ profileId: b.profileId, type: b.type || 'video', topic: b.topic || '', reason: 'manual (página)' }) });
  }
  if ((mm = p.match(/^\/api\/jobs\/([\w-]+)\/(approve|retry)$/)) && m === 'POST') {
    return send(res, 200, { job: mm[2] === 'approve' ? jobs.approve(mm[1]) : jobs.retry(mm[1]) });
  }
  if ((mm = p.match(/^\/api\/jobs\/([\w-]+)$/)) && m === 'DELETE') {
    jobs.remove(mm[1]);
    return send(res, 200, { ok: true });
  }
  if ((mm = p.match(/^\/api\/youtube\/auth\/([\w-]+)$/)) && m === 'GET') return send(res, 200, { url: youtube.authUrl(mm[1]) });
  if (m === 'POST' && p === '/api/youtube/code') {
    const b = await json(req);
    let code = String(b.code || '').trim();
    let profileId = b.profileId;
    if (/^https?:\/\//.test(code)) {
      const u = new URL(code);
      profileId = u.searchParams.get('state') || profileId;
      code = u.searchParams.get('code');
    }
    const prof = await youtube.exchangeCode(profileId, code);
    return send(res, 200, { ok: true, channel: prof.youtube.channelTitle });
  }
  if (m === 'POST' && p === '/api/instagram/test') {
    const b = await json(req);
    const prof = config.getProfile(b.profileId);
    return send(res, 200, await instagram.accountStats(prof));
  }
  if (m === 'POST' && p === '/api/nara/command') {
    const b = await json(req);
    return send(res, 200, await nara.command(b.text));
  }
  if (m === 'POST' && p === '/api/nara/briefing') return send(res, 200, { reply: await nara.briefing() });
  if (m === 'POST' && p === '/api/stats/refresh') return send(res, 200, { stats: await analytics.snapshot() });
  if (m === 'POST' && p === '/api/test/keys') {
    const out = {};
    const s = config.load().settings;
    const t = async (name, ok, fn) => {
      if (!ok) return (out[name] = 'não configurada');
      try { await fn(); out[name] = 'ok ✅'; } catch (e) { out[name] = '❌ ' + (llm.claudeErrorMessage(e) || e.message).slice(0, 160); }
    };
    await t('DeepSeek (cérebro)', s.deepseekKey, () => llm.deepseekChat([{ role: 'user', content: 'Responda só: ok' }], { maxTokens: 5 }));
    await t(s.anthropicKey ? 'Claude (motor, chave API)' : 'Claude (motor, assinatura neste PC)', llm.claudeAvailable(), () => llm.claudeAsk('Responda curto.', 'Responda só: ok', { maxTokens: 2000 }));
    const gk = llm.googleKeys();
    if (!gk.length) out['Google (narração)'] = 'não configurada';
    for (let i = 0; i < gk.length; i++) {
      await t(`Google chave ${i + 1} (narração)`, true, async () => {
        const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': gk[i] } });
        if (!r.ok) throw new Error('chave inválida (' + r.status + ')');
      });
    }
    await t('Voz da Nara (grátis)', true, async () => { if (!(await voice.synth('Olá, eu sou a Nara.'))) throw new Error('sem voz — rode de novo o instalador'); });
    await t('Groq (ouvir o Atom)', s.groqKey, async () => { const r = await voice.transcribe(llm.pcmToWav(Buffer.alloc(32000))); if (r == null) throw new Error('sem chave'); });
    return send(res, 200, out);
  }
  if (m === 'POST' && p === '/api/nara/test-voice') {
    await nara.speak('Oi! Eu sou a Nara. Estou pronta para trabalhar.');
    return send(res, 200, { ok: true });
  }
  if (m === 'GET' && p === '/api/schedule/preview') {
    const prof = config.getProfile(url.searchParams.get('profileId'));
    return send(res, 200, { slots: prof ? scheduler.slotsFor(prof, nowInTz(config.load().settings.timezone).date) : [] });
  }
  return send(res, 404, { error: 'rota não encontrada' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    logger.error(`${req.method} ${req.url}:`, e.message);
    if (!res.headersSent) send(res, 500, { error: e.message });
  });
});

// ---------- tarefas diárias ----------
scheduler.daily('estatisticas-manha', '06:30', () => analytics.snapshot());
scheduler.daily('estatisticas-tarde', '14:30', () => analytics.snapshot(), 120);
scheduler.daily('estatisticas-noite', '23:45', () => analytics.snapshot(), 14);
scheduler.daily('limpeza', '03:10', () => jobs.cleanup());
scheduler.daily('token-instagram', '04:20', async () => {
  for (const prof of config.load().profiles) await instagram.refreshToken(prof);
});
scheduler.daily('briefing', () => config.load().settings.nara.briefingTime, () => nara.briefing(), 45);

process.on('uncaughtException', (e) => logger.error('Erro inesperado:', e));
process.on('unhandledRejection', (e) => logger.error('Promessa rejeitada:', e));

server.listen(PORT, '0.0.0.0', () => {
  const s = config.load().settings;
  logger.info('==============================================');
  logger.info(` NARA rodando na porta ${PORT}`);
  logger.info(` Neste PC:     http://localhost:${PORT}`);
  for (const a of lanAddresses()) logger.info(` Na rede:      http://${a}:${PORT}`);
  logger.info(` Senha da página: ${s.adminToken}`);
  logger.info(` Token do Atom S3R: ${s.deviceToken}`);
  logger.info('==============================================');
  scheduler.start();
  jobs.work();
  fonts.ensureDefaults();
  setTimeout(() => {
    const today = nowInTz(s.timezone).date;
    if (!analytics.all()[today] && config.load().profiles.length) analytics.snapshot().catch(() => {});
  }, 60000);
});
