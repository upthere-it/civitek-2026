// Sviluppo senza @nestjs/cli: tsc in watch + node che riparte quando cambia dist/.
const { spawn } = require('node:child_process');

const tsc = spawn(
  process.execPath,
  [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'],
  { stdio: 'inherit' },
);
const app = spawn(process.execPath, ['--watch-path=dist', '--enable-source-maps', 'dist/main.js'], { stdio: 'inherit' });

const stop = () => {
  tsc.kill();
  app.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
