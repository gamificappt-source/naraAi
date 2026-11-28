// Mantém ligada a rede Wi-Fi própria da Nara (Hotspot móvel do Windows) para o Atom S3R.
// O Windows desliga o hotspot quando fica um tempo sem aparelhos; a Nara religa a cada 2 minutos.
const path = require('path');
const config = require('./config');
const { run, ROOT, logger } = require('./util');

const SCRIPT = path.resolve(ROOT, '..', 'install', 'nara-hotspot.ps1');
let last = { state: 'desconhecido', checkedAt: '' };
let busy = false;

async function call(action) {
  const s = config.load().settings.hotspot || {};
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Action', action];
  if (action === 'start') args.push('-Ssid', s.ssid || 'Nara-Atom', '-Pass', s.pass || '');
  const out = await run('powershell.exe', args, { windowsHide: true });
  const line = out.trim().split(/\r?\n/).pop();
  const r = JSON.parse(line);
  last = { ...r, checkedAt: new Date().toISOString() };
  return last;
}

/** Liga (ou confere) o hotspot, se estiver ativado nos ajustes */
async function keep() {
  if (process.platform !== 'win32' || busy) return last;
  const s = config.load().settings.hotspot || {};
  if (!s.enabled || !s.pass) return last;
  busy = true;
  try {
    const before = last.state;
    const r = await call('start');
    if (!r.ok) logger.warn('Rede da Nara (hotspot):', r.error);
    else if (before !== 'On') logger.info(`Rede Wi-Fi da Nara ligada: ${r.ssid} (endereço do PC nela: 192.168.137.1)`);
  } catch (e) {
    logger.warn('Rede da Nara (hotspot):', e.message.slice(0, 200));
  } finally {
    busy = false;
  }
  return last;
}

async function stop() {
  try { return await call('stop'); } catch (e) { return { ok: false, error: e.message }; }
}

function start() {
  setTimeout(keep, 5000);
  setInterval(keep, 2 * 60 * 1000);
}

module.exports = { start, keep, stop, status: () => last };
