// A "cabeça" da Nara: briefing do dia, entender pedidos e falar
const config = require('./config');
const llm = require('./ai/llm');
const voiceIO = require('./ai/voice');
const jobs = require('./jobs');
const scheduler = require('./scheduler');
const analytics = require('./analytics');
const { nowInTz, addDays, extractJSON, logger } = require('./util');
const { dateLine } = require('./ai/writer');

const conversation = [];
let lastAudio = null; // PCM 24kHz para o Atom S3R (se tiver alto-falante)
let lastReply = '';

function remember(role, text) {
  conversation.push({ role, text, at: new Date().toISOString() });
  if (conversation.length > 60) conversation.shift();
}

let speaking = Promise.resolve();
/** Fala com a voz da Nara (grátis): nas caixas de som do PC e/ou no Atom S3R */
async function speak(text) {
  lastReply = text;
  remember('nara', text);
  lastAudio = null;
  const s = config.load().settings.nara;
  let file = null;
  if (s.speakOnPhone || s.speakOnDevice) {
    try { file = await voiceIO.synth(text); } catch (e) { logger.warn('Voz:', e.message); }
  }
  if (s.speakOnDevice && file) lastAudio = await voiceIO.toPcm(file).catch(() => null);
  if (s.speakOnPhone) speaking = speaking.then(() => voiceIO.playOnPhone(file, text)).catch((e) => logger.warn('Alto-falante:', e.message));
  return text;
}

function scheduleText() {
  return scheduler.today().map((s) => `${s.time} ${s.profile} ${s.type} (${s.status})`).join('\n') || 'nada agendado';
}

