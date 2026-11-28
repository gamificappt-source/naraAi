// Configuração global + perfis. Tudo fica em data/config.json
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, readJSON, writeJSON, uid } = require('./util');

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const DEFAULT_SETTINGS = {
  adminToken: '', // senha da página (gerada no 1º start)
  deviceToken: '', // senha do Atom S3R
  timezone: 'America/Sao_Paulo',
  deepseekKey: '', // CÉREBRO: conversa da Nara
  deepseekModel: 'deepseek-chat',
  anthropicKey: '', // MOTOR: roteiros, carrosséis, temas, análise de estilo
  claudeModel: 'claude-opus-5-5',
  claudeEffort: 'medium', // low | medium | high (mais alto = melhor e mais caro)
  googleKey: '', // (antiga) chave única do Google — continua valendo
  googleKeys: ['', '', '', '', ''], // até 5 chaves do Google AI Studio: se uma esgotar, usa a próxima
  geminiTtsModel: 'gemini-2.5-flash-preview-tts',
  groqKey: '', // opcional: entender a fala do Atom S3R (grátis)
  pexelsKey: '', // opcional: mais imagens/fotos grátis
  youtubeClientId: '',
  youtubeClientSecret: '',
  publicUrl: '', // ex.: http://100.x.x.x:8080 (Tailscale) — só informativo
  webTrends: true, // a Claude pesquisa na internet o que está em alta antes de escolher o tema
  paused: false, // pausa geral
  nara: {
    wakeWord: 'nara',
    voice: 'pt-BR-ThalitaMultilingualNeural', // voz grátis (Edge TTS)
    speakOnPhone: true, // fala pelas caixas de som do PC (nome antigo mantido)
    speakOnDevice: false, // manda áudio para o Atom (se tiver alto-falante)
    briefingTime: '', // ex.: 07:30 → briefing automático (vazio = só quando pedir)
    listenOnPhoneAfterWake: false, // (não usado no PC)
  },
  render: {
    quality: '1080', // 1080 ou 720
    fps: 30,
  },
};

const DEFAULT_PROFILE = () => ({
  id: uid('p_'),
  name: 'Novo perfil',
  enabled: true,
  niche: '',
  audience: '',
  language: 'pt-BR',
  tone: 'envolvente, curioso e direto',
  topics: [], // fila de temas que você quer (usados primeiro)
  avoid: '',
  // Vídeos
  videosPerDay: 1,
  carouselsPerDay: 0,
  imagesPerDay: 0,
  windowStart: '09:00',
  windowEnd: '21:00',
  customTimes: '', // "09:00, 18:30" sobrescreve a distribuição automática
  videoFormat: 'short', // short (9:16) | long (16:9)
  videoSeconds: 50, // duração de cada vídeo em segundos (a página mostra em minutos)
  videoStyle: '2d', // texto livre (ex.: "2D estilo investigação, traço grosso")
  imageSource: 'mix', // web | ai | mix
  videoPrompt: '', // o "prompt do vídeo" que você já usa hoje
  voice: 'Kore',
  voiceStyle: 'Fale em português do Brasil, com ritmo dinâmico e tom de narrador de documentário.',
  music: true,
  subtitle: {
    auto: true, // cores, tamanho e posição automáticos (só a fonte é escolhida)
    font: 'Anton Regular',
    size: 80,
    color: '#FFFFFF',
    highlight: '#FFD400',
    outline: '#000000',
    position: 'middle', // top | middle | bottom
    uppercase: true,
    wordsPerLine: 3,
  },
  palette: ['#0B0F1A', '#E63946', '#F1FAEE'],
  coverImage: '', // capa do perfil (biblioteca)
  logoImage: '', // logo do canal (chamada final dos vídeos)
  endCard: true, // mostra a logo no final do vídeo
  watermark: false, // logo pequena no canto durante o vídeo
  endCardText: 'Siga para mais!',
  referenceImage: '', // arquivo salvo em data/refs
  styleAnalysis: '', // descrição do estilo gerada pelo Gemini a partir da referência
  // Carrossel / imagem
  carouselSlides: 6,
  carouselPrompt: '',
  carouselFont: 'Poppins ExtraBold', // fonte dos títulos
  carouselBodyFont: 'Poppins Regular', // fonte do texto
  carouselReference: '', // imagem de referência só do carrossel
  carouselStyleAnalysis: '',
  // Legenda / post
  captionPrompt: 'Legenda curta, com gancho na primeira linha e chamada para seguir o perfil.',
  hashtags: '',
  autoPost: true, // false = fica aguardando sua aprovação na página
  days: [0, 1, 2, 3, 4, 5, 6], // dias da semana em que posta (0 = domingo)
  learnFromResults: true, // segue os assuntos que dão mais engajamento
  youtube: { enabled: false, privacy: 'public', categoryId: '24', madeForKids: false, rules: '', refreshToken: '', channelTitle: '', channelId: '' },
  instagram: { enabled: false, reels: true, carousels: true, images: true, shareToFeed: true, rules: '', userId: '', accessToken: '', username: '', tokenRefreshedAt: '' },
  boost: { extraVideos: 0, until: '' }, // "Nara, foca no perfil X"
});

