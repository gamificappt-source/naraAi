// Gera roteiros de vídeo e textos de carrossel com base no perfil
const { engineJSON: askJSON } = require('./llm');

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
  ].filter(Boolean).join('\n');
}

async function pickTopic(profile, history, kind) {
  const recent = history.filter((h) => h.profileId === profile.id).slice(-40).map((h) => '- ' + h.title).join('\n');
  const r = await askJSON(
    'Você é estrategista de conteúdo viral para redes sociais.',
    `${profileBrief(profile)}\n\nSugira 1 tema NOVO e específico para um ${kind === 'video' ? 'vídeo' : 'carrossel do Instagram'} que tenha alto potencial de retenção e compartilhamento.\n` +
      `Pesquise mentalmente fatos reais e verificáveis. Não repita estes temas já publicados:\n${recent || '(nenhum ainda)'}\n\n` +
      'JSON: {"topic": "tema em uma frase", "angle": "o gancho/ângulo"}',
    { temperature: 1.2 }
  );
  return `${r.topic} — ${r.angle || ''}`.trim();
}

async function videoScript(profile, topic) {
  const seconds = Number(profile.videoSeconds) || 50;
  const words = Math.round(seconds * 2.5);
  const scenes = Math.max(4, Math.round(seconds / 5));
  const style = STYLE_LABEL[profile.videoStyle] || profile.videoStyle;
  return askJSON(
    'Você é roteirista de vídeos curtos virais e diretor de arte. Escreve com fatos corretos, ganchos fortes e frases curtas fáceis de narrar.',
    `${profileBrief(profile)}\n\nTEMA: ${topic}\nFormato: ${profile.videoFormat === 'long' ? 'vídeo horizontal para YouTube' : 'vídeo vertical (Shorts/Reels)'}\n` +
      `Duração: ~${seconds}s (~${words} palavras de narração). Estilo visual: ${style}.\n` +
      (profile.styleAnalysis ? `Referência visual (siga este estilo): ${profile.styleAnalysis}\n` : '') +
      (profile.videoPrompt ? `\nINSTRUÇÕES DO DONO DO PERFIL (siga à risca):\n${profile.videoPrompt}\n` : '') +
      `\nDivida em ${scenes} cenas. A 1ª frase precisa ser um gancho fortíssimo. Termine com chamada para seguir.\n` +
      'Para cada cena dê: "text" (o trecho EXATO da narração dessa cena), "search" (termos em INGLÊS para buscar uma FOTO REAL na internet, ex.: nome de lugar/pessoa/objeto), ' +
      '"visual" (prompt em INGLÊS descrevendo a imagem ideal para gerar por IA no estilo pedido, sem texto na imagem).\n' +
      'JSON: {"title": "título chamativo (máx 90 caracteres)", "description": "descrição do YouTube com 2-3 frases", "caption": "legenda do Instagram", ' +
      '"hashtags": ["#..."], "scenes": [{"text": "...", "search": "...", "visual": "..."}]}',
    { temperature: 1.0, maxTokens: 6000 }
  );
}

async function carouselContent(profile, topic, slides) {
  const style = STYLE_LABEL[profile.videoStyle] || profile.videoStyle;
  return askJSON(
    'Você cria carrosséis educativos e virais para Instagram, com frases curtas e impactantes.',
    `${profileBrief(profile)}\n\nTEMA: ${topic}\nQuantidade de slides: ${slides}. Estilo visual: ${style}.\n` +
      (profile.styleAnalysis ? `Referência visual: ${profile.styleAnalysis}\n` : '') +
      (profile.carouselPrompt ? `\nINSTRUÇÕES DO DONO DO PERFIL:\n${profile.carouselPrompt}\n` : '') +
      `\nSlide 1 = capa com gancho. Último slide = chamada para seguir/salvar. Título de cada slide até 8 palavras, corpo até 30 palavras.\n` +
      `Legenda: ${profile.captionPrompt}\n` +
      'JSON: {"title": "título interno", "caption": "legenda completa", "hashtags": ["#..."], ' +
      '"slides": [{"headline": "...", "body": "...", "search": "termos em inglês para foto real", "visual": "prompt em inglês para imagem por IA, sem texto"}]}',
    { temperature: 1.0, maxTokens: 4000 }
  );
}

module.exports = { pickTopic, videoScript, carouselContent, STYLE_LABEL };
