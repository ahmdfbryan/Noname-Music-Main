// Autoplay: saat antrian habis, cari lagu yang mirip dengan lagu terakhir.
// Strategi: ambil YouTube Mix (radio) dari lagu terakhir, fallback ke lagu lain dari artis yang sama.

const MIN_MS = 60_000; // abaikan video < 1 menit (biasanya shorts/intro)
const MAX_MS = 12 * 60_000; // abaikan video > 12 menit (biasanya kompilasi / live)

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/official|music|video|lyrics?|audio|mv|hd|4k/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();

function isGoodCandidate(t, seenIds, seenTitles) {
  const info = t?.info;
  if (!info || info.isStream) return false;
  if (!info.duration || info.duration < MIN_MS || info.duration > MAX_MS) return false;
  if (seenIds.has(info.identifier)) return false;
  if (seenTitles.has(norm(info.title))) return false;
  return true;
}

async function safeSearch(player, query, requester) {
  try {
    const res = await player.search(query, requester);
    return Array.isArray(res?.tracks) ? res.tracks : [];
  } catch {
    return [];
  }
}

async function autoPlay(player, lastTrack, botUser) {
  if (!lastTrack?.info) return;
  if (player.queue.tracks.length > 0) return;

  const requester = { id: botUser?.id ?? null, username: 'Autoplay', isAutoplay: true };
  const history = [lastTrack, ...player.queue.previous];
  const seenIds = new Set(history.map((t) => t?.info?.identifier).filter(Boolean));
  const seenTitles = new Set(history.map((t) => norm(t?.info?.title)).filter(Boolean));

  // 1) Tentukan "seed" video YouTube.
  let seedId = null;
  if (String(lastTrack.info.sourceName).startsWith('youtube') && /^[\w-]{11}$/.test(lastTrack.info.identifier)) {
    seedId = lastTrack.info.identifier;
  } else {
    const found = await safeSearch(
      player,
      { query: `${lastTrack.info.title} ${lastTrack.info.author}`, source: 'ytsearch' },
      requester,
    );
    seedId = found.find((t) => /^[\w-]{11}$/.test(t?.info?.identifier))?.info.identifier ?? null;
  }

  let candidates = [];
  if (seedId) {
    const mix = await safeSearch(player, { query: `https://www.youtube.com/watch?v=${seedId}&list=RD${seedId}` }, requester);
    candidates = mix.filter((t) => isGoodCandidate(t, seenIds, seenTitles));
  }

  // 2) Fallback: lagu lain dari artis yang sama.
  if (candidates.length === 0 && lastTrack.info.author) {
    const byArtist = await safeSearch(player, { query: lastTrack.info.author, source: 'ytmsearch' }, requester);
    candidates = byArtist.filter((t) => isGoodCandidate(t, seenIds, seenTitles));
  }

  if (candidates.length === 0) return;

  // Ambil acak dari 8 teratas supaya tidak monoton, tambah 2 lagu sekaligus.
  const pool = candidates.slice(0, 8);
  const picks = [];
  while (pool.length && picks.length < 2) {
    const [t] = pool.splice(Math.floor(Math.random() * pool.length), 1);
    if (!picks.some((p) => norm(p.info.title) === norm(t.info.title))) picks.push(t);
  }
  if (player.queue.tracks.length === 0 && picks.length) await player.queue.add(picks);
}

module.exports = { autoPlay };
