import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const paths = ['package.json', 'package-lock.json', 'tsconfig.json', '.npmrc', '.node-version', '.env.example', '.gitignore', '.dockerignore', 'Dockerfile', 'compose.yaml', 'openapi.json', 'README.md', 'AGENTS.md', 'THIRD_PARTY_NOTICES.md',
  'docs/00_REQUIREMENTS_AND_EVIDENCE.md', 'docs/01_PRODUCT_DECISION.md', 'docs/02_ARCHITECTURE_AND_DELIVERY.md', 'docs/03_IMPLEMENTATION_PLAN.md', 'docs/G1_LIVE_RUNBOOK.md'];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error('Manifest: symlink требует проверки');
    if (entry.isDirectory()) walk(path);
    else if (/\.(ts|mjs|json|yaml)$/.test(path) || path === 'deploy/Caddyfile') paths.push(path);
  }
}
for (const dir of ['src', 'tests', 'scripts', 'deploy']) walk(dir);
const hash = data => createHash('sha256').update(data).digest('hex');
const content = [...new Set(paths)].sort().map(path => `${hash(readFileSync(path))}  ${path}`).join('\n')+'\n';
mkdirSync('docs/evidence/g1', { recursive: true });
writeFileSync('docs/evidence/g1/source.sha256', content);
console.log(JSON.stringify({ files: new Set(paths).size, manifestSha256: hash(content), manifest: 'docs/evidence/g1/source.sha256', excluded: ['secrets', 'runtime', 'dependencies', 'build outputs', 'historical receipt 04', 'receipt 05 and evidence (avoid recursive hashes)'] }));
