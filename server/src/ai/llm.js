// Divisão de papéis:
//   CÉREBRO  (conversa da Nara: briefing, pedidos)  → DeepSeek   (reserva: Claude)
//   MOTOR    (temas, roteiros, carrosséis, estilo)  → Claude     (reserva: DeepSeek, só texto)
//   NARRAÇÃO dos vídeos                             → Google AI Studio (Gemini TTS)
//   Voz da própria Nara                             → ai/voice.js (grátis)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const sdk = require('@anthropic-ai/sdk');
const config = require('../config');
const { fetchRetry, extractJSON, logger } = require('../util');

const Anthropic = sdk.default || sdk;
let claudeClient = null;
let claudeKeyUsed = '';
function claude() {
  const key = config.load().settings.anthropicKey;
  if (!key) throw new Error('Chave da Claude (Anthropic) não configurada');
  if (!claudeClient || claudeKeyUsed !== key) {
    claudeClient = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 10 * 60 * 1000 });
    claudeKeyUsed = key;
  }
  return claudeClient;
}

// ---------------- DeepSeek ----------------
async function deepseekChat(messages, { json = false, maxTokens = 4000 } = {}) {
  const s = config.load().settings;
  if (!s.deepseekKey) throw new Error('Chave do DeepSeek não configurada');
  const res = await fetchRetry('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.deepseekKey}` },
    body: JSON.stringify({
      model: s.deepseekModel || 'deepseek-chat',
      messages,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  }, { timeoutMs: 180000 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data.choices[0].message.content;
}

// ---------------- Claude local (assinatura Pro/Max pelo Claude Code, sem chave de API) ----------------
// Usado quando não há chave da Anthropic. Precisa do Claude Code logado uma vez:  claude auth login
let cliCache = { at: 0, path: null };
function newestFile(paths) {
  return paths.filter((p) => fs.existsSync(p)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
}
function claudeLocalPath() {
  const s = config.load().settings;
  if (s.claudeLocal === false) return null;
  if (s.claudeCliPath && fs.existsSync(s.claudeCliPath)) return s.claudeCliPath;
  if (Date.now() - cliCache.at < 10 * 60 * 1000) return cliCache.path;
  const home = os.homedir();
  const found = [];
  if (process.platform === 'win32') {
    found.push(path.join(home, '.local', 'bin', 'claude.exe'));
    // binário que vem dentro do app Claude (atualiza sozinho, por isso pega o mais novo)
    const base = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Claude-Data');
    const ls = (d) => { try { return fs.readdirSync(d).map((x) => path.join(d, x)); } catch (_) { return []; } };
    for (const acc of ls(base)) for (const ver of ls(path.join(acc, 'claude-code'))) for (const h of ls(ver)) found.push(path.join(h, 'claude.exe'));
  } else {
    found.push(path.join(home, '.local', 'bin', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude');
  }
  cliCache = { at: Date.now(), path: newestFile(found) };
  return cliCache.path;
}

async function claudeLocalAsk(system, content) {
  const exe = claudeLocalPath();
  if (!exe) throw new Error('Claude Code não encontrado neste computador');
  const s = config.load().settings;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nara-claude-'));
  try {
    let prompt = '';
    let hasImage = false;
    if (typeof content === 'string') prompt = content;
    else {
      let n = 0;
      for (const b of content) {
        if (b.type === 'text') prompt += b.text + '\n';
        else if (b.type === 'image' && b.source && b.source.data) {
          const ext = (b.source.media_type || 'image/jpeg').split('/')[1].replace('jpeg', 'jpg');
          const name = `imagem${++n}.${ext}`;
          fs.writeFileSync(path.join(work, name), Buffer.from(b.source.data, 'base64'));
          prompt = `Abra e olhe a imagem ./${name} (use a ferramenta Read).\n` + prompt;
          hasImage = true;
        }
      }
    }
    const sysFile = path.join(work, 'system.txt');
    fs.writeFileSync(sysFile, system);
    const args = ['-p', '--output-format', 'json', '--model', s.claudeModel || 'claude-opus-5-5', '--system-prompt-file', sysFile,
      '--tools', hasImage ? 'Read' : '', '--max-turns', hasImage ? '4' : '2'];
    if (hasImage) args.push('--allowedTools', 'Read');
    // não herda o login de uma sessão do app (usa o login próprio do Claude Code)
    const env = {};
    for (const [k, v] of Object.entries(process.env)) if (!/^(CLAUDE|ANTHROPIC)/.test(k) && k !== 'CLAUDECODE') env[k] = v;
    const out = await new Promise((resolve, reject) => {
      const p = spawn(exe, args, { cwd: work, env, windowsHide: true });
      let so = '', se = '';
      const timer = setTimeout(() => { p.kill(); reject(new Error('Claude local demorou demais (15 min)')); }, 15 * 60 * 1000);
      p.stdout.on('data', (d) => (so += d));
      p.stderr.on('data', (d) => { se += d; if (se.length > 5000) se = se.slice(-5000); });
      p.on('error', (e) => { clearTimeout(timer); reject(e); });
      p.on('close', () => { clearTimeout(timer); resolve({ so, se }); });
      p.stdin.end(prompt);
    });
    let data;
    try { data = JSON.parse(out.so.trim().split('\n').pop()); } catch (_) {
      throw new Error('Claude local não respondeu: ' + (out.se || out.so).slice(-300));
    }
    if (data.is_error || data.subtype !== 'success') {
      const why = String(data.result || data.terminal_reason || data.subtype || '');
      if (/login|auth|401|credential/i.test(why) || data.terminal_reason === 'api_error') throw new Error('Claude local sem login ou com erro (' + why.slice(0, 120) + '). Rode uma vez: claude auth login');
      if (/limit|usage|429/i.test(why)) throw new Error('limite de uso da assinatura Claude atingido, tente mais tarde');
      throw new Error('Claude local: ' + why.slice(0, 200));
    }
    if (!data.result) throw new Error('Claude local não devolveu texto');
    return data.result;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Há alguma Claude disponível (chave de API ou Claude Code local)? */
function claudeAvailable() {
  return !!(config.load().settings.anthropicKey || claudeLocalPath());
}

// ---------------- Claude (API) ----------------
/** content: string ou blocos (texto/imagem). Devolve só o texto final. */
async function claudeAsk(system, content, { maxTokens = 16000 } = {}) {
  const s = config.load().settings;
  if (!s.anthropicKey) return claudeLocalAsk(system, content);
  const stream = claude().beta.messages.stream({
    model: s.claudeModel || 'claude-opus-5-5',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
    output_config: { effort: s.claudeEffort || 'medium' },
    // se o modelo principal recusar, a própria API tenta outro modelo automaticamente
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('Claude recusou este pedido (tema sensível). Tente outro tema.');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text) throw new Error('Claude não devolveu texto (stop_reason: ' + msg.stop_reason + ')');
  return text;
}

function claudeErrorMessage(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'chave da Claude inválida';
  if (e instanceof Anthropic.PermissionDeniedError) return 'chave da Claude sem permissão (confira créditos em Billing)';
  if (e instanceof Anthropic.RateLimitError) return 'limite de uso da Claude atingido, tente mais tarde';
  if (e instanceof Anthropic.APIConnectionError) return 'sem conexão com a Claude';
  if (e instanceof Anthropic.APIError) return `Claude ${e.status || ''}: ${e.message}`.slice(0, 300);
  return e.message;
}

// ---------------- papéis ----------------

/** CÉREBRO da Nara (conversa) — DeepSeek, com Claude de reserva */
async function brain(system, user, { json = false, maxTokens = 1500 } = {}) {
  const s = config.load().settings;
  if (s.deepseekKey) {
    try {
      return await deepseekChat([{ role: 'system', content: system + (json ? '\nResponda SOMENTE com JSON válido.' : '') }, { role: 'user', content: user }], { json, maxTokens });
    } catch (e) {
      logger.warn('DeepSeek falhou:', e.message);
      if (!claudeAvailable()) throw e;
    }
  }
  return claudeAsk(system + (json ? '\nResponda SOMENTE com JSON válido, sem texto antes ou depois.' : ''), user, { maxTokens: Math.max(maxTokens, 4000) });
}

/** MOTOR de conteúdo — Claude, com DeepSeek de reserva */
async function engineJSON(system, user, { maxTokens = 16000 } = {}) {
  const s = config.load().settings;
  const sys = system + '\nResponda SOMENTE com um objeto JSON válido, sem texto antes ou depois e sem ```.';
  if (claudeAvailable()) {
    try {
      return extractJSON(await claudeAsk(sys, user, { maxTokens }));
    } catch (e) {
      const msg = claudeErrorMessage(e);
      logger.warn('Claude falhou:', msg);
      if (!s.deepseekKey) throw new Error(msg);
    }
  }
  return extractJSON(await deepseekChat([{ role: 'system', content: sys }, { role: 'user', content: user }], { json: true, maxTokens: 8000 }));
}

/** Descreve o estilo visual da imagem de referência (Claude vê imagens) */
async function analyzeStyle(imagePath) {
  const b64 = fs.readFileSync(imagePath).toString('base64');
  const media = imagePath.endsWith('.png') ? 'image/png' : imagePath.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  const txt = await claudeAsk(
    'Você é diretor de arte. Responda SOMENTE com JSON válido.',
    [
      { type: 'image', source: { type: 'base64', media_type: media, data: b64 } },
      {
        type: 'text',
        text:
          'Analise esta imagem de referência e responda em JSON: ' +
          '{"style_prompt": "descrição em INGLÊS, 1 parágrafo, do estilo visual para usar como prompt de geração de imagens (técnica, traço, iluminação, textura, enquadramento, clima)", ' +
          '"palette": ["#hex1","#hex2","#hex3","#hex4"], "mood": "clima em português", "is_2d": true}',
      },
    ],
    { maxTokens: 4000 }
  );
  return extractJSON(txt);
}

// ---------------- Google: só narração dos vídeos ----------------
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Texto → PCM 16-bit 24kHz mono (Gemini TTS, versão grátis do AI Studio) */
async function tts(text, voice = 'Kore', styleInstruction = '') {
  const s = config.load().settings;
  if (!s.googleKey) throw new Error('Chave do Google AI Studio não configurada (usada para narrar os vídeos)');
  const pcms = [];
  for (const chunk of splitText(text, 3500)) {
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
    if (!res.ok) throw new Error(`Google TTS ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) throw new Error('Google TTS não devolveu áudio');
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

module.exports = { brain, engineJSON, claudeAsk, claudeAvailable, claudeLocalPath, deepseekChat, analyzeStyle, tts, pcmToWav, splitText, claudeErrorMessage };
