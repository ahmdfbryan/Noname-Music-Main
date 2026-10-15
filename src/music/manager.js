const { LavalinkManager } = require('lavalink-client');
const { config } = require('../config');
const store = require('../store');
const log = require('../utils/logger');
const { autoPlay } = require('./autoplay');

/** Ubah User discord.js menjadi objek ringan supaya aman disimpan di antrian. */
function requesterTransformer(r) {
  if (!r || typeof r !== 'object') return { id: null, username: 'Tidak diketahui' };
  if (r.isAutoplay) return r;
  return {
    id: r.id ?? null,
    username: r.globalName || r.username || 'Member',
    avatar: typeof r.displayAvatarURL === 'function' ? r.displayAvatarURL({ size: 64 }) : r.avatar ?? null,
  };
}

function createManager(client) {
  const manager = new LavalinkManager({
    nodes: [
      {
        id: 'main',
        host: config.lavalink.host,
        port: config.lavalink.port,
        authorization: config.lavalink.password,
        secure: config.lavalink.secure,
        retryAmount: Infinity,
        retryDelay: 5_000,
        requestSignalTimeoutMS: 15_000,
        heartBeatInterval: 30_000,
        enablePingOnStatsCheck: true,
      },
    ],
    sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard?.send(payload),
    autoSkip: true,
    autoSkipOnResolveError: true,
    emitNewSongsOnly: false,
    autoMove: false,
    queueOptions: { maxPreviousTracks: 30 },
    playerOptions: {
      defaultSearchPlatform: config.defaultSearch,
      applyVolumeAsFilter: false,
      clientBasedPositionUpdateInterval: 150,
      requesterTransformer,
      useUnresolvedData: true,
      minAutoPlayMs: 8_000,
      maxErrorsPerTime: { threshold: 10_000, maxAmount: 3 },
      onDisconnect: {
        // Mode 24/7: kalau bot di-disconnect, langsung masuk lagi.
        autoReconnect: true,
        autoReconnectOnlyWithTracks: false,
        destroyPlayer: false,
      },
      onEmptyQueue: {
        // Tidak ada destroyAfterMs -> player tidak pernah dihancurkan (24/7).
        autoPlayFunction: async (player, lastTrack) => {
          if (!store.get('autoplay')) return;
          try {
            await autoPlay(player, lastTrack, client.user);
          } catch (err) {
            log.warn('Autoplay gagal:', err?.message || err);
          }
        },
      },
    },
  });

  manager.nodeManager.on('connect', (node) => log.info(`Lavalink node "${node.id}" tersambung.`));
  manager.nodeManager.on('reconnecting', (node) => log.warn(`Lavalink node "${node.id}" mencoba menyambung ulang...`));
  manager.nodeManager.on('disconnect', (node, reason) =>
    log.warn(`Lavalink node "${node.id}" terputus:`, reason?.reason || reason?.code || 'tanpa alasan'),
  );
  manager.nodeManager.on('error', (node, error) => log.error(`Lavalink node "${node.id}" error:`, error?.message || error));

  return manager;
}

module.exports = { createManager, requesterTransformer };
