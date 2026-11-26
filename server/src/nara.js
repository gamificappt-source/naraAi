// A "cabeça" da Nara: briefing do dia, entender pedidos e falar
const config = require('./config');
const llm = require('./ai/llm');
const jobs = require('./jobs');
const scheduler = require('./scheduler');
const analytics = require('./analytics');
const { run, commandExists, nowInTz, addDays, logger } = require('./util');

const conversation = [];
let lastAudio = null; // PCM 24kHz para o Atom S3R (se tiver alto-falante)
let lastReply = '';

function remember(role, text) {
  conversation.push({ role, text, at: new Date().toISOString() });
  if (conversation.length > 60) conversation.shift();
}

let speaking = Promise.resolve();
async function speak(text) {
  lastReply = text;
  remember('nara', text);
  const s = config.load().settings.nara;
  if (s.speakOnPhone && (await commandExists('termux-tts-speak'))) {
    speaking = speaking.then(() => run('termux-tts-speak', ['-l', 'pt', '-r', '1.05', text]).catch((e) => logger.warn('TTS celular:', e.message)));
  }
  lastAudio = null;
  if (s.speakOnDevice) {
    try {
      lastAudio = await llm.tts(text, s.deviceVoice || 'Kore', 'Fale de forma natural e simpática, em português do Brasil.');
    } catch (e) {
      logger.warn('TTS para o dispositivo falhou:', e.message);
    }
  }
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
    text = await llm.ask(
      'Você é a Nara, assistente pessoal de redes sociais. Fala em português do Brasil, simpática, objetiva, frases curtas, sem emojis e sem markdown, pois o texto será falado em voz alta.',
      `Agora são ${now.time} de ${now.date}. Faça o briefing falado (máx. 130 palavras): cumprimente, diga como foi ontem (posts e desempenho), ` +
        `quais perfis ganharam ou perderam seguidores, problemas que precisam de atenção, e a agenda de hoje.\n\n` +
        `DADOS:\n${JSON.stringify(data)}\n\nAGENDA DE HOJE:\n${scheduleText()}\n\nFILA AGORA:\n${queue.join('\n') || 'vazia'}\n` +
        (c.settings.paused ? '\nATENÇÃO: as postagens estão PAUSADAS.' : ''),
      { temperature: 0.7, maxTokens: 600 }
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
      } else c.settings.paused = a.type === 'pause';
      config.save();
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
  const profiles = config.load().profiles.map((p) => ({ nome: p.name, instagram: p.instagram.username, nicho: p.niche, videosPorDia: p.videosPerDay, ativo: p.enabled }));
  let plan;
  try {
    plan = await llm.askJSON(
      'Você é a Nara, assistente que gerencia perfis de YouTube e Instagram. Interprete o pedido do dono e devolva ações. Responda em português do Brasil, frases curtas, sem emojis (será falado).',
      `PERFIS: ${JSON.stringify(profiles)}\nAGENDA HOJE:\n${scheduleText()}\nRESUMO: ${JSON.stringify(analytics.summary())}\n\n` +
        `PEDIDO: "${text}"\n\nAções possíveis (use o nome exato do perfil):\n` +
        '- {"type":"extra_post","profile":"...","content":"video|carousel|image","topic":"opcional","count":1}\n' +
        '- {"type":"focus","profile":"...","days":7,"extra":1}  (mais vídeos por dia nesse perfil)\n' +
        '- {"type":"unfocus","profile":"..."}\n' +
        '- {"type":"pause","profile":"... ou null para tudo"} / {"type":"resume","profile":"... ou null"}\n' +
        '- {"type":"add_topic","profile":"...","topic":"..."}\n' +
        '- {"type":"set_count","profile":"...","content":"video|carousel|image","per_day":2}\n' +
        '- {"type":"refresh_stats"}\n' +
        '- {"type":"briefing"}\n' +
        'Se for só uma pergunta, responda sem ações. JSON: {"actions":[...], "reply":"o que você vai falar para o dono"}',
      { temperature: 0.3, maxTokens: 800 }
    );
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

/** Áudio do Atom S3R → texto → comando (só reage se ouvir a palavra "Nara") */
async function voice(wav, { requireWake = true } = {}) {
  const text = await llm.transcribe(wav);
  logger.info('Ouvi:', text);
  if (!text || /\[silencio\]/i.test(text)) return { heard: '', reply: '' };
  const wake = (config.load().settings.nara.wakeWord || 'nara').toLowerCase();
  const norm = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (requireWake && !norm.includes(wake)) return { heard: text, reply: '' };
  const r = await command(text);
  return { heard: text, ...r };
}

/** Usa o microfone do próprio celular (Termux:API) para ouvir um pedido */
async function listenOnPhone() {
  if (!(await commandExists('termux-speech-to-text'))) return null;
  try {
    const out = await run('termux-speech-to-text', []);
    const text = out.trim().split('\n').pop();
    return text ? command(text) : null;
  } catch (e) {
    logger.warn('Microfone do celular:', e.message);
    return null;
  }
}

async function wake() {
  const reply = await briefing();
  if (config.load().settings.nara.listenOnPhoneAfterWake) {
    speaking.then(() => listenOnPhone());
  }
  return { reply };
}

module.exports = {
  briefing, command, voice, wake, speak, listenOnPhone,
  conversation: () => conversation,
  lastAudio: () => lastAudio,
  lastReply: () => lastReply,
};
