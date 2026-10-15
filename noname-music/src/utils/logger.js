const stamp = () => new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });

module.exports = {
  info: (...a) => console.log(`[${stamp()}] [INFO]`, ...a),
  warn: (...a) => console.warn(`[${stamp()}] [WARN]`, ...a),
  error: (...a) => console.error(`[${stamp()}] [ERROR]`, ...a),
};
