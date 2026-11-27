// Voz da própria Nara (grátis) e transcrição do que você fala para o Atom S3R
//  Falar:  Microsoft Edge TTS (edge-tts, vozes neurais grátis) → Google Tradutor (reserva) → voz do Android (última reserva)
//  Ouvir:  Groq Whisper (grátis, com chave) ou o reconhecimento de voz do próprio celular (Termux:API)
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { run, commandExists, fetchRetry, DATA_DIR, ensureDir, logger } = require('../util');

const VOICE_DIR = ensureDir(path.join(DATA_DIR, 'voice'));

async function edgeTts(text, voice, out) {
  const args = ['--voice', voice, '--text', text, '--write-media', out];
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
    if (await commandExists('edge-tts')) {
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

/** Toca no alto-falante do celular (ou no Bluetooth/HDMI conectado) */
async function playOnPhone(file, text) {
  if (file && (await commandExists('termux-media-player'))) {
    await run('termux-media-player', ['play', file]);
    const secs = await audioSeconds(file);
    await new Promise((r) => setTimeout(r, secs * 1000 + 600));
    return;
  }
  if (file && (await commandExists('ffplay'))) {
    // PC (Windows/Linux/Mac): toca nas caixas de som
    await run('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', file]);
    return;
  }
  if (await commandExists('termux-tts-speak')) {
    await run('termux-tts-speak', ['-l', 'pt', '-r', '1.05', text]);
  }
}

/** Converte para PCM 16-bit 24kHz mono (o que o Atom S3R toca) */
async function toPcm(file) {
  const out = file.replace(/\.mp3$/, '.pcm');
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '24000', '-f', 's16le', out]);
  return fs.readFileSync(out);
}

/** Áudio WAV do Atom → texto (Groq Whisper grátis). Sem chave Groq, devolve null. */
async function transcribe(wav) {
  const key = config.load().settings.groqKey;
  if (!key) return null;
  const fd = new FormData();
  fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'fala.wav');
  fd.append('model', 'whisper-large-v3-turbo');
  fd.append('language', 'pt');
  fd.append('response_format', 'json');
  const res = await fetchRetry('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd,
  }, { tries: 2, timeoutMs: 60000 });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Groq ' + res.status + ': ' + JSON.stringify(d).slice(0, 200));
  return (d.text || '').trim();
}

/** Escuta pelo microfone do celular (reconhecimento de voz do Android, grátis) */
async function listenOnPhone() {
  if (!(await commandExists('termux-speech-to-text'))) return null;
  try {
    const out = await run('termux-speech-to-text', []);
    return out.trim().split('\n').pop() || null;
  } catch (e) {
    logger.warn('Microfone do celular:', e.message);
    return null;
  }
}

module.exports = { synth, playOnPhone, toPcm, transcribe, listenOnPhone };
