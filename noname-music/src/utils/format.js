const { escapeMarkdown } = require('discord.js');

function formatTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function truncate(text, max) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Teks aman untuk markdown Discord (termasuk di dalam masked link). */
function safe(text, max = 80) {
  return escapeMarkdown(truncate(text, max)).replace(/[[\]]/g, (c) => (c === '[' ? '⁅' : '⁆'));
}

function isHttpUrl(u) {
  if (typeof u !== 'string') return false;
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch {
    return false;
  }
}

function trackLink(track, max = 70) {
  const title = safe(track?.info?.title || 'Tanpa judul', max);
  const uri = track?.info?.uri;
  return isHttpUrl(uri) ? `[${title}](<${uri}>)` : title;
}

function progressBar(position, duration, size = 16) {
  if (!duration || duration <= 0) return '─'.repeat(size);
  const ratio = Math.min(Math.max(position / duration, 0), 1);
  const head = Math.min(Math.round(ratio * (size - 1)), size - 1);
  return `${'━'.repeat(head)}●${'─'.repeat(size - head - 1)}`;
}

const SOURCE_LABEL = {
  youtube: 'YouTube',
  youtubemusic: 'YouTube Music',
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  applemusic: 'Apple Music',
  deezer: 'Deezer',
  http: 'Link langsung',
};

function sourceLabel(track) {
  const s = String(track?.info?.sourceName || '').toLowerCase();
  return SOURCE_LABEL[s] || (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Tidak diketahui');
}

function artworkOf(track) {
  const art = track?.info?.artworkUrl;
  if (isHttpUrl(art)) return art;
  const id = track?.info?.identifier;
  if (String(track?.info?.sourceName).startsWith('youtube') && /^[\w-]{11}$/.test(id || '')) {
    return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  }
  return null;
}

module.exports = { formatTime, truncate, safe, isHttpUrl, trackLink, progressBar, sourceLabel, artworkOf };
