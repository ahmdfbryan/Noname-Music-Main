// Penyimpanan sederhana berbasis file JSON (aman untuk VPS tanpa native module).
const fs = require('node:fs');
const path = require('node:path');
const log = require('./utils/logger');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'settings.json');

const defaults = {
  panelChannelId: null,
  panelMessageId: null,
  volume: null,
  autoplay: true,
  filter: 'normal',
};

let state = { ...defaults };
let saveTimer = null;

function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(FILE)) {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      state = { ...defaults, ...(raw && typeof raw === 'object' ? raw : {}) };
    }
  } catch (err) {
    log.warn('Gagal membaca data/settings.json, memakai default:', err.message);
    state = { ...defaults };
  }
  return state;
}

function writeNow() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, FILE);
  } catch (err) {
    log.error('Gagal menyimpan settings:', err.message);
  }
}

function get(key) {
  return state[key];
}

function set(key, value) {
  if (state[key] === value) return;
  state[key] = value;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 500);
}

function flush() {
  clearTimeout(saveTimer);
  writeNow();
}

module.exports = { load, get, set, flush };
