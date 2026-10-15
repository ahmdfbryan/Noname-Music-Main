require('dotenv').config();

function str(name, fallback = '') {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback;
}

function int(name, fallback, min, max) {
  const n = Number.parseInt(str(name), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function bool(name, fallback = false) {
  const v = str(name).toLowerCase();
  if (!v) return fallback;
  return ['1', 'true', 'yes', 'on', 'ya'].includes(v);
}

function color(name, fallback) {
  const v = str(name).replace('#', '');
  const n = Number.parseInt(v, 16);
  return /^[0-9a-f]{6}$/i.test(v) && !Number.isNaN(n) ? n : fallback;
}

const isSnowflake = (v) => /^\d{17,20}$/.test(v);

const config = {
  token: str('DISCORD_TOKEN'),
  voiceChannelId: str('VOICE_CHANNEL_ID', '1527164677941891193'),
  panelChannelId: str('PANEL_CHANNEL_ID'),
  djRoleId: str('DJ_ROLE_ID'),
  requestChannelMode: bool('REQUEST_CHANNEL_MODE', false),

  lavalink: {
    host: str('LAVALINK_HOST', '127.0.0.1'),
    port: int('LAVALINK_PORT', 2333, 1, 65535),
    password: str('LAVALINK_PASSWORD', 'youshallnotpass'),
    secure: bool('LAVALINK_SECURE', false),
  },

  defaultVolume: int('DEFAULT_VOLUME', 80, 0, 150),
  maxVolume: 150,
  panelColor: color('PANEL_COLOR', 0x3b82f6),
  defaultSearch: ['ytmsearch', 'ytsearch', 'spsearch'].includes(str('DEFAULT_SEARCH'))
    ? str('DEFAULT_SEARCH')
    : 'ytmsearch',
  maxQueue: int('MAX_QUEUE', 500, 10, 5000),

  brand: {
    name: 'Noname Music',
    server: 'Noname Studios Creative',
  },
};

function validateConfig() {
  const errors = [];
  if (!config.token) errors.push('DISCORD_TOKEN belum diisi di file .env');
  if (!isSnowflake(config.voiceChannelId)) errors.push('VOICE_CHANNEL_ID tidak valid');
  if (config.panelChannelId && !isSnowflake(config.panelChannelId)) errors.push('PANEL_CHANNEL_ID tidak valid');
  if (config.djRoleId && !isSnowflake(config.djRoleId)) errors.push('DJ_ROLE_ID tidak valid');
  return errors;
}

module.exports = { config, validateConfig, isSnowflake };
