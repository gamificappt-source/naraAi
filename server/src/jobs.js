// Fila de produção: cria roteiro → narração → imagens → vídeo/carrossel → posta
const fs = require('fs');
const path = require('path');
const config = require('./config');
const llm = require('./ai/llm');
const writer = require('./ai/writer');
const images = require('./media/images');
const render = require('./media/render');
const youtube = require('./publish/youtube');
const instagram = require('./publish/instagram');
const { DATA_DIR, ensureDir, readJSON, writeJSON, uid, logger } = require('./util');

const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const JOBS_DIR = ensureDir(path.join(DATA_DIR, 'jobs'));
const REFS_DIR = ensureDir(path.join(DATA_DIR, 'refs'));

let jobs = readJSON(JOBS_FILE, []);
// se o PC reiniciou no meio de uma produção, recomeça
for (const j of jobs) if (j.status === 'producing' || j.status === 'publishing') j.status = j.files && j.files.length && j.status === 'publishing' ? 'ready' : 'queued';
let busy = false;

function persist() {
  if (jobs.length > 400) jobs = jobs.slice(-400);
  writeJSON(JOBS_FILE, jobs);
}
function list() {
  return jobs;
}
function get(id) {
  return jobs.find((j) => j.id === id);
}

function enqueue({ profileId, type = 'video', topic = '', reason = 'agenda', slotKey = '' }) {
  const p = config.getProfile(profileId);
  if (!p) throw new Error('Perfil não encontrado');
  const job = {
    id: uid('j_'), profileId, profileName: p.name, type, topic, reason, slotKey,
    status: 'queued', createdAt: new Date().toISOString(), steps: [], files: [], results: {},
  };
  jobs.push(job);
  persist();
  logger.info(`Novo trabalho: ${type} para ${p.name} (${reason})`);
  setImmediate(work);
  return job;
}

function step(job, msg) {
  job.steps.push(`${new Date().toLocaleTimeString('pt-BR')} ${msg}`);
  job.updatedAt = new Date().toISOString();
  persist();
  logger.info(`[${job.profileName}] ${msg}`);
}

async function ensureStyle(p) {
  for (const [img, field] of [['referenceImage', 'styleAnalysis'], ['carouselReference', 'carouselStyleAnalysis']]) {
    if (!p[img] || p[field]) continue;
    const file = path.join(REFS_DIR, p[img]);
    if (!fs.existsSync(file)) continue;
    try {
      const st = await llm.analyzeStyle(file);
      p[field] = (st.style_prompt || '') + (st.mood ? ` (clima: ${st.mood})` : '');
      if (field === 'styleAnalysis' && (!p.palette || !p.palette.length) && Array.isArray(st.palette)) p.palette = st.palette.slice(0, 3);
      config.save();
      logger.info(`Estilo da referência (${img}) analisado para ${p.name}`);
    } catch (e) {
      logger.warn('Não consegui analisar a imagem de referência:', e.message);
    }
  }
}

/** Posts deste perfil com métricas (últimos 60 dias) — a IA segue o que engaja mais */
function performance(profileId) {
  const since = Date.now() - 60 * 86400000;
  return jobs
    .filter((j) => j.profileId === profileId && j.status === 'done' && j.metrics && j.postedAt && new Date(j.postedAt).getTime() > since)
    .map((j) => ({ title: j.title, topic: j.topic, type: j.type, metrics: j.metrics }));
}

function history() {
  return jobs.filter((j) => j.title).map((j) => ({ profileId: j.profileId, title: j.title }));
}

function captionFor(p, script) {
  const tags = [...(script.hashtags || []), ...String(p.hashtags || '').split(/[\s,]+/)]
    .map((t) => t.trim()).filter(Boolean).map((t) => (t.startsWith('#') ? t : '#' + t));
  const uniq = [...new Set(tags)].slice(0, 15);
  return `${script.caption || script.title}\n\n${uniq.join(' ')}`.slice(0, 2200);
}

async function produceVideo(job, p) {
  const dir = ensureDir(path.join(JOBS_DIR, job.id));
  step(job, 'Escrevendo roteiro…');
  const script = await writer.videoScript(p, job.topic);
  job.title = script.title;
  job.script = script;
  const scenes = (script.scenes || []).filter((s) => s.text);
  if (!scenes.length) throw new Error('Roteiro veio sem cenas');
  const narration = scenes.map((s) => s.text.trim()).join(' ');

  step(job, 'Gerando narração (Google)…');
  const pcm = await llm.tts(narration, p.voice, p.voiceStyle);
  const audio = path.join(dir, 'narracao.wav');
  fs.writeFileSync(audio, llm.pcmToWav(pcm));

  step(job, `Buscando ${scenes.length} imagens…`);
  const orientation = p.videoFormat === 'long' ? 'landscape' : 'portrait';
  for (let i = 0; i < scenes.length; i++) {
    scenes[i].image = await images.getImage({
      search: scenes[i].search, visual: scenes[i].visual, styleHint: p.styleAnalysis || writer.STYLE_LABEL[p.videoStyle],
      source: p.imageSource, orientation, dest: path.join(dir, `img_${String(i).padStart(2, '0')}.jpg`), index: i,
    });
  }

  step(job, 'Montando o vídeo (ffmpeg)…');
  const logo = p.logoImage && fs.existsSync(path.join(REFS_DIR, p.logoImage)) ? path.join(REFS_DIR, p.logoImage) : null;
  const file = await render.renderVideo({ dir, scenes, audio, narration, profile: p, logo });
  job.files = [path.relative(DATA_DIR, file)];
  job.caption = captionFor(p, script);
  job.description = `${script.description || ''}\n\n${(script.hashtags || []).join(' ')}`;
}

