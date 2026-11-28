// Gera temas, roteiros de vídeo e textos de carrossel com base no perfil
const { engineJSON: askJSON } = require('./llm');
const config = require('../config');
const { nowInTz } = require('../util');

const STYLE_LABEL = {
  '2d': '2D ilustrado (flat / cartoon)',
  '3d': '3D renderizado (estilo Pixar/Blender)',
  realista: 'fotos realistas',
  documentario: 'documentário / investigação (fotos reais, arquivos, mapas, recortes de jornal)',
  anime: 'anime',
  minimalista: 'minimalista com tipografia forte',
};

function profileBrief(p) {
  return [
    `Perfil: ${p.name}`,
    p.niche && `Nicho/assunto: ${p.niche}`,
    p.audience && `Público: ${p.audience}`,
    `Idioma: ${p.language}`,
    `Tom: ${p.tone}`,
    p.avoid && `Evitar: ${p.avoid}`,
    p.youtube && p.youtube.enabled && p.youtube.rules && `Regras para o YouTube: ${p.youtube.rules}`,
    p.instagram && p.instagram.enabled && p.instagram.rules && `Regras para o Instagram: ${p.instagram.rules}`,
  ].filter(Boolean).join('\n');
}

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
/** A data de hoje (do relógio do PC), para a IA usar datas e atualidades corretas */
function dateLine() {
  const tz = config.load().settings.timezone;
  const n = nowInTz(tz);
  const wd = WEEKDAYS[new Date(n.date + 'T12:00:00Z').getUTCDay()];
  return `Data de hoje: ${n.date} (${wd}), ${n.time}, fuso ${tz}.`;
}

/** Texto com o que deu mais e menos engajamento neste perfil */
function performanceText(perf) {
  if (!perf || !perf.length) return '';
  const score = (m) => {
    let t = 0;
    for (const k of ['youtube', 'instagram']) if (m && m[k]) t += (m[k].views || 0) + 25 * (m[k].likes || 0) + 60 * (m[k].comments || 0);
    return t;
  };
  const rows = perf.map((j) => ({ t: j.title, s: score(j.metrics) })).filter((r) => r.t);
  if (rows.length < 2) return '';
  rows.sort((a, b) => b.s - a.s);
  const avg = rows.reduce((a, r) => a + r.s, 0) / rows.length;
  const fmt = (r) => `- "${r.t}" (pontuação ${r.s}, ${avg ? Math.round((r.s / avg) * 100) : 0}% da média)`;
  return [
    '',
    'DESEMPENHO DOS ÚLTIMOS POSTS (views + curtidas + comentários):',
    'MELHORES:',
    ...rows.slice(0, 6).map(fmt),
    'PIORES:',
    ...rows.slice(-5).reverse().map(fmt),
    'Regra: aposte em variações, continuações e assuntos parecidos com os MELHORES (mesma pegada, sem repetir o mesmo tema). ' +
      'Evite a linha dos PIORES. Se tudo estiver fraco, experimente um ângulo diferente, mas SEMPRE dentro do nicho do perfil.',
    '',
  ].join('\n');
}

async function pickTopic(profile, history, kind, perf = []) {
  const recent = history.filter((h) => h.profileId === profile.id).slice(-60).map((h) => '- ' + h.title).join('\n');
  const web = config.load().settings.webTrends !== false;
  const r = await askJSON(
    'Você é estrategista de conteúdo viral para redes sociais, ligado nas atualidades e no calendário.',
    [
      profileBrief(profile),
      dateLine(),
      web ? 'Pesquise na internet (WebSearch) notícias e assuntos em alta AGORA ligados ao nicho, e datas/aniversários de fatos próximos de hoje.' : '',
      profile.learnFromResults !== false ? performanceText(perf) : '',
      `Sugira 1 tema NOVO e específico para um ${kind === 'video' ? 'vídeo' : 'carrossel do Instagram'} com alto potencial de retenção e compartilhamento.`,
      'Use só fatos reais e verificáveis. Se houver uma data importante hoje ou nos próximos dias ligada ao nicho, aproveite.',
      'Não repita estes temas já publicados:',
      recent || '(nenhum ainda)',
      '',
      'JSON: {"topic": "tema em uma frase", "angle": "o gancho/ângulo", "why": "por que agora (curto)"}',
    ].filter((x) => x !== '').join('\n'),
    { temperature: 1.2, web }
  );
  return `${r.topic} — ${r.angle || ''}`.trim();
}

/**
 * Pesquisa um LOTE de temas de uma vez (economiza: 1 pesquisa serve para vários vídeos).
 * avoid = títulos/temas já publicados; queued = temas que já estão no banco.
 */
