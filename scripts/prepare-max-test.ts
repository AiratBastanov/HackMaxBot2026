import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stage4Fixture } from '../src/culture/stage4-fixture.js';

// Без credentials/сети; существующая конфигурация и снимок не перезаписываются.
mkdirSync('runtime/max-test', { recursive: true });
for (const name of ['inspect','polling']) {
  const path = `.env.${name}`;
  if (!existsSync(path)) writeFileSync(path, readFileSync(`${path}.example`, 'utf8')
    .replace('MAX_INSPECTION_SCOPE_CONFIRMED=false','MAX_INSPECTION_SCOPE_CONFIRMED=true'), {flag:'wx',mode:0o600});
}
const path = 'runtime/max-test/synthetic-current.json';
if (!existsSync(path)) writeFileSync(path, JSON.stringify(stage4Fixture(new Date()), null, 2), {flag:'wx'});
console.log('Локальные шаблоны и новый synthetic-current подготовлены; существующие файлы сохранены. Подтверждения оператора остаются false.');
