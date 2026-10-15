const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const music = require('../music/service');
const sticky = require('../panel/sticky');
const { buildPanel, buildQueueView, buildNotice, ID } = require('../panel/build');
const { UserError } = require('../utils/errors');
const { config } = require('../config');
const log = require('../utils/logger');
const { safe, formatTime, isHttpUrl, truncate, trackLink } = require('../utils/format');

/* ------------------------------ helper ------------------------------ */

/** Payload untuk edit (flag Ephemeral tidak boleh dikirim saat edit). */
function asEdit(payload) {
  return { ...payload, flags: MessageFlags.IsComponentsV2 };
}

function errorText(err) {
  if (err instanceof UserError) return `❌ ${err.message}`;
  log.error('Interaction error:', err);
  return '❌ Terjadi kesalahan. Coba lagi sebentar ya.';
}

async function safeRespond(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      // Balasan ephemeral tambahan
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (err) {
    log.warn('Gagal membalas interaksi:', err?.message);
  }
}

function parseTime(input) {
  const s = String(input || '').trim();
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  const parts = s.split(':').map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0) * 1000;
}

function addedText(result, user) {
  const who = `<@${user.id}>`;
  if (result.isPlaylist) {
    const name = result.playlistName ? `**${safe(result.playlistName, 60)}**` : 'playlist';
    return `📥 ${who} menambahkan ${result.count} lagu dari ${name}${result.trimmed ? ' (dipotong karena antrian penuh)' : ''}`;
  }
  const where = result.position === 0 ? 'diputar sekarang' : `antrian #${result.position}`;
  return `🎶 ${who} menambahkan ${trackLink(result.first, 55)} — ${where}`;
}

const CONTROL_ACTIONS = {
  [ID.prev]: () => music.previous(),
  [ID.pause]: () => music.togglePause(),
  [ID.skip]: () => music.skip(),
  [ID.stop]: () => music.stop(),
  [ID.shuffle]: () => music.shuffle(),
  [ID.voldown]: () => music.setVolume(-10, { relative: true }),
  [ID.volup]: () => music.setVolume(10, { relative: true }),
  [ID.loop]: () => music.cycleLoop(),
  [ID.autoplay]: () => music.setAutoplay(),
  [ID.clear]: () => music.clearQueue(),
};

/* ------------------------------ tombol ------------------------------ */

async function handleButton(interaction) {
  const id = interaction.customId;

  if (id.startsWith(`${ID.queuePage}:`)) {
    const page = Number.parseInt(id.split(':')[2], 10) || 0;
    return interaction.update(asEdit(buildQueueView(page)));
  }

  if (id === ID.queue) return interaction.reply(buildQueueView(0));

  if (id === ID.refresh) {
    await interaction.deferUpdate();
    sticky.scheduleUpdate();
    return;
  }

  if (!music.nodeReady()) {
    return safeRespond(interaction, buildNotice('🔌 Server audio sedang offline, tunggu sebentar ya.', { error: true }));
  }

  const denied = music.controlError(interaction.member);
  if (denied) return safeRespond(interaction, buildNotice(denied, { error: true }));

  if (id === ID.add) return interaction.showModal(buildAddModal());

  const action = CONTROL_ACTIONS[id];
  if (!action) return safeRespond(interaction, buildNotice('Tombol ini sudah tidak berlaku.', { error: true }));

  await interaction.deferUpdate();
  try {
    const msg = await action();
    sticky.setNotice(`${msg} — oleh <@${interaction.user.id}>`);
  } catch (err) {
    await safeRespond(interaction, buildNotice(errorText(err), { error: true }));
    sticky.scheduleUpdate();
  }
}

function buildAddModal() {
  const input = new TextInputBuilder()
    .setCustomId(ID.addInput)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Contoh: Tulus - Hati-Hati di Jalan / link YouTube / link Spotify')
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(500);
  return new ModalBuilder()
    .setCustomId(ID.addModal)
    .setTitle('➕ Tambah Lagu')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Judul lagu atau link')
        .setDescription('Mendukung YouTube, YouTube Music, Spotify (lagu/album/playlist)')
        .setTextInputComponent(input),
    );
}

/* ------------------------------ select & modal ------------------------------ */