async function researchTopics(profile, avoid, queued, perf, n = 12, kinds = ['video']) {
  const web = config.load().settings.webTrends !== false;
  const nCats = Math.max(4, Math.ceil(n / 2));
  return askJSON(
    'Você é estrategista de conteúdo viral para redes sociais, ligado nas atualidades e no calendário. Responde só com JSON.',
    [
      profileBrief(profile),
      dateLine(),
      `Formatos que serão produzidos: ${kinds.map((k) => (k === 'video' ? 'vídeos' : 'carrosséis/posts')).join(' e ')}.`,
      web ? 'Faça UMA pesquisa rápida na internet (WebSearch) por notícias e assuntos em alta ligados ao nicho e por datas/aniversários de fatos nas próximas semanas. Não pesquise cada tema separadamente.' : '',
      profile.learnFromResults !== false ? performanceText(perf) : '',
      `Crie ${n} temas NOVOS e específicos (nome do caso/lugar/pessoa/data), com alto potencial de retenção e compartilhamento.`,
      `DIVERSIDADE OBRIGATÓRIA: espalhe em pelo menos ${nCats} categorias/subtemas diferentes dentro do nicho, no máximo 2 temas por categoria, `
        + 'e misture ~1/3 de atualidades/datas próximas com ~2/3 de temas atemporais. Nada de variações do mesmo caso.',
      'Use só fatos reais e verificáveis.',
      'JÁ PUBLICADOS (não repita e não faça variação próxima destes):',
      avoid.length ? avoid.map((t) => '- ' + t).join('\n') : '(nenhum ainda)',
      queued.length ? 'JÁ NA FILA (também não repita):\n' + queued.map((t) => '- ' + String(t).slice(0, 90)).join('\n') : '',
      '',
      'JSON: {"topics":[{"topic":"tema em uma frase","angle":"gancho/ângulo","category":"subtema curto (2-3 palavras)","why":"por que agora (curto)"}]}',
    ].filter((x) => x !== '').join('\n'),
    { temperature: 1.1, web, maxTokens: 6000 }
  );
}

async function videoScript(profile, topic) {
  const seconds = Number(profile.videoSeconds) || 50;
  const words = Math.round(seconds * 2.5);
  const scenes = Math.min(150, Math.max(4, Math.round(seconds / (seconds > 120 ? 7 : 5))));
  const style = STYLE_LABEL[profile.videoStyle] || profile.videoStyle;
  const long = profile.videoFormat === 'long';
  return askJSON(
    `Você é roteirista de vídeos ${long ? 'para YouTube' : 'curtos virais'} e diretor de arte. Escreve com fatos corretos, ganchos fortes e frases curtas fáceis de narrar.`,
    `${profileBrief(profile)}\n${dateLine()}\n\nTEMA: ${topic}\nFormato: ${long ? 'vídeo horizontal para YouTube' : 'vídeo vertical (Shorts/Reels)'}\n` +
      `Duração: ~${seconds}s (~${words} palavras de narração). Estilo visual: ${style}.\n` +
      (profile.styleAnalysis ? `Referência visual (siga este estilo): ${profile.styleAnalysis}\n` : '') +
      (profile.videoPrompt ? `\nPROMPT PADRÃO DO DONO DO PERFIL (siga à risca; só o assunto muda):\n${profile.videoPrompt}\n` : '') +
      `\nDivida em ${scenes} cenas. A 1ª frase precisa ser um gancho fortíssimo. Termine com chamada para seguir.\n` +
      'Para cada cena dê: "text" (o trecho EXATO da narração dessa cena), "search" (termos em INGLÊS para buscar uma FOTO REAL na internet, ex.: nome de lugar/pessoa/objeto), ' +
      '"visual" (prompt em INGLÊS descrevendo a imagem ideal para gerar por IA no estilo pedido, sem texto na imagem).\n' +
      'JSON: {"title": "título chamativo (máx 90 caracteres)", "description": "descrição do YouTube com 2-3 frases", "caption": "legenda do Instagram", ' +
      '"hashtags": ["#..."], "scenes": [{"text": "...", "search": "...", "visual": "..."}]}',
    { temperature: 1.0, maxTokens: Math.min(32000, Math.max(6000, words * 6)) }
  );
}

async function carouselContent(profile, topic, slides) {
  const style = STYLE_LABEL[profile.videoStyle] || profile.videoStyle;
  const ref = profile.carouselStyleAnalysis || profile.styleAnalysis;
  return askJSON(
    'Você cria carrosséis educativos e virais para Instagram, com frases curtas e impactantes.',
    `${profileBrief(profile)}\n${dateLine()}\n\nTEMA: ${topic}\nQuantidade de slides: ${slides}. Estilo visual: ${style}.\n` +
      (ref ? `Referência visual (siga este estilo): ${ref}\n` : '') +
      (profile.carouselPrompt ? `\nPROMPT PADRÃO DO CARROSSEL (siga à risca; só o assunto muda):\n${profile.carouselPrompt}\n` : '') +
      `\nSlide 1 = capa com gancho. Último slide = chamada para seguir/salvar. Título de cada slide até 8 palavras, corpo até 30 palavras.\n` +
      `Legenda: ${profile.captionPrompt}\n` +
      'JSON: {"title": "título interno", "caption": "legenda completa", "hashtags": ["#..."], ' +
      '"slides": [{"headline": "...", "body": "...", "search": "termos em inglês para foto real", "visual": "prompt em inglês para imagem por IA, sem texto"}]}',
    { temperature: 1.0, maxTokens: 4000 }
  );
}

module.exports = { dateLine, pickTopic, researchTopics, videoScript, carouselContent, profileBrief, STYLE_LABEL };
