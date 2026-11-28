// Montagem de vídeo e de imagens (carrossel) com ffmpeg
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { run, DATA_DIR, ensureDir, logger } = require('../util');
const fonts = require('./fonts');

const FONTS_DIR = ensureDir(path.join(DATA_DIR, 'fonts'));
const MUSIC_DIR = ensureDir(path.join(DATA_DIR, 'music'));

async function duration(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  return parseFloat(out.trim());
}

// #RRGGBB → &HAABBGGRR (formato de cor do ASS)
function assColor(hex, alpha = 0) {
  const h = String(hex || '#FFFFFF').replace('#', '').padEnd(6, 'F');
  const a = alpha.toString(16).padStart(2, '0').toUpperCase();
  return `&H${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}
function ffColor(hex) {
  return '0x' + String(hex || '#000000').replace('#', '');
}
function assEscape(t) {
  return String(t || '').replace(/[{}]/g, '').replace(/\\/g, '').replace(/\r?\n/g, '\\N');
}
function assTime(s) {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${sec}`;
}

// caminho relativo com "/" (no Windows, "C:\\" quebraria o filtro de legendas do ffmpeg)
function fontsRel(dir) {
  return path.relative(dir, FONTS_DIR).split(path.sep).join('/') || '.';
}

function dims(format) {
  const q = config.load().settings.render.quality === '720' ? 720 : 1080;
  if (format === 'long') return q === 720 ? [1280, 720] : [1920, 1080];
  return q === 720 ? [720, 1280] : [1080, 1920];
}

/** Legendas estilo "palavra destacada" (karaokê) com tempo proporcional ao tamanho das palavras */
function buildSubtitles(text, total, sub, W, H) {
  const scale = H > W ? W / 1080 : H / 1080;
  const size = Math.round((sub.size || 80) * scale);
  const align = sub.position === 'top' ? 8 : sub.position === 'bottom' ? 2 : 5;
  const marginV = Math.round((sub.position === 'middle' ? 0 : 260) * scale);
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,${fonts.resolve(sub.font, 'Anton')},${size},${assColor(sub.color)},${assColor(sub.highlight)},${assColor(sub.outline)},&H80000000,0,0,0,0,100,100,1,0,1,${Math.max(3, Math.round(size / 14))},${Math.round(size / 25)},${align},${Math.round(60 * scale)},${Math.round(60 * scale)},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const words = text.split(/\s+/).filter(Boolean);
  const weight = (w) => w.length + 2 + (/[.!?…]$/.test(w) ? 6 : /[,;:]$/.test(w) ? 3 : 0);
  const totalW = words.reduce((a, w) => a + weight(w), 0) || 1;
  const lead = 0.15;
  const usable = Math.max(1, total - lead - 0.3);
  let t = lead;
  const timed = words.map((w) => {
    const d = (weight(w) / totalW) * usable;
    const r = { w, start: t, end: t + d };
    t += d;
    return r;
  });
  const per = Math.max(1, Number(sub.wordsPerLine) || 3);
  const lines = [];
  for (let i = 0; i < timed.length; ) {
    // quebra também em fim de frase
    let j = i;
    while (j < timed.length && j - i < per) {
      j++;
      if (/[.!?…]$/.test(timed[j - 1].w)) break;
    }
    lines.push(timed.slice(i, j));
    i = j;
  }
  const hl = assColor(sub.highlight);
  const events = [];
  for (const line of lines) {
    line.forEach((cur, k) => {
      const parts = line.map((x, n) => {
        let w = assEscape(sub.uppercase ? x.w.toUpperCase() : x.w);
        if (n === k) w = `{\\c${hl}\\fscx112\\fscy112}${w}{\\r}`;
        return w;
      });
      const end = k === line.length - 1 ? cur.end : line[k + 1].start;
      events.push(`Dialogue: 0,${assTime(cur.start)},${assTime(end)},Main,,0,0,0,,{\\fad(0,0)}${parts.join(' ')}`);
    });
  }
  return header + events.join('\n') + '\n';
}

// Legenda automática: só a fonte é sua; cores, tamanho e posição a Nara decide
function saturation(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length < 6) return 0;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : ((mx - mn) / mx) * mx; // vivo e claro
}
function autoSubtitle(profile, W, H) {
  const s = profile.subtitle || {};
  if (s.auto === false) return s;
  const long = W > H;
  const pal = (profile.palette || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  const vivid = pal.slice().sort((a, b) => saturation(b) - saturation(a))[0];
  return {
    font: s.font || 'Anton',
    size: long ? 64 : 82,
    color: '#FFFFFF',
    outline: '#000000',
    highlight: vivid && saturation(vivid) > 0.35 ? vivid : '#FFD400',
    position: long ? 'bottom' : 'middle',
    uppercase: true,
    wordsPerLine: long ? 5 : 3,
  };
}

function pickMusic(profileId) {
  const dirs = [path.join(MUSIC_DIR, profileId), MUSIC_DIR];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    const files = fs.readdirSync(d).filter((f) => /\.(mp3|m4a|aac|wav|ogg)$/i.test(f));
    if (files.length) return path.join(d, files[Math.floor(Math.random() * files.length)]);
  }
  return null;
}

