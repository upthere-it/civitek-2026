// npm run dev: avvia server e client insieme, con l'output prefissato. Il database non si tocca:
// migrazioni e seed si lanciano a parte (npm run db:migrate / db:seed).
// Niente dipendenze (concurrently & co.): child_process di Node. Ctrl+C ferma tutto; se uno dei due muore, si ferma anche l'altro.
import { spawn, type ChildProcess } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const colors = { server: '\x1b[35m', client: '\x1b[36m' } as const;
const children: ChildProcess[] = [];
let stopping = false;

function run(name: keyof typeof colors, script: string): void {
  const child = spawn(npm, ['run', script], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '1' } });
  const prefix = `${colors[name]}[${name}]\x1b[0m `;
  const pipe = (stream: NodeJS.ReadableStream, out: NodeJS.WriteStream) => {
    let rest = '';
    stream.on('data', (chunk: Buffer) => {
      const lines = (rest + chunk.toString()).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout!, process.stdout);
  pipe(child.stderr!, process.stderr);
  child.on('exit', (code) => {
    if (stopping) return;
    console.error(`${prefix}terminato (codice ${code}), fermo anche il resto`);
    stop(code ?? 1);
  });
  children.push(child);
}

function stop(code = 0): void {
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  process.exit(code);
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

run('server', 'dev:server');
run('client', 'dev:client');
