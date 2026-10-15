// Penyusun tampilan panel musik dengan Discord Components V2.
const {
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} = require('discord.js');
const { config } = require('../config');
const store = require('../store');
const music = require('../music/service');
const { formatTime, safe, trackLink, progressBar, sourceLabel, artworkOf, isHttpUrl } = require('../utils/format');

const ID = {
  prev: 'music:prev',
  pause: 'music:pause',
  skip: 'music:skip',
  stop: 'music:stop',
  shuffle: 'music:shuffle',
  voldown: 'music:voldown',
  volup: 'music:volup',
  loop: 'music:loop',
  autoplay: 'music:autoplay',
  queue: 'music:queue',
  add: 'music:add',
  clear: 'music:clear',
  refresh: 'music:refresh',
  filter: 'music:filter',
  addModal: 'music:addmodal',
  addInput: 'music:addinput',
  queuePage: 'music:qpage', // music:qpage:<page>
};

const LOOP_ICON = { off: '➡️', track: '🔂', queue: '🔁' };

function requesterText(track) {
  const r = track?.requester;
  if (!r) return 'Tidak diketahui';
  if (r.isAutoplay) return '✨ Autoplay';
  return r.id ? `<@${r.id}>` : safe(r.username || 'Member', 32);
}

function sep(divider = true, large = false) {
  return new SeparatorBuilder().setDivider(divider).setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
}

function btn(id, emoji, { label, style = ButtonStyle.Secondary, disabled = false } = {}) {
  const b = new ButtonBuilder().setCustomId(id).setEmoji(emoji).setStyle(style).setDisabled(disabled);
  if (label) b.setLabel(label);
  return b;
}

/**
 * @param {object} opts
 * @param {{text:string}|null} opts.notice  pesan status singkat (opsional)
 */
function buildPanel({ notice = null, botAvatar = null } = {}) {
  const player = music.getPlayer();
  const online = music.nodeReady();
  const track = player?.queue.current ?? null;
  const upcoming = player?.queue.tracks ?? [];
  const volume = Number.isFinite(player?.volume) ? player.volume : music.currentVolume();
  const loop = player?.repeatMode || 'off';
  const autoplay = !!store.get('autoplay');
  const filter = store.get('filter') || 'normal';
  const paused = !!player?.paused;
  const autoPaused = !!player?.getData?.('autoPaused');
  const hasTrack = !!track;

  const container = new ContainerBuilder().setAccentColor(online ? config.panelColor : 0xef4444);

  // ── Header
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## 🎧 ${config.brand.name}\n-# ${config.brand.server} • Standby 24/7 di <#${config.voiceChannelId}>`,
    ),
  );
  container.addSeparatorComponents(sep());

  // ── Now playing
  if (!online) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '### 🔌 Server audio sedang offline\nBot sedang menyambung ulang ke Lavalink secara otomatis. Panel akan aktif lagi dengan sendirinya.',
      ),
    );
  } else if (hasTrack) {
    const info = track.info || {};
    const isStream = !!info.isStream;
    const pos = Math.min(player.position || 0, info.duration || Infinity);
    const statusIcon = paused ? '⏸️' : '▶️';
    const statusText = autoPaused ? 'Dijeda otomatis (voice kosong)' : paused ? 'Dijeda' : 'Sedang diputar';

    const npText =
      `-# ${statusIcon} ${statusText.toUpperCase()}\n` +
      `### ${trackLink(track, 70)}\n` +
      `👤 ${safe(info.author || 'Unknown', 50)}\n` +
      `-# Diminta oleh ${requesterText(track)} • ${sourceLabel(track)}`;

    const art = artworkOf(track) || botAvatar;
    if (art && isHttpUrl(art)) {
      container.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(npText))
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(art).setDescription(safe(info.title || 'Artwork', 100))),
      );
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(npText));
    }

    const bar = isStream
      ? '`🔴 LIVE` ━━━━━━━━━━━━━━━━'
      : `\`${formatTime(pos)}\` ${progressBar(pos, info.duration)} \`${formatTime(info.duration)}\``;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(bar));
  } else {
    const idle =
      '### 💤 Belum ada lagu yang diputar\n' +
      'Klik **➕ Tambah Lagu** di bawah atau ketik `/play` lalu masukkan judul / link **YouTube** atau **Spotify**.';
    if (botAvatar && isHttpUrl(botAvatar)) {
      container.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(idle))
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(botAvatar)),
      );
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(idle));
    }
  }

  // ── Status chips
  const filterInfo = music.FILTERS[filter] || music.FILTERS.normal;
  const chips = [
    `${volume === 0 ? '🔇' : volume < 50 ? '🔉' : '🔊'} ${volume}%`,
    `${LOOP_ICON[loop] || '➡️'} Loop ${music.LOOP_LABEL[loop] || 'Mati'}`,
    `✨ Autoplay ${autoplay ? 'On' : 'Off'}`,
    `${filterInfo.emoji} ${filterInfo.label}`,
  ];
  let statusLine = `-# ${chips.join('  •  ')}`;
  if (notice?.text) statusLine += `\n> ${notice.text}`;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statusLine));

  container.addSeparatorComponents(sep());

  // ── Up next
  if (online) {
    let queueText;
    if (upcoming.length === 0) {
      queueText = autoplay && hasTrack
        ? '**📃 Selanjutnya**\n-# Antrian kosong — ✨ Autoplay akan memilihkan lagu mirip.'
        : '**📃 Selanjutnya**\n-# Antrian kosong.';
    } else {
      const total = upcoming.reduce((a, t) => a + (t?.info?.isStream ? 0 : t?.info?.duration || 0), 0);
      const lines = upcoming.slice(0, 5).map((t, i) => {
        const dur = t?.info?.isStream ? 'LIVE' : formatTime(t?.info?.duration);
        const tag = t?.requester?.isAutoplay ? ' ✨' : '';
        return `\`${String(i + 1).padStart(2, '0')}\` ${safe(t?.info?.title || 'Tanpa judul', 48)} — \`${dur}\`${tag}`;
      });
      const more = upcoming.length > 5 ? `\n-# …dan ${upcoming.length - 5} lagu lainnya` : '';
      queueText = `**📃 Selanjutnya** · ${upcoming.length} lagu · ${formatTime(total)}\n${lines.join('\n')}${more}`;
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(queueText));
    container.addSeparatorComponents(sep(false));
  }

  // ── Kontrol
  const off = !online;
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      btn(ID.prev, '⏮️', { disabled: off || (!hasTrack && !(player?.queue.previous?.length > 0)) }),
      btn(ID.pause, paused ? '▶️' : '⏸️', { style: ButtonStyle.Primary, disabled: off || !hasTrack }),
      btn(ID.skip, '⏭️', { disabled: off || !hasTrack }),
      btn(ID.stop, '⏹️', { style: ButtonStyle.Danger, disabled: off || (!hasTrack && upcoming.length === 0) }),
      btn(ID.shuffle, '🔀', { disabled: off || upcoming.length < 2 }),
    ),
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      btn(ID.voldown, '🔉', { disabled: off || volume <= 0 }),
      btn(ID.volup, '🔊', { disabled: off || volume >= config.maxVolume }),
      btn(ID.loop, LOOP_ICON[loop] || '🔁', {
        style: loop === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success,
        disabled: off,
      }),
      btn(ID.autoplay, '✨', { style: autoplay ? ButtonStyle.Success : ButtonStyle.Secondary, disabled: off }),
      btn(ID.queue, '📜', { disabled: off }),
    ),
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(ID.filter)
    .setPlaceholder('🎛️ Pilih efek audio')
    .setDisabled(off)
    .addOptions(
      Object.entries(music.FILTERS).map(([key, f]) =>
        new StringSelectMenuOptionBuilder()
          .setValue(key)
          .setLabel(f.label)
          .setDescription(f.desc)
          .setEmoji(f.emoji)
          .setDefault(key === filter),
      ),
    );
  container.addActionRowComponents(new ActionRowBuilder().addComponents(select));

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      btn(ID.add, '➕', { label: 'Tambah Lagu', style: ButtonStyle.Success, disabled: off }),
      btn(ID.clear, '🗑️', { label: 'Kosongkan', disabled: off || upcoming.length === 0 }),
      btn(ID.refresh, '🔄', { label: 'Refresh' }),
    ),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# 🔒 Kontrol khusus member di <#${config.voiceChannelId}> • Panel diperbarui otomatis • <t:${Math.floor(Date.now() / 1000)}:R>`,
    ),
  );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    allowedMentions: { parse: [] },
  };
}

