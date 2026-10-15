// Self-test tanpa koneksi Discord/Lavalink: memastikan semua modul termuat dan
// payload Components V2 valid (batas komponen & panjang teks).
process.env.DISCORD_TOKEN ||= 'test';
const assert = require('node:assert');
const store = require('../src/store');
const music = require('../src/music/service');
const { buildPanel, buildQueueView, buildNotice } = require('../src/panel/build');
const { commands } = require('../src/commands');
const { parseTime, buildAddModal } = require('../src/handlers/interactions');
const { progressBar, formatTime, safe } = require('../src/utils/format');

store.load();

function countComponents(list) {
  let n = 0;
  for (const c of list) {
    n += 1;
    if (Array.isArray(c.components)) n += countComponents(c.components);
    if (c.accessory) n += 1;
  }
  return n;
}
function textLength(list) {
  let n = 0;
  for (const c of list) {
    if (typeof c.content === 'string') n += c.content.length;
    if (Array.isArray(c.components)) n += textLength(c.components);
  }
  return n;
}
function check(name, payload) {
  const json = payload.components.map((c) => c.toJSON());
  const count = countComponents(json);
  const len = textLength(json);
  assert(count <= 40, `${name}: komponen ${count} > 40`);
  assert(len <= 4000, `${name}: teks ${len} > 4000`);
  console.log(`✔ ${name.padEnd(28)} komponen=${count} teks=${len}`);
  return json;
}

const longTitle = 'Judul Lagu Yang Sangat Panjang [Official Music Video] (Live) *spesial* _edisi_ ~tilde~ '.repeat(3);
const mkTrack = (i, extra = {}) => ({
  encoded: 'x',
  info: {
    title: `${longTitle} #${i}`,
    author: 'Artis Keren',
    duration: 200_000 + i * 1000,
    uri: `https://www.youtube.com/watch?v=abcdefghij${i % 10}`,
    identifier: `abcdefghij${i % 10}`,
    sourceName: 'youtube',
    isStream: false,
    isSeekable: true,
    artworkUrl: null,
    ...extra,
  },
  requester: i % 3 === 0 ? { id: null, username: 'Autoplay', isAutoplay: true } : { id: '123456789012345678', username: 'Ahmad' },
});

const data = new Map();
const fakePlayer = {
  queue: { current: mkTrack(0), tracks: Array.from({ length: 120 }, (_, i) => mkTrack(i + 1)), previous: [mkTrack(99)] },
  position: 95_000,
  paused: false,
  volume: 80,
  repeatMode: 'queue',
  getData: (k) => data.get(k),
};

// Mock manager
let online = true;
music.init({
  client: { guilds: { cache: new Map() } },
  guildId: '1',
  manager: {
    getPlayer: () => fakePlayer,
    nodeManager: { nodes: new Map([['main', { get connected() { return online; }, sessionId: 'abc' }]]) },
  },
});

const avatar = 'https://cdn.discordapp.com/embed/avatars/0.png';
check('panel: playing + 120 antrian', buildPanel({ botAvatar: avatar, notice: { text: '🎶 <@1> menambahkan lagu' } }));

fakePlayer.paused = true;
data.set('autoPaused', true);
check('panel: auto-paused', buildPanel({ botAvatar: avatar }));

fakePlayer.queue.current.info.isStream = true;
check('panel: live stream', buildPanel({ botAvatar: avatar }));

fakePlayer.queue.current = null;
fakePlayer.queue.tracks = [];
check('panel: idle', buildPanel({ botAvatar: avatar }));
check('panel: idle tanpa avatar', buildPanel({}));

online = false;
check('panel: lavalink offline', buildPanel({ botAvatar: avatar }));
online = true;

fakePlayer.queue.tracks = Array.from({ length: 37 }, (_, i) => mkTrack(i, { uri: `https://open.spotify.com/track/${'x'.repeat(22)}`, sourceName: 'spotify' }));
fakePlayer.queue.current = mkTrack(1, { sourceName: 'spotify', artworkUrl: 'https://i.scdn.co/image/abc' });
for (let p = 0; p < 5; p++) check(`queue view halaman ${p}`, buildQueueView(p));
check('notice', buildNotice('✅ Tes'));

const modal = buildAddModal().toJSON();
assert.equal(modal.components.length, 1);
console.log('✔ modal tambah lagu valid');

assert.equal(commands.length, 18);
console.log(`✔ ${commands.length} slash command valid`);

assert.equal(parseTime('1:30'), 90_000);
assert.equal(parseTime('90'), 90_000);
assert.equal(parseTime('1:02:03'), 3_723_000);
assert.equal(parseTime('abc'), null);
assert.equal(parseTime('1:'), null);
assert.equal(formatTime(3_723_000), '1:02:03');
assert.equal(progressBar(0, 100, 10), '●─────────');
assert.equal(progressBar(100, 100, 10), '━━━━━━━━━●');
assert(!safe('[a](b)').includes('['));
console.log('✔ util waktu & format');

console.log('\nSemua tes lulus ✅');
process.exit(0);
