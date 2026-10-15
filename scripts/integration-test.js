// Tes integrasi: bot logic + lavalink-client asli, melawan server Lavalink v4 tiruan & voice Discord tiruan.
process.env.DISCORD_TOKEN ||= 'test';
process.env.LAVALINK_PORT = '23339';
process.env.LAVALINK_PASSWORD = 'pw';
const assert = require('node:assert');
const http = require('node:http');
const { WebSocketServer } = require('ws');
const store = require('../src/store');
const music = require('../src/music/service');
const { createManager } = require('../src/music/manager');

const GUILD = '111111111111111111';
const BOT = '222222222222222222';
const VC = process.env.VOICE_CHANNEL_ID || '1527164677941891193';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000, label = 'kondisi') {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await fn()) return;
    await sleep(25);
  }
  throw new Error(`Timeout menunggu ${label}`);
}

/* ---------------- Fake Lavalink v4 ---------------- */
let sessionCounter = 0;
const lava = { ws: null, sessionId: null, playing: null, searches: [], wss: null, server: null };
const mk = (id, title, author = 'Artis', len = 180000) => ({
  encoded: `enc_${id}`,
  info: { identifier: id, isSeekable: true, author, length: len, isStream: false, position: 0, title, uri: `https://www.youtube.com/watch?v=${id}`, artworkUrl: null, isrc: null, sourceName: 'youtube' },
  pluginInfo: {},
  userData: {},
});
const send = (o) => lava.ws?.readyState === 1 && lava.ws.send(JSON.stringify(o));

function startLava() {
  lava.server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = (o, code = 200) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(o));
      };
      if (url.pathname === '/v4/info') {
        return json({ version: { semver: '4.2.2', major: 4, minor: 2, patch: 2 }, buildTime: 0, git: {}, jvm: '17', lavaplayer: '2', sourceManagers: ['youtube', 'spotify', 'soundcloud', 'http'], filters: ['volume', 'equalizer', 'timescale', 'rotation', 'lowPass'], plugins: [{ name: 'youtube-plugin', version: '1.18.2' }, { name: 'lavasrc-plugin', version: '4.8.3' }] });
      }
      if (url.pathname === '/v4/stats') return json({ players: 1, playingPlayers: 1, uptime: 1, memory: { free: 1, used: 1, allocated: 1, reservable: 1 }, cpu: { cores: 1, systemLoad: 0, lavalinkLoad: 0 }, frameStats: null });
      if (url.pathname === '/v4/loadtracks') {
        const id = url.searchParams.get('identifier');
        lava.searches.push(id);
        if (id.includes('list=RD')) return json({ loadType: 'playlist', data: { info: { name: 'Mix', selectedTrack: 0 }, pluginInfo: {}, tracks: Array.from({ length: 10 }, (_, i) => mk(`mix${String(i).padStart(8, '0')}`, `Mix Song ${i}`)) } });
        if (id.includes('playlist')) return json({ loadType: 'playlist', data: { info: { name: 'PL Keren', selectedTrack: -1 }, pluginInfo: {}, tracks: [mk('pl000000001', 'PL 1'), mk('pl000000002', 'PL 2'), mk('pl000000003', 'PL 3')] } });
        if (id.includes('kosong')) return json({ loadType: 'empty', data: {} });
        const q = id.split(':').slice(1).join(':');
        return json({ loadType: 'search', data: [mk(`s${Buffer.from(q).toString('hex').slice(0, 10).padEnd(10, '0')}`, q)] });
      }
      const m = url.pathname.match(/^\/v4\/sessions\/([^/]+)\/players\/(\d+)$/);
      if (m) {
        if (m[1] !== lava.sessionId) return json({ status: 404, error: 'Not Found', message: 'Session not found' }, 404);
        if (req.method === 'DELETE') {
          lava.playing = null;
          res.writeHead(204);
          return res.end();
        }
        const b = body ? JSON.parse(body) : {};
        const noReplace = url.searchParams.get('noReplace') === 'true';
        if (b.track && 'encoded' in b.track) {
          if (b.track.encoded === null) {
            if (lava.playing) {
              const old = lava.playing;
              lava.playing = null;
              setTimeout(() => send({ op: 'event', type: 'TrackEndEvent', guildId: m[2], track: old, reason: 'stopped' }), 10);
            }
          } else if (!(noReplace && lava.playing)) {
            const old = lava.playing;
            const t = { encoded: b.track.encoded, info: {}, pluginInfo: {}, userData: b.track.userData || {} };
            lava.playing = t;
            if (old) setTimeout(() => send({ op: 'event', type: 'TrackEndEvent', guildId: m[2], track: old, reason: 'replaced' }), 5);
            setTimeout(() => send({ op: 'event', type: 'TrackStartEvent', guildId: m[2], track: t }), 15);
          }
        }
        return json({ guildId: m[2], track: lava.playing, volume: b.volume ?? 100, paused: !!b.paused, state: { time: Date.now(), position: b.position || 0, connected: true, ping: 1 }, voice: b.voice || {}, filters: b.filters || {} });
      }
      json({ status: 404 }, 404);
    });
  });
  lava.wss = new WebSocketServer({ server: lava.server, path: '/v4/websocket' });
  lava.wss.on('connection', (ws, req) => {
    assert.equal(req.headers.authorization, 'pw');
    lava.ws = ws;
    lava.sessionId = `sess${++sessionCounter}`;
    lava.playing = null;
    ws.send(JSON.stringify({ op: 'ready', resumed: false, sessionId: lava.sessionId }));
  });
  return new Promise((r) => lava.server.listen(23339, '127.0.0.1', r));
}
function stopLava() {
  return new Promise((r) => {
    for (const c of lava.wss.clients) c.terminate();
    lava.wss.close();
    lava.server.closeAllConnections?.();
    lava.server.close(() => r());
  });
}
function finishTrack() {
  const t = lava.playing;
  lava.playing = null;
  send({ op: 'event', type: 'TrackEndEvent', guildId: GUILD, track: t, reason: 'finished' });
}

