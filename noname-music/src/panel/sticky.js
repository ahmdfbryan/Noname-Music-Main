// Panel sticky: selalu berada di pesan paling bawah channel, auto-update, anti spam edit.
const { ChannelType, PermissionFlagsBits, RESTJSONErrorCodes } = require('discord.js');
const store = require('../store');
const log = require('../utils/logger');
const music = require('../music/service');
const { buildPanel } = require('./build');

const EDIT_INTERVAL_MS = 1_500; // jeda minimal antar edit
const STICKY_DELAY_MS = 3_000; // tunggu chat reda sebelum panel dipindah ke bawah
const STICKY_MAX_WAIT_MS = 12_000; // chat ramai terus? tetap pindah paling lambat segini
const PROGRESS_INTERVAL_MS = 15_000; // refresh progress bar saat lagu diputar

const state = {
  client: null,
  channel: null,
  busy: false, // sedang repost
  repostAgain: false, // ada chat baru saat repost berjalan
  pendingEdit: false,
  lastEdit: 0,
  editTimer: null,
  stickyTimer: null,
  stickyFirstAt: 0,
  progressTimer: null,
  notice: null, // { text, until }
};

function noticeNow() {
  if (state.notice && state.notice.until > Date.now()) return state.notice;
  state.notice = null;
  return null;
}

function setNotice(text, ms = 20_000) {
  state.notice = { text, until: Date.now() + ms };
  scheduleUpdate();
}

function payload() {
  return buildPanel({
    notice: noticeNow(),
    botAvatar: state.client?.user?.displayAvatarURL({ extension: 'png', size: 256 }) ?? null,
  });
}

function missingPerms(channel) {
  const me = channel.guild.members.me;
  const perms = channel.permissionsFor(me);
  const need = [
    [PermissionFlagsBits.ViewChannel, 'View Channel'],
    [PermissionFlagsBits.SendMessages, 'Send Messages'],
    [PermissionFlagsBits.ReadMessageHistory, 'Read Message History'],
    [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
  ];
  return need.filter(([flag]) => !perms?.has(flag)).map(([, name]) => name);
}

async function resolveChannel() {
  const id = store.get('panelChannelId');
  if (!id || !state.client) return null;
  if (state.channel?.id === id) return state.channel;
  try {
    const ch = await state.client.channels.fetch(id);
    if (!ch || ch.type !== ChannelType.GuildText) return null;
    state.channel = ch;
    return ch;
  } catch {
    return null;
  }
}

const isUnknownMessage = (err) => err?.code === RESTJSONErrorCodes.UnknownMessage;

/** Kirim panel baru di bawah, lalu hapus panel lama. */
async function repost() {
  if (state.busy) {
    state.repostAgain = true;
    return;
  }
  const channel = await resolveChannel();
  if (!channel) return;
  state.busy = true;
  clearTimeout(state.stickyTimer);
  state.stickyTimer = null;
  state.stickyFirstAt = 0;
  try {
    const missing = missingPerms(channel);
    if (missing.length) {
      log.warn(`Bot kurang izin di #${channel.name}: ${missing.join(', ')}`);
      return;
    }
    const oldId = store.get('panelMessageId');
    const msg = await channel.send(payload());
    store.set('panelMessageId', msg.id);
    state.lastEdit = Date.now();
    state.pendingEdit = false;
    if (oldId && oldId !== msg.id) {
      await channel.messages.delete(oldId).catch(() => {});
    }
  } catch (err) {
    log.warn('Gagal mengirim panel:', err?.message || err);
  } finally {
    state.busy = false;
    if (state.repostAgain) {
      state.repostAgain = false;
      scheduleSticky();
    } else if (state.pendingEdit) {
      scheduleUpdate();
    }
  }
}

/** Edit panel yang sudah ada (dengan throttle). */
async function editNow() {
  state.editTimer = null;
  if (state.busy) {
    state.pendingEdit = true;
    return;
  }
  const channel = await resolveChannel();
  const id = store.get('panelMessageId');
  if (!channel) return;
  if (!id) return repost();
  state.pendingEdit = false;
  state.lastEdit = Date.now();
  try {
    await channel.messages.edit(id, payload());
  } catch (err) {
    if (isUnknownMessage(err)) {
      store.set('panelMessageId', null);
      await repost();
    } else {
      log.warn('Gagal update panel:', err?.message || err);
    }
  }
  if (state.pendingEdit) scheduleUpdate();
}

function scheduleUpdate() {
  if (state.editTimer) return;
  const wait = Math.max(0, EDIT_INTERVAL_MS - (Date.now() - state.lastEdit));
  state.editTimer = setTimeout(() => {
    editNow().catch((e) => log.warn('editNow:', e?.message));
  }, wait);
}

/** Dipanggil setiap ada pesan baru di channel panel. */
function onChannelActivity(message) {
  const panelChannelId = store.get('panelChannelId');
  if (!panelChannelId || message.channelId !== panelChannelId) return;
  if (message.id === store.get('panelMessageId')) return;
  // Pesan bot sendiri (= panel) diabaikan, KECUALI balasan slash command publik.
  if (message.author?.id === state.client?.user?.id && !message.interactionMetadata) return;
  scheduleSticky();
}

function scheduleSticky() {
  const now = Date.now();
  if (!state.stickyFirstAt) state.stickyFirstAt = now;
  clearTimeout(state.stickyTimer);
  const remainingMax = STICKY_MAX_WAIT_MS - (now - state.stickyFirstAt);
  const delay = Math.max(0, Math.min(STICKY_DELAY_MS, remainingMax));
  state.stickyTimer = setTimeout(() => {
    repost().catch((e) => log.warn('repost:', e?.message));
  }, delay);
}

/** Saat bot online: pakai panel lama kalau masih di paling bawah, kalau tidak kirim ulang. */
async function bootstrap(client) {
  state.client = client;
  const channel = await resolveChannel();
  if (!channel) {
    log.warn('Channel panel belum diatur. Gunakan /setup-panel di Discord.');
    return;
  }
  const id = store.get('panelMessageId');
  try {
    const last = await channel.messages.fetch({ limit: 1 });
    if (id && last.first()?.id === id) {
      await editNow();
    } else {
      await repost();
    }
  } catch {
    await repost();
  }
}

async function moveTo(channel) {
  const oldChannel = await resolveChannel();
  const oldId = store.get('panelMessageId');
  if (oldChannel && oldId && oldChannel.id !== channel.id) {
    await oldChannel.messages.delete(oldId).catch(() => {});
  }
  store.set('panelChannelId', channel.id);
  store.set('panelMessageId', oldChannel?.id === channel.id ? oldId : null);
  state.channel = channel;
  const p = music.getPlayer();
  if (p) p.textChannelId = channel.id;
  await repost();
}

function startProgressLoop() {
  clearInterval(state.progressTimer);
  state.progressTimer = setInterval(() => {
    const p = music.getPlayer();
    if (p?.queue.current && !p.paused) scheduleUpdate();
    else if (state.notice && state.notice.until <= Date.now()) {
      state.notice = null;
      scheduleUpdate();
    }
  }, PROGRESS_INTERVAL_MS);
  state.progressTimer.unref?.();
}

function stop() {
  clearInterval(state.progressTimer);
  clearTimeout(state.editTimer);
  clearTimeout(state.stickyTimer);
}

module.exports = {
  bootstrap,
  scheduleUpdate,
  onChannelActivity,
  moveTo,
  repost,
  setNotice,
  startProgressLoop,
  stop,
  missingPerms,
};
