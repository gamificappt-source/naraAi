// Agenda do dia: decide quando produzir cada vídeo/carrossel de cada perfil
const path = require('path');
const config = require('./config');
const jobs = require('./jobs');
const { DATA_DIR, readJSON, writeJSON, nowInTz, logger } = require('./util');

const STATE_FILE = path.join(DATA_DIR, 'state.json');
let state = readJSON(STATE_FILE, { slots: {}, daily: {} });

function toMin(t) {
  const m = String(t || '').match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function fmt(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function countFor(p, type, date) {
  if (type === 'video') {
    const boost = p.boost && p.boost.until && p.boost.until >= date ? Number(p.boost.extraVideos) || 0 : 0;
    return Math.max(0, Number(p.videosPerDay) || 0) + boost;
  }
  if (type === 'carousel') return Math.max(0, Number(p.carouselsPerDay) || 0);
  return Math.max(0, Number(p.imagesPerDay) || 0);
}

/** Horários do dia para um perfil */
function slotsFor(p, date) {
  const out = [];
  // dias da semana em que este perfil posta (0 = domingo)
  if (Array.isArray(p.days) && p.days.length && !p.days.map(Number).includes(new Date(date + 'T12:00:00Z').getUTCDay())) return out;
  const custom = String(p.customTimes || '').split(/[,;\s]+/).map(toMin).filter((x) => x != null).sort((a, b) => a - b);
  const start = toMin(p.windowStart) ?? 540;
  const end = Math.max(start + 1, toMin(p.windowEnd) ?? 1260);
  const types = ['video', 'carousel', 'image'];
  types.forEach((type, ti) => {
    const n = countFor(p, type, date);
    for (let i = 0; i < n; i++) {
      let min;
      if (type === 'video' && custom.length) min = custom[i % custom.length] + Math.floor(i / custom.length) * 20;
      else min = Math.round(start + ((end - start) * (i + 0.5)) / n) + ti * 25; // espalha e desencontra tipos
      out.push({ key: `${date}|${p.id}|${type}|${i}`, profileId: p.id, profile: p.name, type, minute: Math.min(min, 1439), time: fmt(Math.min(min, 1439)) });
    }
  });
  return out.sort((a, b) => a.minute - b.minute);
}

function today() {
  const c = config.load();
  const now = nowInTz(c.settings.timezone);
  const all = [];
  for (const p of c.profiles) {
    if (!p.enabled) continue;
    for (const s of slotsFor(p, now.date)) {
      const jobId = state.slots[s.key];
      const j = jobId && jobs.get(jobId);
      all.push({ ...s, jobId, status: j ? j.status : s.minute <= now.minutes ? 'atrasado' : 'agendado', title: j && j.title });
    }
  }
  return all.sort((a, b) => a.minute - b.minute);
}

function saveState() {
  // guarda só os últimos 3 dias de chaves
  const keep = Object.keys(state.slots).sort().slice(-2000);
  state.slots = Object.fromEntries(keep.map((k) => [k, state.slots[k]]));
  writeJSON(STATE_FILE, state);
}

const dailyTasks = [];
/** registra tarefa diária: hora "HH:MM" (ou função que retorna) */
function daily(name, timeFn, fn, maxLateMin = 1440) {
  dailyTasks.push({ name, timeFn, fn, maxLateMin });
}

async function tick() {
  const c = config.load();
  const now = nowInTz(c.settings.timezone);
  if (!c.settings.paused) {
    for (const p of c.profiles) {
      if (!p.enabled) continue;
      for (const s of slotsFor(p, now.date)) {
        if (state.slots[s.key]) continue;
        // produz no horário; se o PC ficou desligado, recupera atrasos de até 4h
        if (s.minute <= now.minutes && now.minutes - s.minute <= 240) {
          try {
            const j = jobs.enqueue({ profileId: p.id, type: s.type, reason: `agenda ${s.time}`, slotKey: s.key });
            state.slots[s.key] = j.id;
          } catch (e) {
            logger.error('Agenda:', e.message);
          }
        } else if (now.minutes - s.minute > 240) {
          state.slots[s.key] = 'perdido';
        }
      }
    }
  }
  // Nara parada: também não roda estatísticas/briefing/limpeza (voltam quando iniciar)
  if (c.settings.paused) { saveState(); return; }
  for (const t of dailyTasks) {
    const tm = toMin(typeof t.timeFn === 'function' ? t.timeFn() : t.timeFn);
    if (tm == null) continue;
    const key = `${now.date}|${t.name}`;
    if (state.daily[key] || now.minutes < tm) continue;
    state.daily[key] = true;
    if (now.minutes - tm > t.maxLateMin) continue; // passou da hora (ex.: PC estava desligado)
    Promise.resolve().then(t.fn).catch((e) => logger.error(`Tarefa ${t.name}:`, e.message));
  }
  const dk = Object.keys(state.daily).sort();
  while (dk.length > 200) delete state.daily[dk.shift()];
  saveState();
}

function start() {
  tick();
  setInterval(tick, 30 * 1000);
}

module.exports = { start, today, slotsFor, daily, tick };