/* ---------------- Fake Discord ---------------- */
const voice = { channelId: null, ops: [] };
const vcMembers = new Map([['u1', { user: { bot: false } }]]);
vcMembers.filter = function (fn) {
  return { size: [...this.values()].filter(fn).length };
};
const guild = {
  id: GUILD,
  members: { me: { voice: { get channelId() { return voice.channelId; } } } },
  channels: { cache: new Map([[VC, { members: vcMembers }]]) },
  shard: {
    send(payload) {
      voice.ops.push(payload);
      const ch = payload.d.channel_id;
      setTimeout(async () => {
        voice.channelId = ch;
        await manager.sendRawData({ t: 'VOICE_STATE_UPDATE', d: { guild_id: GUILD, user_id: BOT, channel_id: ch, session_id: 'vsess', self_deaf: true, self_mute: false, deaf: false, mute: false, suppress: false } }).catch(() => {});
        if (ch) await manager.sendRawData({ t: 'VOICE_SERVER_UPDATE', d: { guild_id: GUILD, token: 'tok', endpoint: 'voice.discord.test' } }).catch(() => {});
      }, 20);
    },
  },
};
const client = { user: { id: BOT, username: 'NonameMusic' }, guilds: { cache: new Map([[GUILD, guild]]) } };
const manager = createManager(client);
manager.nodeManager.removeAllListeners('error');
manager.nodeManager.on('error', () => {});

const user = { id: '333333333333333333', username: 'ahmad', displayAvatarURL: () => null };