async function handleSelect(interaction) {
  if (interaction.customId !== ID.filter) return;
  if (!music.nodeReady()) {
    return safeRespond(interaction, buildNotice('🔌 Server audio sedang offline.', { error: true }));
  }
  const denied = music.controlError(interaction.member);
  if (denied) {
    await safeRespond(interaction, buildNotice(denied, { error: true }));
    sticky.scheduleUpdate(); // kembalikan pilihan select ke kondisi semula
    return;
  }
  await interaction.deferUpdate();
  try {
    const msg = await music.setFilter(interaction.values[0]);
    sticky.setNotice(`${msg} — oleh <@${interaction.user.id}>`);
  } catch (err) {
    await safeRespond(interaction, buildNotice(errorText(err), { error: true }));
    sticky.scheduleUpdate();
  }
}

async function handleModal(interaction) {
  if (interaction.customId !== ID.addModal) return;
  const denied = music.controlError(interaction.member);
  if (denied) return safeRespond(interaction, buildNotice(denied, { error: true }));

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const query = interaction.fields.getTextInputValue(ID.addInput);
    const result = await music.enqueue(query, interaction.user);
    const text = addedText(result, interaction.user);
    sticky.setNotice(text);
    await interaction.editReply(asEdit(buildNotice(text)));
  } catch (err) {
    await interaction.editReply(asEdit(buildNotice(errorText(err), { error: true }))).catch(() => {});
  }
}

/* ------------------------------ autocomplete ------------------------------ */

async function handleAutocomplete(interaction) {
  if (interaction.commandName !== 'play') return interaction.respond([]).catch(() => {});
  const value = String(interaction.options.getFocused() || '').trim();
  try {
    if (value.length < 2) {
      return await interaction.respond([]);
    }
    if (isHttpUrl(value)) {
      return await interaction.respond(
        value.length <= 100 ? [{ name: truncate(`🔗 Putar link: ${value}`, 100), value }] : [],
      );
    }
    const player = music.getPlayer();
    if (!player || !music.nodeReady()) return await interaction.respond([]);

    const res = await Promise.race([
      player.search({ query: value, source: config.defaultSearch }, interaction.user),
      new Promise((resolve) => setTimeout(() => resolve(null), 2_300)),
    ]).catch(() => null);

    const choices = (res?.tracks || [])
      .filter((t) => t?.info?.title)
      .slice(0, 10)
      .map((t) => {
        const dur = t.info.isStream ? 'LIVE' : formatTime(t.info.duration);
        const name = truncate(`${t.info.title} — ${t.info.author} [${dur}]`, 100);
        const v = t.info.uri && t.info.uri.length <= 100 ? t.info.uri : truncate(`${t.info.title} ${t.info.author}`, 100);
        return { name, value: v };
      });
    await interaction.respond(choices);
  } catch {
    await interaction.respond([]).catch(() => {});
  }
}

/* ------------------------------ slash command ------------------------------ */

const NEEDS_CONTROL = new Set([
  'play',
  'pause',
  'skip',
  'previous',
  'stop',
  'volume',
  'loop',
  'autoplay',
  'shuffle',
  'remove',
  'jump',
  'seek',
  'filter',
]);