let cache = null;

function load() {
  if (cache) return cache;
  const raw = readJSON(CONFIG_FILE, {});
  const settings = deepMerge(structuredClone(DEFAULT_SETTINGS), raw.settings || {});
  let changed = false;
  if (!settings.adminToken) {
    settings.adminToken = crypto.randomBytes(4).toString('hex');
    changed = true;
  }
  if (!settings.deviceToken) {
    settings.deviceToken = crypto.randomBytes(6).toString('hex');
    changed = true;
  }
  const profiles = (raw.profiles || []).map((p) => deepMerge(DEFAULT_PROFILE(), p));
  cache = { settings, profiles };
  if (changed) save();
  return cache;
}

function save() {
  writeJSON(CONFIG_FILE, cache);
}

function deepMerge(base, extra) {
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      deepMerge(base[k], v);
    } else if (v !== undefined) {
      base[k] = v;
    }
  }
  return base;
}

const SECRET_FIELDS = ['deepseekKey', 'anthropicKey', 'groqKey', 'googleKey', 'pexelsKey', 'youtubeClientSecret'];
function mask(v) {
  if (!v) return '';
  return v.length <= 8 ? '••••' : v.slice(0, 4) + '••••' + v.slice(-4);
}

/** Versão para enviar à página (segredos mascarados) */
function publicView() {
  const c = load();
  const s = structuredClone(c.settings);
  for (const f of SECRET_FIELDS) s[f] = mask(s[f]);
  s.googleKeys = (s.googleKeys || []).map(mask);
  delete s.adminToken;
  const profiles = c.profiles.map((p) => {
    const q = structuredClone(p);
    q.youtube.refreshToken = p.youtube.refreshToken ? 'conectado' : '';
    q.instagram.accessToken = mask(p.instagram.accessToken);
    return q;
  });
  return { settings: s, profiles };
}

/** Recebe alterações da página. Campos mascarados (com ••) são ignorados. */
function updateSettings(patch) {
  const c = load();
  for (const f of [...SECRET_FIELDS]) {
    if (typeof patch[f] === 'string' && patch[f].includes('••')) delete patch[f];
  }
  delete patch.adminToken;
  if (Array.isArray(patch.googleKeys)) {
    const old = c.settings.googleKeys || [];
    patch.googleKeys = patch.googleKeys.slice(0, 5).map((k, i) => (String(k || '').includes('••') ? old[i] || '' : String(k || '').trim()));
    while (patch.googleKeys.length < 5) patch.googleKeys.push('');
    c.settings.googleKeys = patch.googleKeys;
    delete patch.googleKeys;
  }
  if (patch.newAdminToken) {
    c.settings.adminToken = String(patch.newAdminToken).trim();
    delete patch.newAdminToken;
  }
  deepMerge(c.settings, patch);
  save();
}

function upsertProfile(p) {
  const c = load();
  if (p.instagram && typeof p.instagram.accessToken === 'string' && p.instagram.accessToken.includes('••')) delete p.instagram.accessToken;
  // token novo colado: a conta é descoberta de novo (a não ser que o ID tenha sido informado)
  if (p.instagram && typeof p.instagram.accessToken === 'string' && p.instagram.accessToken.trim()) {
    p.instagram.accessToken = p.instagram.accessToken.trim();
    if (!p.instagram.userId || !String(p.instagram.userId).trim()) p.instagram.userId = '';
    p.instagram.tokenRefreshedAt = '';
  }
  if (p.youtube) delete p.youtube.refreshToken; // só o OAuth altera
  let existing = c.profiles.find((x) => x.id === p.id);
  if (!existing) {
    existing = DEFAULT_PROFILE();
    if (p.id) existing.id = p.id;
    c.profiles.push(existing);
  }
  const oldRef = existing.referenceImage;
  const oldCar = existing.carouselReference;
  deepMerge(existing, p);
  if (Array.isArray(p.topics)) existing.topics = p.topics;
  if (Array.isArray(p.days)) existing.days = p.days.map(Number);
  if (existing.carouselReference !== oldCar) existing.carouselStyleAnalysis = '';
  if (Array.isArray(p.palette)) existing.palette = p.palette;
  if (existing.referenceImage !== oldRef) existing.styleAnalysis = '';
  save();
  return existing;
}

function deleteProfile(id) {
  const c = load();
  c.profiles = c.profiles.filter((p) => p.id !== id);
  save();
}

function getProfile(id) {
  return load().profiles.find((p) => p.id === id);
}

function findProfileByName(name) {
  if (!name) return null;
  const n = String(name).toLowerCase().replace(/^@/, '');
  const ps = load().profiles;
  return (
    ps.find((p) => p.id === name) ||
    ps.find((p) => p.name.toLowerCase() === n) ||
    ps.find((p) => p.name.toLowerCase().includes(n) || n.includes(p.name.toLowerCase())) ||
    ps.find((p) => (p.instagram.username || '').toLowerCase() === n)
  );
}

module.exports = { load, save, publicView, updateSettings, upsertProfile, deleteProfile, getProfile, findProfileByName, DEFAULT_PROFILE };
