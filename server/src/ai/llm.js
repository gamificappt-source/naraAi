// Texto: DeepSeek (principal) com Gemini como reserva. Também visão, voz (TTS) e transcrição pelo Gemini.
const fs = require('fs');
const config = require('../config');
const { fetchRetry, extractJSON, logger } = require('../util');

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';

async function deepseekChat(messages, { json = false, temperature = 1.0, maxTokens = 4000 } = {}) {
  const s = config.load().settings;
  if (!s.deepseekKey) throw new Error('Chave do DeepSeek não configurada');
  const res = await fetchRetry('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.deepseekKey}` },
    body: JSON.stringify({
      model: s.deepseekModel || 'deepseek-chat',
      messages,
      temperature,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  }, { timeoutMs: 180000 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data.choices[0].message.content;
}

async function geminiGenerate(parts, { json = false, temperature = 1.0, model, system } = {}) {
  const s = config.load().settings;
  if (!s.googleKey) throw new Error('Chave do Google (Gemini) não configurada');
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const res = await fetchRetry(`${GEMINI}/${model || s.geminiTextModel}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': s.googleKey },
    body: JSON.stringify(body),
  }, { timeoutMs: 180000 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  const cand = data.candidates && data.candidates[0];
  const text = cand && cand.content && cand.content.parts ? cand.content.parts.map((p) => p.text || '').join('') : '';
  if (!text) throw new Error('Gemini não devolveu texto: ' + JSON.stringify(data).slice(0, 300));
  return text;
}

/** Pergunta ao modelo de texto. Usa DeepSeek; se falhar ou não houver chave, usa Gemini. */
async function ask(system, user, opts = {}) {
  const s = config.load().settings;
  if (s.deepseekKey) {
    try {
      return await deepseekChat([{ role: 'system', content: system }, { role: 'user', content: user }], opts);
    } catch (e) {
      logger.warn('DeepSeek falhou, tentando Gemini:', e.message);
      if (!s.googleKey) throw e;
    }
  }
  return geminiGenerate([{ text: user }], { ...opts, system });
}

async function askJSON(system, user, opts = {}) {
  const txt = await ask(system + '\nResponda SOMENTE com JSON válido.', user, { ...opts, json: true });
  return extractJSON(txt);
}

/** Descreve o estilo visual de uma imagem de referência */
async function analyzeStyle(imagePath) {
  const b64 = fs.readFileSync(imagePath).toString('base64');
  const mime = imagePath.endsWith('.png') ? 'image/png' : imagePath.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  const txt = await geminiGenerate([
    { inlineData: { mimeType: mime, data: b64 } },
    {
      text:
        'Você é diretor de arte. Analise esta imagem de referência e responda em JSON: ' +
        '{"style_prompt": "descrição em INGLÊS, 1 parágrafo, do estilo visual para usar como prompt de geração de imagens (técnica, traço, iluminação, textura, enquadramento, clima)", ' +
        '"palette": ["#hex1","#hex2","#hex3","#hex4"], "mood": "clima em português", "is_2d": true/false}',
    },
  ], { json: true, temperature: 0.4 });
  return extractJSON(txt);
}

/** Texto → áudio WAV (Gemini TTS). Retorna Buffer PCM 16-bit 24kHz mono. */
async function tts(text, voice = 'Kore', styleInstruction = '') {
  const s = config.load().settings;
  if (!s.googleKey) throw new Error('Chave do Google não configurada (necessária para a narração)');
  const chunks = splitText(text, 3500);
  const pcms = [];
  for (const chunk of chunks) {
    const res = await fetchRetry(`${GEMINI}/${s.geminiTtsModel}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': s.googleKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: styleInstruction ? `${styleInstruction}\n\n${chunk}` : chunk }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || 'Kore' } } },
        },
      }),
    }, { timeoutMs: 300000, tries: 4 });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Gemini TTS ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) throw new Error('Gemini TTS não devolveu áudio');
    pcms.push(Buffer.from(part.inlineData.data, 'base64'));
  }
  return Buffer.concat(pcms);
}

function pcmToWav(pcm, sampleRate = 24000, channels = 1) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Áudio (wav) → texto */
async function transcribe(wavBuffer) {
  const txt = await geminiGenerate([
    { inlineData: { mimeType: 'audio/wav', data: wavBuffer.toString('base64') } },
    { text: 'Transcreva exatamente o que foi falado (português do Brasil). Se não houver fala, responda apenas: [silencio]' },
  ], { temperature: 0 });
  return txt.trim();
}

function splitText(text, max) {
  const out = [];
  let cur = '';
  for (const sentence of text.split(/(?<=[.!?…])\s+/)) {
    if ((cur + ' ' + sentence).length > max && cur) {
      out.push(cur.trim());
      cur = '';
    }
    cur += ' ' + sentence;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

module.exports = { ask, askJSON, deepseekChat, geminiGenerate, analyzeStyle, tts, pcmToWav, transcribe };
