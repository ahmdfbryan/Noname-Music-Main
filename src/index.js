const { Client, GatewayIntentBits, Partials, Events, ActivityType, PermissionFlagsBits } = require('discord.js');
const { config, validateConfig } = require('./config');
const store = require('./store');
const log = require('./utils/logger');
const music = require('./music/service');
const sticky = require('./panel/sticky');
const { createManager } = require('./music/manager');
const { commands } = require('./commands');
const { onInteraction } = require('./handlers/interactions');
const { safe } = require('./utils/format');

const problems = validateConfig();
if (problems.length) {
  for (const p of problems) log.error(p);
  process.exit(1);
}

store.load();
if (config.panelChannelId && !store.get('panelChannelId')) store.set('panelChannelId', config.panelChannelId);

const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages];
if (config.requestChannelMode) intents.push(GatewayIntentBits.MessageContent);

const client = new Client({ intents, partials: [Partials.Message] });
const manager = createManager(client);

let keepAliveTimer = null;

/* ----------------------------- Discord events ----------------------------- */

client.on(Events.Raw, (d) => {
  manager.sendRawData(d).catch(() => {});
});

client.once(Events.ClientReady, async () => {
  log.info(`Login sebagai ${client.user.tag}`);

  // Cari server dari voice channel yang ditentukan (tidak perlu GUILD_ID).
  let voice;
  try {
    voice = await client.channels.fetch(config.voiceChannelId);
  } catch {
    voice = null;
  }
  if (!voice || !voice.isVoiceBased?.()) {
    log.error(`Voice channel ${config.voiceChannelId} tidak ditemukan / bukan voice channel. Pastikan bot sudah diundang ke server.`);
    process.exit(1);
  }
  const guild = voice.guild;
  log.info(`Server: ${guild.name} • Voice: #${voice.name}`);

  const perms = voice.permissionsFor(guild.members.me);
  for (const [flag, label] of [
    [PermissionFlagsBits.ViewChannel, 'View Channel'],
    [PermissionFlagsBits.Connect, 'Connect'],
    [PermissionFlagsBits.Speak, 'Speak'],
  ]) {
    if (!perms?.has(flag)) log.warn(`Bot TIDAK punya izin "${label}" di voice #${voice.name}`);
  }

  music.init({ client, manager, guildId: guild.id, onChange: () => sticky.scheduleUpdate() });

  try {
    await guild.commands.set(commands);
    log.info(`${commands.length} slash command terdaftar di ${guild.name}.`);
  } catch (err) {
    log.error('Gagal mendaftarkan slash command:', err?.message || err);
  }

  client.user.setPresence({
    activities: [{ name: '🎧 /play • 24/7', type: ActivityType.Listening }],
    status: 'online',
  });

  await manager.init({ id: client.user.id, username: client.user.username });

  await sticky.bootstrap(client).catch((e) => log.warn('Bootstrap panel gagal:', e?.message));
  sticky.startProgressLoop();

  // Penjaga 24/7: cek tiap 30 detik bot tetap di voice channel.
  clearInterval(keepAliveTimer);
  keepAliveTimer = setInterval(() => music.keepAlive(), 30_000);
});

client.on(Events.InteractionCreate, (i) => {
  onInteraction(i).catch((e) => log.error('Interaksi:', e));
});

client.on(Events.MessageCreate, async (message) => {
  if (!music.ctx.guildId || message.guildId !== music.ctx.guildId) return;
  sticky.onChannelActivity(message);

  if (!config.requestChannelMode) return;
  if (message.author.bot || message.channelId !== store.get('panelChannelId')) return;
  const query = message.content?.trim();
  if (!query) return;

  const canDelete = message.channel.permissionsFor(message.guild.members.me)?.has(PermissionFlagsBits.ManageMessages);
  const cleanup = (ms) => {
    if (canDelete) setTimeout(() => message.delete().catch(() => {}), ms);
  };

  const denied = music.controlError(message.member);
  if (denied) {
    await message.react('🎧').catch(() => {});
    cleanup(4_000);
    return;
  }
  try {
    await message.react('⏳').catch(() => {});
    const res = await music.enqueue(query, message.author);
    sticky.setNotice(
      res.isPlaylist
        ? `📥 <@${message.author.id}> menambahkan ${res.count} lagu dari playlist`
        : `🎶 <@${message.author.id}> menambahkan **${safe(res.first?.info?.title, 55)}**`,
    );
    await message.react('✅').catch(() => {});
  } catch (err) {
    await message.react('❌').catch(() => {});
    if (err?.name === 'UserError') sticky.setNotice(`❌ ${err.message}`, 10_000);
  }
  cleanup(3_000);
});