(async () => {
  store.load();
  store.set('autoplay', true);
  store.set('volume', null);
  await startLava();
  music.init({ client, manager, guildId: GUILD });
  manager.nodeManager.on('connect', () => setTimeout(() => music.recoverAfterNodeRestart().catch((e) => console.error(e)), 300));
  await manager.init({ id: BOT, username: 'NonameMusic' });
  await until(() => music.nodeReady(), 4000, 'node siap');
  console.log('✔ terhubung ke Lavalink (tiruan)');

  await until(() => music.getPlayer() && voice.channelId === VC, 4000, 'join voice 24/7');
  assert.equal(voice.ops[0].d.channel_id, VC);
  assert.equal(voice.ops[0].d.self_deaf, true);
  console.log('✔ 24/7: bot otomatis join voice', VC);

  const r1 = await music.enqueue('Tulus Hati-Hati di Jalan', user);
  assert.equal(r1.position, 0);
  assert(lava.searches.at(-1).startsWith('ytmsearch:'));
  await until(() => music.getPlayer().queue.current?.info.title === 'Tulus Hati-Hati di Jalan', 2000, 'lagu 1 mulai');
  console.log('✔ /play judul -> langsung diputar');

  const r2 = await music.enqueue('https://www.youtube.com/playlist?list=abc', user);
  assert(r2.isPlaylist && r2.count === 3 && r2.playlistName === 'PL Keren');
  assert.equal(music.getPlayer().queue.tracks.length, 3);
  console.log('✔ playlist masuk antrian (3 lagu)');

  await assert.rejects(() => music.enqueue('kosong', user), /Tidak ditemukan/);
  console.log('✔ pencarian kosong -> pesan ramah');

  await music.skip();
  await until(() => music.getPlayer().queue.current?.info.title === 'PL 1', 2000, 'skip ke PL 1');
  console.log('✔ skip');

  await music.previous();
  await until(() => music.getPlayer().queue.current?.info.title === 'Tulus Hati-Hati di Jalan', 2000, 'previous');
  assert.equal(music.getPlayer().queue.tracks[0].info.title, 'PL 1');
  console.log('✔ previous (lagu sebelumnya diputar, lagu tadi kembali ke antrian)');

  await music.togglePause();
  assert.equal(music.getPlayer().paused, true);
  await music.togglePause();
  assert.equal(music.getPlayer().paused, false);
  console.log('✔ pause / resume');

  await music.setVolume(10, { relative: true });
  assert.equal(music.getPlayer().volume, 90);
  await music.setVolume(500);
  assert.equal(music.getPlayer().volume, 150);
  await music.setVolume(80);
  console.log('✔ volume (dibatasi 0-150)');

  assert.match(await music.cycleLoop(), /Lagu ini/);
  assert.match(await music.cycleLoop(), /Semua/);
  assert.match(await music.cycleLoop(), /Mati/);
  console.log('✔ loop off -> track -> queue -> off');

  await music.setFilter('nightcore');
  await music.setFilter('bassboost');
  await music.setFilter('normal');
  console.log('✔ filter audio');

  await music.shuffle();
  await music.jumpTo(3);
  await until(() => music.getPlayer().queue.tracks.length === 0, 2000, 'jump');
  console.log('✔ shuffle & jump');

  // Antrian habis -> autoplay
  finishTrack();
  await until(() => music.getPlayer().queue.current?.info.title?.startsWith('Mix Song'), 4000, 'autoplay');
  assert(lava.searches.some((s) => s.includes('list=RD')));
  assert(music.getPlayer().queue.current.requester.isAutoplay);
  console.log('✔ autoplay: antrian habis -> lagu mirip diputar otomatis');

  // Request member menggeser lagu autoplay di antrian
  const autoInQueue = music.getPlayer().queue.tracks.filter((t) => t.requester?.isAutoplay).length;
  await music.enqueue('Request Member', user);
  assert.equal(music.getPlayer().queue.tracks.filter((t) => t.requester?.isAutoplay).length, 0);
  assert.equal(music.getPlayer().queue.tracks[0].info.title, 'Request Member');
  console.log(`✔ request member diprioritaskan (buang ${autoInQueue} lagu autoplay di antrian)`);

  // Skip lagu terakhir dengan autoplay mati -> berhenti rapi
  await music.setAutoplay(false);
  await music.skip();
  await until(() => music.getPlayer().queue.current?.info.title === 'Request Member', 2000, 'skip ke request');
  await music.skip();
  await until(() => !music.getPlayer().queue.current, 2000, 'berhenti');
  console.log('✔ skip lagu terakhir (autoplay off) -> tidak error, idle');

  await assert.rejects(() => music.skip(), /Tidak ada lagu/);
  await assert.rejects(() => music.stop(), /Tidak ada yang/);
  console.log('✔ tombol saat idle -> pesan ramah, tidak crash');

  // Auto-pause saat voice kosong
  await music.enqueue('Lagu Auto Pause', user);
  await until(() => music.getPlayer().queue.current, 2000, 'play');
  vcMembers.delete('u1');
  await music.syncAutoPause();
  assert.equal(music.getPlayer().paused, true);
  vcMembers.set('u1', { user: { bot: false } });
  await music.syncAutoPause();
  assert.equal(music.getPlayer().paused, false);
  console.log('✔ auto-pause saat voice kosong & auto-resume saat ada member');

  // Bot ditendang dari voice -> auto reconnect
  const opsBefore = voice.ops.length;
  await manager.sendRawData({ t: 'VOICE_STATE_UPDATE', d: { guild_id: GUILD, user_id: BOT, channel_id: null, session_id: 'vsess' } });
  await until(() => voice.ops.length > opsBefore && voice.channelId === VC, 3000, 'reconnect voice');
  console.log('✔ di-disconnect dari voice -> otomatis masuk lagi');

  // Lavalink restart -> player dipulihkan
  await music.enqueue('Lagu Antrian Setelah Restart', user);
  const titleBefore = music.getPlayer().queue.current.info.title;
  const oldSession = lava.sessionId;
  await stopLava();
  await sleep(300);
  await startLava();
  await until(() => lava.sessionId !== oldSession && music.nodeReady(), 15000, 'node reconnect');
  await until(() => lava.playing && music.getPlayer()?.getData('nodeSession') === lava.sessionId, 8000, 'recovery');
  assert.equal(music.getPlayer().queue.current.info.title, titleBefore);
  assert.equal(music.getPlayer().queue.tracks[0].info.title, 'Lagu Antrian Setelah Restart');
  console.log('✔ Lavalink restart -> lagu & antrian dipulihkan otomatis');

  await music.stop();
  await until(() => !music.getPlayer().queue.current, 2000, 'stop');
  assert.equal(music.getPlayer().queue.tracks.length, 0);
  assert.equal(voice.channelId, VC);
  console.log('✔ stop -> antrian kosong, bot tetap di voice (24/7)');

  console.log('\nSemua tes integrasi lulus ✅');
  store.flush();
  process.exit(0);
})().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