async function produceImages(job, p) {
  const dir = ensureDir(path.join(JOBS_DIR, job.id));
  const n = job.type === 'image' ? 1 : Math.min(10, Math.max(2, Number(p.carouselSlides) || 6));
  step(job, job.type === 'image' ? 'Escrevendo post…' : `Escrevendo carrossel (${n} slides)…`);
  const c = await writer.carouselContent(p, job.topic, n);
  job.title = c.title || (c.slides && c.slides[0] && c.slides[0].headline);
  job.script = c;
  const slides = (c.slides || []).slice(0, n);
  if (!slides.length) throw new Error('Conteúdo veio sem slides');
  const files = [];
  for (let i = 0; i < slides.length; i++) {
    step(job, `Criando imagem ${i + 1}/${slides.length}…`);
    const img = await images.getImage({
      search: slides[i].search, visual: slides[i].visual, styleHint: p.carouselStyleAnalysis || p.styleAnalysis || writer.STYLE_LABEL[p.videoStyle],
      source: p.imageSource, orientation: 'portrait', dest: path.join(dir, `bg_${i}.jpg`), index: i,
    });
    files.push(await render.renderSlide({ dir, index: i, total: slides.length, slide: slides[i], image: img, profile: p, handle: p.instagram.username }));
  }
  job.files = files.map((f) => path.relative(DATA_DIR, f));
  job.caption = captionFor(p, c);
}

async function publishJob(job) {
  const p = config.getProfile(job.profileId);
  if (!p) throw new Error('Perfil apagado');
  job.status = 'publishing';
  persist();
  const files = job.files.map((f) => path.join(DATA_DIR, f));
  const errors = [];
  if (job.type === 'video') {
    if (p.youtube.enabled && p.youtube.refreshToken && !job.results.youtube) {
      try {
        step(job, 'Postando no YouTube…');
        job.results.youtube = await youtube.uploadVideo(p, files[0], { title: job.title, description: job.description, tags: job.script.hashtags || [] });
      } catch (e) { errors.push('YouTube: ' + e.message); }
    }
    if (p.instagram.enabled && p.instagram.reels !== false && !job.results.instagram) {
      try {
        step(job, 'Postando Reels no Instagram…');
        job.results.instagram = await instagram.postReel(p, files[0], job.caption);
      } catch (e) { errors.push('Instagram: ' + e.message); }
    }
  } else if (p.instagram.enabled && p.instagram[job.type === 'image' ? 'images' : 'carousels'] !== false && !job.results.instagram) {
    try {
      step(job, 'Postando no Instagram…');
      job.results.instagram = await instagram.postImages(p, files, job.caption);
    } catch (e) { errors.push('Instagram: ' + e.message); }
  }
  const posted = Object.keys(job.results).length;
  if (!posted && !errors.length) errors.push('Nenhuma rede ativada/conectada para este perfil — o conteúdo ficou salvo');
  job.error = errors.join(' | ');
  job.status = posted ? 'done' : 'failed';
  job.postedAt = posted ? new Date().toISOString() : undefined;
  step(job, posted ? 'Publicado ✅' + (errors.length ? ' (com avisos)' : '') : 'Falhou ao publicar ❌');
}

async function runJob(job) {
  const p = config.getProfile(job.profileId);
  if (!p) {
    job.status = 'failed';
    job.error = 'Perfil apagado';
    return;
  }
  job.status = 'producing';
  job.error = '';
  persist();
  await ensureStyle(p);
  if (!job.topic) {
    if (p.topics && p.topics.length) {
      job.topic = p.topics.shift();
      config.save();
    } else {
      step(job, 'Pesquisando tema…');
      job.topic = await writer.pickTopic(p, history(), job.type === 'video' ? 'video' : 'carousel', performance(p.id));
    }
  }
  step(job, 'Tema: ' + job.topic);
  if (job.type === 'video') await produceVideo(job, p);
  else await produceImages(job, p);

  if (p.autoPost) await publishJob(job);
  else {
    job.status = 'awaiting_approval';
    step(job, 'Pronto! Aguardando sua aprovação na página.');
  }
}

async function work() {
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      const job = jobs.find((j) => j.status === 'queued' || j.status === 'ready');
      if (!job) break;
      try {
        if (job.status === 'ready') await publishJob(job);
        else await runJob(job);
      } catch (e) {
        job.status = 'failed';
        job.error = e.message;
        step(job, 'Erro: ' + e.message);
        logger.error(e);
      }
      persist();
    }
  } finally {
    busy = false;
  }
}

function approve(id) {
  const j = get(id);
  if (!j) throw new Error('Trabalho não encontrado');
  j.status = 'ready';
  persist();
  setImmediate(work);
  return j;
}
function retry(id) {
  const j = get(id);
  if (!j) throw new Error('Trabalho não encontrado');
  j.status = j.files && j.files.length ? 'ready' : 'queued';
  persist();
  setImmediate(work);
  return j;
}
function remove(id) {
  const j = get(id);
  if (!j) return;
  fs.rmSync(path.join(JOBS_DIR, id), { recursive: true, force: true });
  jobs = jobs.filter((x) => x.id !== id);
  persist();
}

/** Apaga arquivos de vídeos já postados com mais de 5 dias (para não lotar o disco) */
function cleanup() {
  const limit = Date.now() - 5 * 86400000;
  for (const j of jobs) {
    if ((j.status === 'done' || j.status === 'failed') && new Date(j.createdAt).getTime() < limit && j.files && j.files.length) {
      fs.rmSync(path.join(JOBS_DIR, j.id), { recursive: true, force: true });
      j.files = [];
    }
  }
  persist();
}

module.exports = { performance, enqueue, list, get, approve, retry, remove, work, cleanup, persist, REFS_DIR, isBusy: () => busy };