client.on(Events.MessageDelete, (message) => {
  if (message.id && message.id === store.get('panelMessageId')) {
    store.set('panelMessageId', null);
    setTimeout(() => sticky.repost().catch(() => {}), 1_500);
  }
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  if (!music.ctx.guildId || newState.guild.id !== music.ctx.guildId) return;
  const vc = config.voiceChannelId;
  if (oldState.channelId === vc || newState.channelId === vc) {
    // beri jeda kecil agar cache member voice sudah ter-update
    setTimeout(() => music.syncAutoPause(), 1_000);
  }
});

client.on(Events.Error, (err) => log.error('Discord client error:', err?.message || err));
client.on(Events.ShardDisconnect, () => log.warn('Koneksi gateway Discord terputus, menyambung ulang...'));
client.on(Events.ShardResume, () => log.info('Koneksi gateway Discord tersambung kembali.'));

/* ----------------------------- Lavalink events ----------------------------- */

manager.nodeManager.on('connect', () => {
  sticky.scheduleUpdate();
  // sessionId dikirim Lavalink sesaat setelah koneksi terbuka
  setTimeout(() => music.recoverAfterNodeRestart().catch(() => {}), 2_500);
});
manager.nodeManager.on('disconnect', () => sticky.scheduleUpdate());

manager.on('trackStart', (player, track) => {
  log.info(`▶ ${track?.info?.title} — ${track?.info?.author}`);
  sticky.scheduleUpdate();
});
manager.on('trackEnd', () => sticky.scheduleUpdate());
manager.on('queueEnd', () => sticky.scheduleUpdate());
manager.on('playerPaused', () => sticky.scheduleUpdate());
manager.on('playerResumed', () => sticky.scheduleUpdate());
manager.on('trackError', (player, track, payload) => {
  const reason = payload?.exception?.message || payload?.message || 'tidak diketahui';
  log.warn(`Gagal memutar "${track?.info?.title}": ${reason}`);
  sticky.setNotice(`⚠️ Gagal memutar **${safe(track?.info?.title || 'lagu', 50)}**, lanjut ke berikutnya.`, 15_000);
});
manager.on('trackStuck', (player, track) => {
  log.warn(`Lagu macet: ${track?.info?.title}`);
  sticky.setNotice(`⚠️ **${safe(track?.info?.title || 'Lagu', 50)}** macet, dilewati.`, 15_000);
});
manager.on('playerSocketClosed', (player, payload) => {
  log.warn(`Voice socket ditutup (code ${payload?.code}): ${payload?.reason || ''}`);
});
manager.on('playerMove', async (player, oldId, newId) => {
  if (newId && newId !== config.voiceChannelId) {
    log.warn(`Bot dipindah ke channel lain (${newId}), kembali ke voice 24/7...`);
    setTimeout(async () => {
      try {
        player.options.voiceChannelId = config.voiceChannelId;
        player.voiceChannelId = config.voiceChannelId;
        await player.connect();
      } catch (e) {
        log.warn('Gagal kembali ke voice 24/7:', e?.message);
      }
    }, 1_500);
  }
});
manager.on('playerDestroy', (player, reason) => {
  log.warn(`Player dihancurkan (${reason || 'tanpa alasan'}), membuat ulang...`);
  sticky.scheduleUpdate();
  if (!music.ctx.shuttingDown && !music.ctx.recovering) setTimeout(() => music.keepAlive(), 3_000);
});

/* ----------------------------- Proses ----------------------------- */

async function shutdown(signal) {
  if (music.ctx.shuttingDown) return;
  music.ctx.shuttingDown = true;
  log.info(`Menerima ${signal}, mematikan bot dengan aman...`);
  clearInterval(keepAliveTimer);
  sticky.stop();
  store.flush();
  try {
    client.destroy();
  } catch {}
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => log.error('Unhandled rejection:', err?.stack || err));
process.on('uncaughtException', (err) => log.error('Uncaught exception:', err?.stack || err));

client.login(config.token).catch((err) => {
  if (String(err?.message).includes('disallowed intents')) {
    log.error('Intent belum diizinkan. Nyalakan "Message Content Intent" di Developer Portal atau set REQUEST_CHANNEL_MODE=false.');
  } else {
    log.error('Login gagal:', err?.message || err);
  }
  process.exit(1);
});
