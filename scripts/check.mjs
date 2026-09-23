// Только публичные команды без секретов в аргументах.
import { spawn } from 'node:child_process';
import { mkdirSync, appendFileSync, createWriteStream } from 'node:fs';
const [name, seconds, executable, ...args] = process.argv.slice(2);
if (!name || !/^[a-z0-9-]+$/.test(name) || !executable || !(Number(seconds) > 0)) process.exit(2);
mkdirSync('docs/evidence/g1', { recursive: true });
const logPath = `docs/evidence/g1/${name}.log`;
const log = createWriteStream(logPath);
const started = Date.now();
const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { process.stdout.write(data); log.write(data); });
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; child.kill(); }, Number(seconds) * 1000);
child.on('error', error => { console.error(error.code); });
child.on('close', (code, signal) => {
  clearTimeout(timer);
  log.end();
  const result = { name, command: [executable, ...args], started: new Date(started).toISOString(), elapsedSeconds: Number(((Date.now()-started)/1000).toFixed(3)), exitCode: timedOut ? 124 : code, signal, timedOut, logPath };
  appendFileSync('docs/evidence/g1/checks.jsonl', JSON.stringify(result)+'\n');
  console.log(JSON.stringify(result));
  process.exitCode = timedOut ? 124 : code ?? 1;
});
