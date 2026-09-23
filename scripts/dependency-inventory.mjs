import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const allowed = new Set(['MIT', 'Apache-2.0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', '(MIT OR CC0-1.0)']);
const dependencies = Object.entries(lock.packages).filter(([path]) => path).map(([path, item]) => {
  const installed = existsSync(`${path}/package.json`) ? JSON.parse(readFileSync(`${path}/package.json`, 'utf8')) : undefined;
  const license = installed?.license ?? item.license ?? 'UNKNOWN';
  return { name: installed?.name ?? path.split('node_modules/').at(-1), version: item.version, license, dev: Boolean(item.dev), optional: Boolean(item.optional), integrity: item.integrity, installed: Boolean(installed) };
});
mkdirSync('docs/evidence/g1', { recursive: true });
writeFileSync('docs/evidence/g1/dependencies.json', JSON.stringify({ lockfileVersion: lock.lockfileVersion, dependencies }, null, 2)+'\n');
const unknown = dependencies.filter(item => !allowed.has(item.license));
console.log(JSON.stringify({ lockedPackages: dependencies.length, installedPackages: dependencies.filter(d => d.installed).length, licenses: [...new Set(dependencies.map(d => d.license))], reviewRequired: unknown.map(({ name, license }) => ({ name, license })) }));
if (unknown.length) process.exitCode = 1;