/**
 * Renderiza o vídeo final.
 * scenes: [{text, image}], audio: wav da narração
 */
async function renderVideo({ dir, scenes, audio, narration, profile, logo = null }) {
  const [W, H] = dims(profile.videoFormat);
  const fps = Number(config.load().settings.render.fps) || 30;
  const total = await duration(audio);
  // chamada final com a logo do canal: +3 s depois da narração
  const endDur = logo && profile.endCard !== false ? 3 : 0;
  const lens = scenes.map((s) => Math.max(10, (s.text || '').length));
  const sum = lens.reduce((a, b) => a + b, 0);
  const clipList = [];
  const bg = (profile.palette && profile.palette[0]) || '#111111';

  for (let i = 0; i < scenes.length; i++) {
    const d = Math.max(1.5, (lens[i] / sum) * total + (i === scenes.length - 1 ? 0.6 + endDur : 0));
    const frames = Math.ceil(d * fps);
    const out = path.join(dir, `clip_${String(i).padStart(2, '0')}.mp4`);
    const zoomIn = i % 2 === 0;
    const z = zoomIn ? `min(1+0.0009*on,1.18)` : `max(1.18-0.0009*on,1)`;
    const xExpr = i % 3 === 2 ? `(iw-iw/zoom)*on/${frames}` : `iw/2-(iw/zoom/2)`;
    const SW = Math.round(W * 1.5);
    const SH = Math.round(H * 1.5);
    const vf =
      `scale=${SW}:${SH}:force_original_aspect_ratio=increase,crop=${SW}:${SH},setsar=1,` +
      `zoompan=z='${z}':x='${xExpr}':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps},` +
      `eq=contrast=1.05:saturation=1.08,vignette=PI/5,format=yuv420p`;
    const input = scenes[i].image && fs.existsSync(scenes[i].image)
      ? ['-loop', '1', '-i', scenes[i].image]
      : ['-f', 'lavfi', '-i', `color=c=${ffColor(bg)}:s=${SW}x${SH}`];
    await run('ffmpeg', ['-y', '-loglevel', 'error', ...input, '-t', d.toFixed(3), '-vf', vf, '-r', String(fps), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-an', out]);
    clipList.push(out);
  }
  fs.writeFileSync(path.join(dir, 'clips.txt'), clipList.map((c) => `file '${path.basename(c)}'`).join('\n'));
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'clips.txt', '-c', 'copy', 'visual.mp4'], { cwd: dir });

  let subs = buildSubtitles(narration, total, autoSubtitle(profile, W, H), W, H);
  const endT = total + 0.15;
  if (endDur && profile.endCardText) {
    const sc = H > W ? W / 1080 : H / 1080;
    const st = profile.subtitle || {};
    const endStyle = `Style: End,${fonts.resolve(st.font, 'Anton')},${Math.round(64 * sc)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,1,0,1,${Math.max(2, Math.round(4 * sc))},0,2,60,60,${Math.round(H * 0.2)},1`;
    subs = subs.replace('\n\n[Events]', `\n${endStyle}\n\n[Events]`);
    subs += `Dialogue: 1,${assTime(endT + 0.3)},${assTime(endT + endDur)},End,,0,0,0,,{\\fad(300,0)}${assEscape(profile.endCardText)}\n`;
  }
  fs.writeFileSync(path.join(dir, 'subs.ass'), subs);

  const music = profile.music ? pickMusic(profile.id) : null;
  const args = ['-y', '-loglevel', 'error', '-i', 'visual.mp4', '-i', path.basename(audio)];
  let next = 2;
  const parts = [];
  let v = '[0:v]';
  if (endDur) {
    parts.push(`${v}drawbox=x=0:y=0:w=iw:h=ih:color=black@0.6:t=fill:enable='gte(t,${endT.toFixed(2)})'[dk]`);
    v = '[dk]';
  }
  parts.push(`${v}subtitles=subs.ass:fontsdir=${fontsRel(dir)}[sv]`);
  v = '[sv]';
  if (logo && profile.watermark) {
    args.push('-loop', '1', '-i', logo);
    const li = next++;
    const m = Math.round(W * 0.04);
    parts.push(`[${li}:v]scale=${Math.round(Math.min(W, H) * 0.16)}:-1,format=rgba,colorchannelmixer=aa=0.7[wm]`);
    parts.push(`${v}[wm]overlay=W-w-${m}:${m}:shortest=1:enable='lt(t,${endT.toFixed(2)})'[wv]`);
    v = '[wv]';
  }
  if (endDur) {
    args.push('-loop', '1', '-i', logo);
    const li = next++;
    parts.push(`[${li}:v]scale=${Math.round(Math.min(W, H) * 0.42)}:-1,format=rgba,fade=t=in:st=${endT.toFixed(2)}:d=0.5:alpha=1[lg]`);
    parts.push(`${v}[lg]overlay=(W-w)/2:(H-h)/2-H*0.04:shortest=1:enable='gte(t,${endT.toFixed(2)})'[ev]`);
    v = '[ev]';
  }
  let a = '[1:a]';
  if (endDur) {
    parts.push(`${a}apad=pad_dur=${endDur + 0.5}[na]`);
    a = '[na]';
  }
  if (music) {
    args.push('-stream_loop', '-1', '-i', music);
    const mi = next++;
    parts.push(`[${mi}:a]volume=0.10[m];${a}[m]amix=inputs=2:duration=first:dropout_transition=0[a]`);
    a = '[a]';
  }
  const filter = parts.join(';');
  const amap = a === '[1:a]' ? '1:a' : a;
  args.push('-filter_complex', filter, '-map', v, '-map', amap, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-shortest', '-movflags', '+faststart', 'final.mp4');
  await run('ffmpeg', args, { cwd: dir });
  // limpa intermediários
  for (const c of clipList) fs.rmSync(c, { force: true });
  fs.rmSync(path.join(dir, 'visual.mp4'), { force: true });
  logger.info(`Vídeo renderizado (${total.toFixed(1)}s) em ${dir}`);
  return path.join(dir, 'final.mp4');
}

/** Renderiza 1 slide de carrossel (1080x1350) */
async function renderSlide({ dir, index, total, slide, image, profile, handle }) {
  const W = 1080, H = 1350;
  const pal = profile.palette && profile.palette.length ? profile.palette : ['#0B0F1A', '#E63946', '#F1FAEE'];
  const [bg, accent, light] = [pal[0], pal[1] || '#E63946', pal[2] || '#FFFFFF'];
  const font = fonts.resolve(profile.carouselFont, 'Poppins ExtraBold');
  const bodyFont = fonts.resolve(profile.carouselBodyFont || profile.carouselFont, 'Poppins Regular');
  const isCover = index === 0;
  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Head,${font},${isCover ? 92 : 70},${assColor(isCover ? light : accent)},&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,${isCover ? 4 : 2},2,${isCover ? 2 : 1},70,70,${isCover ? 170 : 360},1
Style: Body,${bodyFont},44,${assColor(light)},&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,7,70,70,0,1
Style: Small,${bodyFont},30,${assColor(light, 0x30)},&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,1,0,1,1,0,3,60,60,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:05.00,Head,,0,0,0,,${assEscape(isCover ? slide.headline.toUpperCase() : slide.headline)}
${isCover ? '' : `Dialogue: 0,0:00:00.00,0:00:05.00,Body,,0,0,0,,{\\pos(70,1010)\\q1}${assEscape(slide.body || '')}`}
Dialogue: 0,0:00:00.00,0:00:05.00,Small,,0,0,0,,${assEscape(handle ? '@' + handle.replace(/^@/, '') + '   ' : '')}${index + 1}/${total}${index < total - 1 ? '  →' : ''}
`;
  fs.writeFileSync(path.join(dir, `slide_${index}.ass`), ass);
  const shade = isCover
    ? `drawbox=x=0:y=ih*0.45:w=iw:h=ih*0.55:color=black@0.55:t=fill,drawbox=x=70:y=ih-130:w=160:h=10:color=${ffColor(accent)}:t=fill`
    : `drawbox=x=0:y=ih*0.62:w=iw:h=ih*0.38:color=${ffColor(bg)}@0.92:t=fill,drawbox=x=0:y=ih*0.62:w=iw:h=8:color=${ffColor(accent)}:t=fill`;
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,eq=brightness=-0.04:saturation=1.05,${shade},subtitles=slide_${index}.ass:fontsdir=${fontsRel(dir)}`;
  const input = image && fs.existsSync(image) ? ['-i', path.basename(image)] : ['-f', 'lavfi', '-i', `color=c=${ffColor(bg)}:s=${W}x${H}`];
  const out = `slide_${String(index).padStart(2, '0')}.jpg`;
  await run('ffmpeg', ['-y', '-loglevel', 'error', ...input, '-vf', vf, '-frames:v', '1', '-q:v', '2', out], { cwd: dir });
  return path.join(dir, out);
}

module.exports = { renderVideo, renderSlide, duration, buildSubtitles, FONTS_DIR, MUSIC_DIR };
