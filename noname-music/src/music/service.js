// Inti logika musik: player 24/7, antrian, kontrol, filter.
const { PermissionFlagsBits } = require('discord.js');
const { config } = require('../config');
const store = require('../store');
const log = require('../utils/logger');
const { UserError } = require('../utils/errors');
const { isHttpUrl, safe } = require('../utils/format');

const ctx = {
  client: null,
  manager: null,
  guildId: null,
  shuttingDown: false,
  recovering: false,
  onChange: () => {},
};

// Kunci sederhana supaya aksi yang mengubah antrian tidak saling tabrakan.
let lock = Promise.resolve();
function withLock(fn) {
  const run = lock.then(fn, fn);
  lock = run.catch(() => {});
  return run;
}

function init({ client, manager, guildId, onChange }) {
  ctx.client = client;
  ctx.manager = manager;
  ctx.guildId = guildId;
  if (typeof onChange === 'function') ctx.onChange = onChange;
}

const changed = () => {
  try {
    ctx.onChange();
  } catch (err) {
    log.warn('onChange error:', err?.message);
  }
};

function nodeReady() {
  if (!ctx.manager) return false;
  return [...ctx.manager.nodeManager.nodes.values()].some((n) => n.connected && !!n.sessionId);
}

function getPlayer() {
  return ctx.manager?.getPlayer(ctx.guildId) ?? null;
}

function guild() {
  return ctx.client?.guilds.cache.get(ctx.guildId) ?? null;
}

function currentVolume() {
  const v = store.get('volume');
  return Number.isInteger(v) ? v : config.defaultVolume;
}

async function ensurePlayer() {
  if (!nodeReady()) throw new UserError('🔌 Server audio (Lavalink) sedang offline. Coba lagi beberapa saat lagi.');
  const g = guild();
  if (!g) throw new UserError('Server Discord belum siap, coba lagi sebentar.');

  let player = getPlayer();
  let fresh = false;
  if (!player) {
    player = ctx.manager.createPlayer({
      guildId: ctx.guildId,
      voiceChannelId: config.voiceChannelId,
      textChannelId: store.get('panelChannelId') || null,
      selfDeaf: true,
      selfMute: false,
      volume: currentVolume(),
    });
    fresh = true;
  }

  const inChannel = g.members.me?.voice?.channelId === config.voiceChannelId;
  if (fresh || !inChannel) {
    player.options.voiceChannelId = config.voiceChannelId;
    player.voiceChannelId = config.voiceChannelId;
    await player.connect();
  }
  if (fresh) {
    const node = player.node;
    player.setData('nodeSession', node?.sessionId ?? null);
    await waitForVoice(player);
    await applyFilter(player, store.get('filter') || 'normal').catch(() => {});
  }
  return player;
}

