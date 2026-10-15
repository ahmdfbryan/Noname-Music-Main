const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const music = require('./music/service');

const filterChoices = Object.entries(music.FILTERS).map(([value, f]) => ({ name: `${f.emoji} ${f.label}`, value }));

const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Putar lagu dari judul, link YouTube, atau link Spotify')
    .addStringOption((o) =>
      o.setName('lagu').setDescription('Judul lagu / link YouTube / link Spotify').setRequired(true).setAutocomplete(true).setMaxLength(500),
    )
    .addBooleanOption((o) => o.setName('berikutnya').setDescription('Taruh di urutan paling depan antrian')),
  new SlashCommandBuilder().setName('pause').setDescription('Jeda / lanjutkan lagu'),
  new SlashCommandBuilder().setName('skip').setDescription('Lewati lagu yang sedang diputar'),
  new SlashCommandBuilder().setName('previous').setDescription('Putar lagu sebelumnya'),
  new SlashCommandBuilder().setName('stop').setDescription('Hentikan musik & kosongkan antrian (bot tetap di voice 24/7)'),
  new SlashCommandBuilder().setName('queue').setDescription('Lihat antrian lagu'),
  new SlashCommandBuilder().setName('nowplaying').setDescription('Lihat lagu yang sedang diputar'),
  new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Atur volume (0 - 150)')
    .addIntegerOption((o) => o.setName('nilai').setDescription('Volume 0 - 150').setRequired(true).setMinValue(0).setMaxValue(150)),
  new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Atur mode loop')
    .addStringOption((o) =>
      o
        .setName('mode')
        .setDescription('Mode loop')
        .setRequired(true)
        .addChoices({ name: '➡️ Mati', value: 'off' }, { name: '🔂 Lagu ini', value: 'track' }, { name: '🔁 Semua antrian', value: 'queue' }),
    ),
  new SlashCommandBuilder()
    .setName('autoplay')
    .setDescription('Nyalakan / matikan autoplay (lagu mirip saat antrian habis)')
    .addBooleanOption((o) => o.setName('aktif').setDescription('true = nyala, false = mati')),
  new SlashCommandBuilder().setName('shuffle').setDescription('Acak urutan antrian'),
  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Hapus lagu dari antrian')
    .addIntegerOption((o) => o.setName('nomor').setDescription('Nomor lagu di antrian').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder()
    .setName('jump')
    .setDescription('Lompat ke lagu tertentu di antrian')
    .addIntegerOption((o) => o.setName('nomor').setDescription('Nomor lagu di antrian').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Loncat ke menit tertentu, contoh: 1:30')
    .addStringOption((o) => o.setName('waktu').setDescription('Format mm:ss atau detik, contoh 1:30 / 90').setRequired(true).setMaxLength(10)),
  new SlashCommandBuilder()
    .setName('filter')
    .setDescription('Pasang efek audio')
    .addStringOption((o) => o.setName('efek').setDescription('Efek audio').setRequired(true).addChoices(...filterChoices)),
  new SlashCommandBuilder().setName('panel').setDescription('Munculkan ulang panel musik di paling bawah channel panel'),
  new SlashCommandBuilder()
    .setName('setup-panel')
    .setDescription('Atur channel untuk panel musik sticky')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Channel teks untuk panel').setRequired(true).addChannelTypes(ChannelType.GuildText),
    ),
  new SlashCommandBuilder().setName('help').setDescription('Panduan memakai bot musik'),
].map((c) => c.toJSON());

module.exports = { commands };