/** Tampilan antrian lengkap (ephemeral, dengan halaman). */
function buildQueueView(page = 0) {
  const player = music.getPlayer();
  const tracks = player?.queue.tracks ?? [];
  const per = 10;
  const pages = Math.max(1, Math.ceil(tracks.length / per));
  const p = Math.min(Math.max(0, page), pages - 1);

  const container = new ContainerBuilder().setAccentColor(config.panelColor);
  const current = player?.queue.current;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## 📜 Antrian Musik\n${current ? `**Sedang diputar:** ${trackLink(current, 60)} — ${requesterText(current)}` : '-# Tidak ada lagu yang diputar.'}`,
    ),
  );
  container.addSeparatorComponents(sep());

  if (tracks.length === 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Antrian kosong. Tambahkan lagu dengan `/play`.'));
  } else {
    const lines = tracks.slice(p * per, p * per + per).map((t, i) => {
      const n = p * per + i + 1;
      const dur = t?.info?.isStream ? 'LIVE' : formatTime(t?.info?.duration);
      return `\`${String(n).padStart(3, ' ')}\` ${trackLink(t, 50)} \`${dur}\`\n-# ↳ ${requesterText(t)}`;
    });
    const total = tracks.reduce((a, t) => a + (t?.info?.isStream ? 0 : t?.info?.duration || 0), 0);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
    container.addSeparatorComponents(sep(false));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# Halaman ${p + 1}/${pages} • ${tracks.length} lagu • total ${formatTime(total)}`),
    );
    if (pages > 1) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          btn(`${ID.queuePage}:${p - 1}`, '◀️', { disabled: p === 0 }),
          btn(`${ID.queuePage}:${p + 1}`, '▶️', { disabled: p >= pages - 1 }),
        ),
      );
    }
  }

  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [container],
    allowedMentions: { parse: [] },
  };
}

/** Pesan singkat ephemeral bergaya V2. */
function buildNotice(text, { error = false } = {}) {
  const container = new ContainerBuilder()
    .setAccentColor(error ? 0xef4444 : config.panelColor)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [container],
    allowedMentions: { parse: [] },
  };
}

module.exports = { buildPanel, buildQueueView, buildNotice, ID };