async function briefing() {
  const c = config.load();
  const now = nowInTz(c.settings.timezone);
  const data = analytics.summary();
  const queue = jobs.list().filter((j) => ['queued', 'producing', 'awaiting_approval', 'publishing'].includes(j.status)).map((j) => `${j.profileName}: ${j.type} ${j.status}`);
  let text;
  try {
    text = await llm.brain(
      'Você é a Nara, assistente pessoal de redes sociais. Fala em português do Brasil, simpática, objetiva, frases curtas, sem emojis e sem markdown, pois o texto será falado em voz alta.',
      `Agora são ${now.time} de ${now.date}. Faça o briefing falado (máx. 130 palavras): cumprimente, diga como foi ontem (posts e desempenho), ` +
        `quais perfis ganharam ou perderam seguidores, problemas que precisam de atenção, e a agenda de hoje.\n\n` +
        `DADOS:\n${JSON.stringify(data)}\n\nAGENDA DE HOJE:\n${scheduleText()}\n\nFILA AGORA:\n${queue.join('\n') || 'vazia'}\n` +
        (c.settings.paused ? '\nATENÇÃO: as postagens estão PAUSADAS.' : ''),
      { maxTokens: 700 }
    );
  } catch (e) {
    text = `Bom dia! Não consegui falar com a inteligência artificial agora (${e.message.slice(0, 80)}). Hoje temos ${scheduler.today().length} conteúdos agendados.`;
  }
  return speak(text.replace(/[*#_`]/g, ''));
}

function profileOf(name) {
  const p = config.findProfileByName(name);
  if (!p) throw new Error(`não achei o perfil "${name}"`);
  return p;
}

// Campos de perfil que a Nara pode mudar conversando com você
const EDITABLE = {
  name: 'text', niche: 'text', audience: 'text', tone: 'text', avoid: 'text', language: 'text',
  videoPrompt: 'text', carouselPrompt: 'text', captionPrompt: 'text', hashtags: 'text', endCardText: 'text',
  voice: 'text', voiceStyle: 'text', videoStyle: 'text', videoFormat: 'text', imageSource: 'text',
  videoSeconds: 'num', videosPerDay: 'num', carouselsPerDay: 'num', imagesPerDay: 'num', carouselSlides: 'num',
  windowStart: 'text', windowEnd: 'text', customTimes: 'text', days: 'days',
  autoPost: 'bool', enabled: 'bool', music: 'bool', endCard: 'bool', watermark: 'bool', learnFromResults: 'bool',
  'youtube.enabled': 'bool', 'youtube.privacy': 'text', 'youtube.rules': 'text', 'youtube.madeForKids': 'bool',
  'instagram.enabled': 'bool', 'instagram.rules': 'text', 'instagram.reels': 'bool', 'instagram.carousels': 'bool', 'instagram.images': 'bool',
  'subtitle.font': 'text', 'subtitle.color': 'text', 'subtitle.highlight': 'text', 'subtitle.position': 'text', 'subtitle.wordsPerLine': 'num',
};
function applyFields(p, fields) {
  const changed = [];
  for (const [k, raw] of Object.entries(fields)) {
    const kind = EDITABLE[k];
    if (!kind) continue;
    let v = raw;
    if (kind === 'num') { v = Number(raw); if (!Number.isFinite(v)) continue; v = Math.max(0, Math.min(k === 'videoSeconds' ? 3600 : 50, v)); }
    if (kind === 'bool') v = raw === true || raw === 'true' || raw === 1 || raw === 'sim';
    if (kind === 'days') { if (!Array.isArray(raw)) continue; v = raw.map(Number).filter((d) => d >= 0 && d <= 6); }
    if (kind === 'text') v = String(raw ?? '').slice(0, 8000);
    const parts = k.split('.');
    let obj = p;
    for (const part of parts.slice(0, -1)) obj = obj[part] = obj[part] || {};
    obj[parts[parts.length - 1]] = v;
    changed.push(k);
  }
  return changed;
}

async function execute(a) {
  const c = config.load();
  const today = nowInTz(c.settings.timezone).date;
  switch (a.type) {
    case 'extra_post': {
      const p = profileOf(a.profile);
      const n = Math.min(5, Math.max(1, Number(a.count) || 1));
      for (let i = 0; i < n; i++) jobs.enqueue({ profileId: p.id, type: ['carousel', 'image'].includes(a.content) ? a.content : 'video', topic: a.topic || '', reason: 'pedido extra' });
      return `ok, ${n} extra para ${p.name}`;
    }
    case 'focus': {
      const p = profileOf(a.profile);
      p.boost = { extraVideos: Math.max(1, Number(a.extra) || 1), until: addDays(today, Math.max(1, Number(a.days) || 7) - 1) };
      config.save();
      return `foco em ${p.name} até ${p.boost.until}`;
    }
    case 'unfocus': {
      const p = profileOf(a.profile);
      p.boost = { extraVideos: 0, until: '' };
      config.save();
      return `foco removido de ${p.name}`;
    }
    case 'pause':
    case 'resume': {
      if (a.profile) {
        const p = profileOf(a.profile);
        p.enabled = a.type === 'resume';
      } else {
        c.settings.paused = a.type === 'pause';
        if (a.type === 'pause') jobs.pauseCurrent();
      }
      config.save();
      if (a.type === 'resume') setImmediate(jobs.work);
      return a.type;
    }
    case 'add_topic': {
      const p = profileOf(a.profile);
      p.topics.push(a.topic);
      config.save();
      return `tema anotado para ${p.name}`;
    }
    case 'set_count': {
      const p = profileOf(a.profile);
      const field = a.content === 'carousel' ? 'carouselsPerDay' : a.content === 'image' ? 'imagesPerDay' : 'videosPerDay';
      p[field] = Math.max(0, Math.min(20, Number(a.per_day) || 0));
      config.save();
      return `${field}=${p[field]} em ${p.name}`;
    }
    case 'update_profile': {
      const p = profileOf(a.profile);
      const changed = applyFields(p, a.fields || {});
      config.save();
      return changed.length ? `alterado em ${p.name}: ${changed.join(', ')}` : 'nada para alterar';
    }
    case 'create_profile': {
      if (!a.name) throw new Error('falta o nome do novo perfil');
      const p = config.upsertProfile({ name: String(a.name).slice(0, 60) });
      applyFields(p, a.fields || {});
      config.save();
      return `perfil ${p.name} criado`;
    }
    case 'refresh_stats':
      await analytics.snapshot();
      return 'estatísticas atualizadas';
    default:
      return '';
  }
}

/** Recebe uma frase (falada ou digitada) e age */
async function command(text) {
  text = String(text || '').trim();
  remember('voce', text);
  const s = config.load().settings;
  const clean = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s]/g, ' ').trim();
  const wake = (s.nara.wakeWord || 'nara').toLowerCase();
  const withoutWake = clean.replace(new RegExp(`^(ei |oi |ola )?${wake}\\b`), '').trim();
  if (!withoutWake || /^(bom dia|boa tarde|boa noite|tudo bem|oi|ola|briefing|resumo)( \w+)?$/.test(withoutWake)) {
    return { reply: await briefing(), actions: [{ type: 'briefing' }] };
  }
  const profiles = config.load().profiles.map((p) => ({
    nome: p.name, instagram: p.instagram.username, nicho: p.niche, publico: p.audience, tom: p.tone, ativo: p.enabled,
    videosPorDia: p.videosPerDay, carrosseisPorDia: p.carouselsPerDay, segundosPorVideo: p.videoSeconds, formato: p.videoFormat,
    voz: p.voice, tomDaVoz: p.voiceStyle, horario: `${p.windowStart}-${p.windowEnd}`, dias: p.days, postarSozinha: p.autoPost,
    youtube: p.youtube.enabled, instagramAtivo: p.instagram.enabled,
    promptDoVideo: (p.videoPrompt || '').slice(0, 300), promptDoCarrossel: (p.carouselPrompt || '').slice(0, 300),
  }));
  let plan;
  try {
    plan = extractJSON(await llm.brain(
      'Você é a Nara, assistente que gerencia perfis de YouTube e Instagram. Interprete o pedido do dono e devolva ações. Responda em português do Brasil, frases curtas, sem emojis (será falado).',
      `${dateLine()}\nPERFIS: ${JSON.stringify(profiles)}\nAGENDA HOJE:\n${scheduleText()}\nRESUMO: ${JSON.stringify(analytics.summary())}\n\n` +
        `PEDIDO: "${text}"\n\nAções possíveis (use o nome exato do perfil):\n` +
        '- {"type":"extra_post","profile":"...","content":"video|carousel|image","topic":"opcional","count":1}\n' +
        '- {"type":"focus","profile":"...","days":7,"extra":1}  (mais vídeos por dia nesse perfil)\n' +
        '- {"type":"unfocus","profile":"..."}\n' +
        '- {"type":"pause","profile":"... ou null para tudo"} / {"type":"resume","profile":"... ou null"}\n' +
        '- {"type":"add_topic","profile":"...","topic":"..."}\n' +
        '- {"type":"set_count","profile":"...","content":"video|carousel|image","per_day":2}\n' +
        '- {"type":"update_profile","profile":"...","fields":{"campo":"valor"}}  (mudar qualquer configuração do perfil)\n' +
        '- {"type":"create_profile","name":"...","fields":{...}}\n' +
        `  Campos possíveis: ${Object.keys(EDITABLE).join(', ')}. videoSeconds em segundos (ex.: 3 minutos = 180). ` +
        'days = dias da semana [0=domingo..6=sábado]. voice = uma voz do Google (Kore, Puck, Charon, Zephyr, Fenrir, Leda, Orus, Aoede...). ' +
        'Para mudar o prompt, mande o texto completo novo.\n' +
        '- {"type":"refresh_stats"}\n' +
        '- {"type":"briefing"}\n' +
        'Se for só uma pergunta, responda sem ações. JSON: {"actions":[...], "reply":"o que você vai falar para o dono"}',
      { json: true, maxTokens: 900 }
    ));
  } catch (e) {
    return { reply: await speak('Desculpa, não consegui entender agora. ' + e.message.slice(0, 80)), actions: [] };
  }
  const results = [];
  for (const a of plan.actions || []) {
    if (a.type === 'briefing') return { reply: await briefing(), actions: plan.actions };
    try {
      results.push(await execute(a));
    } catch (e) {
      results.push('erro: ' + e.message);
    }
  }
  const errors = results.filter((r) => r.startsWith('erro'));
  const reply = (plan.reply || 'Feito.') + (errors.length ? ' Mas tive um problema: ' + errors.join('; ') : '');
  return { reply: await speak(reply), actions: plan.actions || [], results };
}

/**
 * Ouviu o nome dela? Aceita o nome em qualquer lugar da frase e, no COMEÇO da frase,
 * também as trocas mais comuns do reconhecimento de voz (Narra, Nala, Lara, Nana…).
 */
function hasWakeWord(text) {
  const wake = (config.load().settings.nara.wakeWord || 'nara').toLowerCase();
  const norm = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (new RegExp(`\\b${wake}\\b`).test(norm)) return true;
  const first = norm.split(' ').filter((w) => !['e', 'ei', 'oi', 'ola', 'a', 'o', 'hey'].includes(w)).slice(0, 2);
  const similar = wake === 'nara' ? ['narra', 'nara', 'naara', 'nala', 'lara', 'nana', 'narah', 'naira', 'nera', 'mara'] : [wake];
  return first.some((w) => similar.includes(w));
}

/** Áudio do Atom S3R → texto → comando (na escuta contínua só reage se ouvir "Nara") */
async function voice(wav, { requireWake = true } = {}) {
  let text;
  try {
    text = await voiceIO.transcribe(wav);
  } catch (e) {
    logger.warn('Transcrição:', e.message);
    text = null;
  }
  if (text == null) {
    // sem chave Groq a Nara não consegue entender o áudio do Atom
    if (!requireWake) return { heard: '', reply: await speak('Para eu te ouvir pelo Atom, coloque a chave da Groq na página, em Ajustes.') };
    return { heard: '', reply: '' };
  }
  logger.info('Ouvi:', text);
  if (!text || /^\W*$/.test(text)) return { heard: '', reply: '' };
  if (requireWake && !hasWakeWord(text)) return { heard: text, reply: '' };
  const r = await command(text);
  return { heard: text, ...r };
}

async function wake() {
  return { reply: await briefing() };
}

module.exports = {
  briefing, command, voice, wake, speak,
  conversation: () => conversation,
  lastAudio: () => lastAudio,
  lastReply: () => lastReply,
};
