// PM2 (ARCHITECTURE §9, deploy/README.md): UNA istanza in fork mode. Lo stato dei socket e del villaggio sta in
// memoria, quindi niente cluster mode: due processi vedrebbero due villaggi diversi.
// Avvio: pm2 start ecosystem.config.js && pm2 save
const { join } = require('node:path');

module.exports = {
  apps: [
    {
      name: 'civitek',
      cwd: join(__dirname, 'apps', 'server'),
      script: 'dist/main.js',
      node_args: '--enable-source-maps',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '512M',
      // tempo per chiudere socket e loop (enableShutdownHooks) prima del kill
      kill_timeout: 10000,
      time: true,
      out_file: join(__dirname, 'logs', 'civitek.out.log'),
      error_file: join(__dirname, 'logs', 'civitek.err.log'),
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '3000',
      },
    },
  ],
};