/** Tunggu sampai Discord mengirim data voice (maks ~6 detik). */
async function waitForVoice(player, timeoutMs = 6_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = player.voice || {};
    if (v.endpoint && v.sessionId && v.token) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * Dipanggil saat Lavalink tersambung lagi. Kalau Lavalink sempat restart (sesi baru),
 * player lama sudah tidak dikenal server -> buat ulang & lanjutkan lagu dari posisi terakhir.
 */
async function recoverAfterNodeRestart() {
  if (ctx.shuttingDown) return;
  const old = getPlayer();
  if (!old) return keepAlive();
  const node = old.node;
  if (!node?.sessionId || old.getData('nodeSession') === node.sessionId) return keepAlive();

  log.warn('Lavalink memulai sesi baru, memulihkan player & antrian...');
  return withLock(async () => {
    const snap = {
      current: old.queue.current,
      tracks: [...old.queue.tracks],
      previous: [...old.queue.previous],
      position: old.position || 0,
      paused: !!old.paused,
      repeat: old.repeatMode || 'off',
    };
    ctx.recovering = true;
    try {
      await old.destroy('LavalinkRestartRecovery', true).catch(() => {});
      ctx.manager.deletePlayer(ctx.guildId);
      await new Promise((r) => setTimeout(r, 1_500));
      const p = await ensurePlayer();
      if (snap.tracks.length) await p.queue.add(snap.tracks);
      if (snap.previous.length) p.queue.previous.push(...snap.previous.slice(0, 30));
      if (snap.repeat !== 'off') await p.setRepeatMode(snap.repeat);
      if (snap.current) {
        const pos = snap.current.info?.isSeekable && !snap.current.info?.isStream ? snap.position : undefined;
        await p.play({ clientTrack: snap.current, position: pos, paused: snap.paused });
      } else if (p.queue.tracks.length) {
        await p.play({ paused: snap.paused });
      }
      log.info('Player berhasil dipulihkan.');
    } catch (err) {
      log.warn('Pemulihan player gagal:', err?.message || err);
    } finally {
      ctx.recovering = false;
      changed();
    }
  });
}

/** Cek apakah member boleh mengontrol musik. Return pesan error atau null. */
function controlError(member) {
  if (!member) return 'Tidak bisa membaca data member.';
  const perms = member.permissions;
  if (perms?.has?.(PermissionFlagsBits.ManageGuild)) return null;
  if (config.djRoleId && member.roles?.cache?.has(config.djRoleId)) return null;
  if (member.voice?.channelId !== config.voiceChannelId) {
    return `🎧 Masuk dulu ke <#${config.voiceChannelId}> untuk mengontrol musik.`;
  }
  return null;
}

function requirePlayer({ needTrack = true } = {}) {
  const player = getPlayer();
  if (!player) throw new UserError('Player belum siap. Tunggu sebentar ya.');
  if (needTrack && !player.queue.current) throw new UserError('Tidak ada lagu yang sedang diputar.');
  return player;
}

/* ------------------------------ ANTRIAN ------------------------------ */

async function enqueue(rawQuery, user, { next = false } = {}) {
  const query = String(rawQuery || '').trim();
  if (!query) throw new UserError('Masukkan judul lagu atau link YouTube/Spotify.');
  if (query.length > 500) throw new UserError('Teks pencarian terlalu panjang.');

  return withLock(async () => {
    const player = await ensurePlayer();
    const isUrl = isHttpUrl(query);

    let res;
    try {
      res = await player.search(isUrl ? { query } : { query, source: config.defaultSearch }, user);
    } catch (err) {
      const msg = String(err?.message || err);
      log.warn('Search gagal:', msg);
      if (/spotify|sp(search|rec)/i.test(msg) || /open\.spotify\.com/i.test(query)) {
        throw new UserError('Spotify belum aktif di server audio. Cek konfigurasi LavaSrc di application.yml.');
      }
      if (/not.*(allowed|supported)|no.*source/i.test(msg)) {
        throw new UserError('Link ini tidak didukung. Gunakan link YouTube, YouTube Music, Spotify, atau SoundCloud.');
      }
      throw new UserError('Gagal mencari lagu. Coba lagi atau pakai link langsung.');
    }

    const loadType = res?.loadType;
    if (loadType === 'error') {
      throw new UserError(`Gagal memuat: ${safe(res?.exception?.message || 'tidak diketahui', 150)}`);
    }
    const tracks = Array.isArray(res?.tracks) ? res.tracks : [];
    if (loadType === 'empty' || tracks.length === 0) {
      throw new UserError(`Tidak ditemukan hasil untuk **${safe(query, 60)}**.`);
    }

    const isPlaylist = loadType === 'playlist';
    let toAdd = isPlaylist ? tracks : [tracks[0]];
    const room = config.maxQueue - player.queue.tracks.length;
    if (room <= 0) throw new UserError(`Antrian penuh (maks ${config.maxQueue} lagu).`);
    const trimmed = toAdd.length > room;
    toAdd = toAdd.slice(0, room);

    // Kalau antrian sedang berisi lagu dari autoplay, buang dulu supaya request member diprioritaskan.
    const autoIdx = player.queue.tracks
      .map((t, i) => (t?.requester?.isAutoplay ? i : -1))
      .filter((i) => i >= 0);
    if (autoIdx.length) await player.queue.remove(autoIdx);

    await player.queue.add(toAdd, next ? 0 : undefined);

    if (!player.queue.current) {
      await player.play({ paused: false });
    } else if (player.getData('autoPaused')) {
      // biarkan, akan otomatis resume ketika ada member masuk
    }

    changed();
    return {
      isPlaylist,
      playlistName: res?.playlist?.name || res?.playlist?.title || null,
      count: toAdd.length,
      trimmed,
      first: toAdd[0],
      position: player.queue.current === toAdd[0] ? 0 : player.queue.tracks.indexOf(toAdd[0]) + 1,
    };
  });
}

/* ------------------------------ KONTROL ------------------------------ */

async function togglePause() {
  const player = requirePlayer();
  if (player.paused) {
    player.deleteData('autoPaused');
    await player.resume();
  } else {
    await player.pause();
  }
  changed();
  return player.paused ? '⏸️ Dijeda.' : '▶️ Dilanjutkan.';
}

async function skip() {
  return withLock(async () => {
    const player = requirePlayer();
    if (player.paused) await player.resume();
    // throwError=false: kalau antrian kosong, autoplay (jika aktif) akan mengambil alih.
    await player.skip(0, false);
    changed();
    return '⏭️ Lagu dilewati.';
  });
}

async function previous() {
  return withLock(async () => {
    const player = requirePlayer({ needTrack: false });
    if (player.queue.current && player.position > 5_000 && player.queue.current.info?.isSeekable) {
      await player.seek(0);
      changed();
      return '⏮️ Diulang dari awal.';
    }
    const prev = await player.queue.shiftPrevious();
    if (!prev) throw new UserError('Belum ada lagu sebelumnya.');
    if (player.queue.current) await player.queue.add(player.queue.current, 0);
    await player.play({ clientTrack: prev, paused: false });
    changed();
    return `⏮️ Memutar lagi **${safe(prev.info.title, 60)}**.`;
  });
}

async function stop() {
  return withLock(async () => {
    const player = requirePlayer({ needTrack: false });
    if (!player.queue.current && player.queue.tracks.length === 0) throw new UserError('Tidak ada yang sedang diputar.');
    await player.stopPlaying(true, false);
    player.deleteData('autoPaused');
    changed();
    return '⏹️ Musik dihentikan & antrian dikosongkan. Bot tetap standby 24/7.';
  });
}

async function shuffle() {
  const player = requirePlayer({ needTrack: false });
  if (player.queue.tracks.length < 2) throw new UserError('Minimal 2 lagu di antrian untuk diacak.');
  await player.queue.shuffle();
  changed();
  return '🔀 Antrian diacak.';
}

const LOOP_NEXT = { off: 'track', track: 'queue', queue: 'off' };
const LOOP_LABEL = { off: 'Mati', track: 'Lagu ini', queue: 'Semua antrian' };

async function cycleLoop(mode) {
  const player = requirePlayer({ needTrack: false });
  const next = mode && LOOP_LABEL[mode] ? mode : LOOP_NEXT[player.repeatMode] || 'off';
  await player.setRepeatMode(next);
  changed();
  return `🔁 Loop: **${LOOP_LABEL[next]}**`;
}

async function setAutoplay(value) {
  const next = typeof value === 'boolean' ? value : !store.get('autoplay');
  store.set('autoplay', next);
  const player = getPlayer();
  // Kalau autoplay baru dinyalakan saat idle, langsung isi dari lagu terakhir.
  if (next && player && !player.queue.current && player.queue.previous[0]) {
    try {
      const { autoPlay } = require('./autoplay');
      await withLock(async () => {
        await autoPlay(player, player.queue.previous[0], ctx.client.user);
        if (!player.queue.current && player.queue.tracks.length) await player.play({ paused: false });
      });
    } catch (err) {
      log.warn('Autoplay manual gagal:', err?.message);
    }
  }
  changed();
  return next ? '✨ Autoplay **aktif** — lagu mirip akan diputar saat antrian habis.' : '✨ Autoplay **dimatikan**.';
}

async function setVolume(valueOrDelta, { relative = false } = {}) {
  const player = requirePlayer({ needTrack: false });
  const base = Number.isFinite(player.volume) ? player.volume : currentVolume();
  let vol = relative ? base + valueOrDelta : valueOrDelta;
  vol = Math.round(Math.min(Math.max(vol, 0), config.maxVolume));
  await player.setVolume(vol);
  store.set('volume', vol);
  changed();
  return `${vol === 0 ? '🔇' : vol < 50 ? '🔉' : '🔊'} Volume: **${vol}%**`;
}

const FILTERS = {
  normal: { label: 'Normal', emoji: '🎚️', desc: 'Tanpa efek' },
  bassboost: { label: 'Bass Boost', emoji: '💥', desc: 'Bass lebih nendang' },
  nightcore: { label: 'Nightcore', emoji: '🌙', desc: 'Lebih cepat & tinggi' },
  vaporwave: { label: 'Vaporwave', emoji: '🌊', desc: 'Lambat & dreamy' },
  '8d': { label: '8D Audio', emoji: '🎧', desc: 'Suara berputar (pakai headset)' },
  soft: { label: 'Soft', emoji: '☁️', desc: 'Lebih lembut (low-pass)' },
};

async function applyFilter(player, name) {
  const fm = player.filterManager;
  await fm.resetFilters();
  switch (name) {
    case 'bassboost':
      await fm.setEQPreset('BassboostMedium');
      break;
    case 'nightcore':
      await fm.toggleNightcore();
      break;
    case 'vaporwave':
      await fm.toggleVaporwave();
      break;
    case '8d':
      await fm.toggleRotation(0.2);
      break;
    case 'soft':
      await fm.toggleLowPass(20);
      break;
    default:
      break;
  }
}

async function setFilter(name) {
  if (!FILTERS[name]) throw new UserError('Filter tidak dikenal.');
  const player = requirePlayer({ needTrack: false });
  await applyFilter(player, name);
  store.set('filter', name);
  changed();
  return `${FILTERS[name].emoji} Filter: **${FILTERS[name].label}**`;
}

async function clearQueue() {
  const player = requirePlayer({ needTrack: false });
  const n = player.queue.tracks.length;
  if (!n) throw new UserError('Antrian sudah kosong.');
  await player.queue.splice(0, n);
  changed();
  return `🗑️ ${n} lagu dihapus dari antrian.`;
}

async function removeAt(position) {
  const player = requirePlayer({ needTrack: false });
  const idx = position - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= player.queue.tracks.length) {
    throw new UserError(`Nomor antrian harus 1 - ${player.queue.tracks.length || 1}.`);
  }
  const t = player.queue.tracks[idx];
  await player.queue.remove(idx);
  changed();
  return `🗑️ Dihapus: **${safe(t?.info?.title, 60)}**`;
}

