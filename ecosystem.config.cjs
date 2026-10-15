// pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'noname-lavalink',
      cwd: './lavalink',
      script: 'java',
      args: '-Xmx512M -jar Lavalink.jar',
      interpreter: 'none',
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 50,
    },
    {
      name: 'noname-music',
      script: 'src/index.js',
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: '400M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
