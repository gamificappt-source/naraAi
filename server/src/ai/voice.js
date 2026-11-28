// Voz da própria Nara (grátis) e transcrição do que você fala para o Atom S3R
//  Falar:  Microsoft Edge TTS (edge-tts, vozes neurais grátis) → Google Tradutor (reserva)
//  Ouvir:  Groq Whisper (grátis, com chave) — o que você fala para o Atom S3R
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { run, commandExists, fetchRetry, DATA_DIR, ensureDir, logger } = require('../util');

const VOICE_DIR = ensureDir(path.join(DATA_DIR, 'voice'));

// Vozes grátis da própria Nara (Edge TTS) que falam português do Brasil
const NARA_VOICES = [
  { name: 'pt-BR-ThalitaMultilingualNeural', label: 'Thalita', gender: 'Feminina', desc: 'Natural e expressiva' },
  { name: 'pt-BR-FranciscaNeural', label: 'Francisca', gender: 'Feminina', desc: 'Clara e calma' },
  { name: 'pt-BR-AntonioNeural', label: 'Antônio', gender: 'Masculina', desc: 'Firme e amigável' },
];

async function edgeTts(text, voice, out) {
  const n = config.load().settings.nara || {};
  const args = ['--voice', voice, '--text', text, '--write-media', out];
  if (/^[+-]\d+%$/.test(n.rate || '')) args.push(`--rate=${n.rate}`);
  if (/^[+-]\d+Hz$/.test(n.pitch || '')) args.push(`--pitch=${n.pitch}`);
  if (process.env.HTTPS_PROXY) args.push('--proxy', process.env.HTTPS_PROXY);
  await run('edge-tts', args);
  if (!fs.existsSync(out) || fs.statSync(out).size < 1000) throw new Error('edge-tts não gerou áudio');
}

async function googleTranslateTts(text, out) {
  const parts = [];
  let cur = '';
  for (const w of text.split(/\s+/)) {
    if ((cur + ' ' + w).length > 180) { parts.push(cur.trim()); cur = ''; }
    cur += ' ' + w;
  }
  if (cur.trim()) parts.push(cur.trim());
  const bufs = [];
  for (const p of parts) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=pt-BR&client=tw-ob&q=${encodeURIComponent(p)}`;
    const res = await fetchRetry(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, { tries: 2, timeoutMs: 20000 });
    if (!res.ok) throw new Error('Google Tradutor TTS ' + res.status);
    bufs.push(Buffer.from(await res.arrayBuffer()));
  }
  fs.writeFileSync(out, Buffer.concat(bufs));
}

// lembra quais programas existem (evita procurar a cada fala = resposta mais rápida)
const found = {};
async function has(cmd) {
  if (found[cmd] && Date.now() - found[cmd].at < 10 * 60 * 1000) return found[cmd].ok;
  const ok = await commandExists(cmd);
  found[cmd] = { ok, at: Date.now() };
  return ok;
}

/** Gera um MP3 com a voz da Nara. Devolve o caminho ou null. */
async function synth(text) {
  const voice = config.load().settings.nara.voice || 'pt-BR-ThalitaMultilingualNeural';
  const out = path.join(VOICE_DIR, `fala_${Date.now()}.mp3`);
  // limpa falas antigas
  for (const f of fs.readdirSync(VOICE_DIR)) {
    const fp = path.join(VOICE_DIR, f);
    if (Date.now() - fs.statSync(fp).mtimeMs > 3600000) fs.rmSync(fp, { force: true });
  }
  try {
    if (await has('edge-tts')) {
      await edgeTts(text, voice, out);
      return out;
    }
  } catch (e) {
    logger.warn('Voz Edge falhou, usando reserva:', e.message.slice(0, 150));
  }
  try {
    await googleTranslateTts(text, out);
    return out;
  } catch (e) {
    logger.warn('Voz reserva falhou:', e.message.slice(0, 150));
  }
  return null;
}

async function audioSeconds(file) {
  try {
    const o = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    return parseFloat(o) || 5;
  } catch (_) {
    return 5;
  }
}

/** Toca nas caixas de som do PC (ffplay vem junto com o ffmpeg) */
async function playOnPhone(file) {
  if (file && (await has('ffplay'))) await run('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', file]);
}

/** Converte para PCM 16-bit 24kHz mono (o que o Atom S3R toca) */
async function toPcm(file) {
  const out = file.replace(/\.mp3$/, '.pcm');
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '24000', '-f', 's16le', out]);
  return fs.readFileSync(out);
}

/** Aumenta o volume de um WAV 16-bit (o microfone do Atom capta baixo) — melhora o reconhecimento */
function normalizeWav(wav) {
  try {
    const idx = wav.indexOf(Buffer.from('data'));
    if (idx < 0 || wav.length < idx + 10) return wav;
    const start = idx + 8;
    const n = Math.floor((wav.length - start) / 2);
    let peak = 1;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(wav.readInt16LE(start + i * 2)));
    const gain = Math.min(40, 24000 / peak);
    if (gain < 1.3) return wav;
    const out = Buffer.from(wav);
    for (let i = 0; i < n; i++) {
      const v = Math.max(-32768, Math.min(32767, Math.round(wav.readInt16LE(start + i * 2) * gain)));
      out.writeInt16LE(v, start + i * 2);
    }
    return out;
  } catch (_) {
    return wav;
  }
}

/** Áudio WAV do Atom → texto (Groq Whisper grátis). Sem chave Groq, devolve null. */
async function transcribe(wav) {
  wav = normalizeWav(wav);
  const key = config.load().settings.groqKey;
  if (!key) return null;
  const fd = new FormData();
  fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'fala.wav');
  fd.append('model', 'whisper-large-v3-turbo');
  fd.append('language', 'pt');
  // dica de vocabulário: a Groq passa a reconhecer o nome da assistente
  fd.append('prompt', 'Conversa com a assistente Nara. Nara, bom dia. Nara, posta um vídeo extra hoje. Nara, pausa tudo.');
  fd.append('response_format', 'json');
  const res = await fetchRetry('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd,
  }, { tries: 2, timeoutMs: 60000 });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Groq ' + res.status + ': ' + JSON.stringify(d).slice(0, 200));
  return (d.text || '').trim();
}

module.exports = { NARA_VOICES, synth, playOnPhone, toPcm, transcribe, audioSeconds };