async function jumpTo(position) {
  return withLock(async () => {
    const player = requirePlayer({ needTrack: false });
    const n = player.queue.tracks.length;
    if (!Number.isInteger(position) || position < 1 || position > n) {
      throw new UserError(`Nomor antrian harus 1 - ${n || 1}.`);
    }
    if (player.queue.current) {
      await player.skip(position, false);
    } else {
      if (position > 1) await player.queue.splice(0, position - 1);
      await player.play({ paused: false });
    }
    changed();
    return `⏩ Lompat ke lagu nomor **${position}**.`;
  });
}

async function seekTo(ms) {
  const player = requirePlayer();
  if (!player.queue.current.info?.isSeekable || player.queue.current.info?.isStream) {
    throw new UserError('Lagu ini tidak bisa di-seek.');
  }
  const dur = player.queue.current.info.duration;
  const pos = Math.min(Math.max(0, ms), Math.max(0, dur - 1000));
  await player.seek(pos);
  changed();
  return pos;
}

/* --------------------------- 24/7 & AUTO PAUSE --------------------------- */

function humansInVoice() {
  const ch = guild()?.channels.cache.get(config.voiceChannelId);
  if (!ch?.members) return 0;
  return ch.members.filter((m) => !m.user.bot).size;
}

async function syncAutoPause() {
  const player = getPlayer();
  if (!player?.queue.current) return;
  const humans = humansInVoice();
  try {
    if (humans === 0 && !player.paused) {
      await player.pause();
      player.setData('autoPaused', true);
      changed();
    } else if (humans > 0 && player.paused && player.getData('autoPaused')) {
      player.deleteData('autoPaused');
      await player.resume();
      changed();
    }
  } catch (err) {
    log.warn('Auto pause/resume gagal:', err?.message);
  }
}

async function keepAlive() {
  if (ctx.shuttingDown || ctx.recovering || !nodeReady()) return;
  try {
    await ensurePlayer();
  } catch (err) {
    if (!(err instanceof UserError)) log.warn('Keep-alive 24/7 gagal:', err?.message || err);
  }
}

module.exports = {
  init,
  ctx,
  FILTERS,
  LOOP_LABEL,
  nodeReady,
  getPlayer,
  ensurePlayer,
  controlError,
  currentVolume,
  enqueue,
  togglePause,
  skip,
  previous,
  stop,
  shuffle,
  cycleLoop,
  setAutoplay,
  setVolume,
  setFilter,
  applyFilter,
  clearQueue,
  removeAt,
  jumpTo,
  seekTo,
  syncAutoPause,
  keepAlive,
  recoverAfterNodeRestart,
  humansInVoice,
};