async function handleCommand(interaction) {
  const name = interaction.commandName;
  const reply = (text, error = false) => safeRespond(interaction, buildNotice(text, { error }));

  if (NEEDS_CONTROL.has(name)) {
    const denied = music.controlError(interaction.member);
    if (denied) return reply(denied, true);
  }

  try {
    switch (name) {
      case 'play': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const query = interaction.options.getString('lagu', true);
        const next = interaction.options.getBoolean('berikutnya') ?? false;
        const result = await music.enqueue(query, interaction.user, { next });
        const text = addedText(result, interaction.user);
        sticky.setNotice(text);
        return interaction.editReply(asEdit(buildNotice(text)));
      }
      case 'pause':
        return done(interaction, await music.togglePause());
      case 'skip':
        return done(interaction, await music.skip());
      case 'previous':
        return done(interaction, await music.previous());
      case 'stop':
        return done(interaction, await music.stop());
      case 'shuffle':
        return done(interaction, await music.shuffle());
      case 'volume':
        return done(interaction, await music.setVolume(interaction.options.getInteger('nilai', true)));
      case 'loop':
        return done(interaction, await music.cycleLoop(interaction.options.getString('mode', true)));
      case 'autoplay': {
        const v = interaction.options.getBoolean('aktif');
        return done(interaction, await music.setAutoplay(typeof v === 'boolean' ? v : undefined));
      }
      case 'remove':
        return done(interaction, await music.removeAt(interaction.options.getInteger('nomor', true)));
      case 'jump':
        return done(interaction, await music.jumpTo(interaction.options.getInteger('nomor', true)));
      case 'seek': {
        const ms = parseTime(interaction.options.getString('waktu', true));
        if (ms === null) throw new UserError('Format waktu salah. Contoh: `1:30` atau `90`.');
        const pos = await music.seekTo(ms);
        return done(interaction, `⏩ Loncat ke **${formatTime(pos)}**.`);
      }
      case 'filter':
        return done(interaction, await music.setFilter(interaction.options.getString('efek', true)));
      case 'queue':
        return interaction.reply(buildQueueView(0));
      case 'nowplaying': {
        const p = buildPanel({ botAvatar: interaction.client.user.displayAvatarURL({ extension: 'png', size: 256 }) });
        // Versi ephemeral tanpa tombol supaya tidak dobel kontrol.
        const container = p.components[0];
        container.components = container.components.filter((c) => c.data?.type !== 1);
        return interaction.reply({ ...p, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      }
      case 'panel': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await sticky.repost();
        return interaction.editReply(asEdit(buildNotice('✅ Panel dimunculkan ulang di paling bawah channel panel.')));
      }
      case 'setup-panel': {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          throw new UserError('Hanya admin (Manage Server) yang bisa mengatur panel.');
        }
        const channel = interaction.options.getChannel('channel', true);
        if (channel.type !== ChannelType.GuildText) throw new UserError('Pilih channel teks biasa.');
        const missing = sticky.missingPerms(channel);
        if (missing.length) throw new UserError(`Bot butuh izin di ${channel}: ${missing.join(', ')}`);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await sticky.moveTo(channel);
        return interaction.editReply(
          asEdit(
            buildNotice(
              `✅ Panel musik dipasang di ${channel}.\nPanel akan selalu pindah ke paling bawah saat ada chat baru.` +
                (config.requestChannelMode ? '\nMode request aktif: ketik judul lagu langsung di channel itu.' : ''),
            ),
          ),
        );
      }
      case 'help':
        return interaction.reply(buildNotice(helpText()));
      default:
        return reply('Command tidak dikenal.', true);
    }
  } catch (err) {
    const payload = buildNotice(errorText(err), { error: true });
    if (interaction.deferred) return interaction.editReply(asEdit(payload)).catch(() => {});
    return safeRespond(interaction, payload);
  }
}

async function done(interaction, text) {
  sticky.setNotice(`${text} — oleh <@${interaction.user.id}>`);
  return interaction.reply(buildNotice(text));
}

function helpText() {
  return [
    `## 🎧 Panduan ${config.brand.name}`,
    `Bot standby **24/7** di <#${config.voiceChannelId}>. Masuk ke voice itu dulu untuk mengontrol musik.`,
    '',
    '**🎵 Putar lagu**',
    '`/play` — judul lagu, link YouTube / YouTube Music / Spotify (lagu, album, playlist)',
    'Atau klik **➕ Tambah Lagu** di panel.',
    '',
    '**🎛️ Kontrol**',
    '`/pause` `/skip` `/previous` `/stop` `/shuffle` `/volume` `/loop` `/autoplay`',
    '`/queue` `/remove` `/jump` `/seek` `/filter` `/nowplaying`',
    '',
    '**⚙️ Admin**',
    '`/setup-panel` — pasang panel sticky • `/panel` — munculkan ulang panel',
    '',
    '-# ✨ Autoplay memutar lagu mirip saat antrian habis • ⏸️ Musik otomatis dijeda kalau voice kosong',
  ].join('\n');
}

/* ------------------------------ router ------------------------------ */

async function onInteraction(interaction) {
  if (interaction.guildId !== music.ctx.guildId) {
    if (interaction.isRepliable()) {
      await interaction.reply(buildNotice('Bot ini khusus server Noname Studios Creative.', { error: true })).catch(() => {});
    }
    return;
  }
  try {
    if (interaction.isAutocomplete()) return await handleAutocomplete(interaction);
    if (interaction.isChatInputCommand()) return await handleCommand(interaction);
    if (interaction.isButton() && interaction.customId.startsWith('music:')) return await handleButton(interaction);
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('music:')) return await handleSelect(interaction);
    if (interaction.isModalSubmit() && interaction.customId.startsWith('music:')) return await handleModal(interaction);
  } catch (err) {
    log.error('Handler interaksi gagal:', err);
    if (interaction.isRepliable()) await safeRespond(interaction, buildNotice(errorText(err), { error: true }));
  }
}

module.exports = { onInteraction, parseTime, buildAddModal };
