import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flowDriver, chooseDefaults } from './flow-driver.js';
import { flowFixture } from '../src/culture/fixture.js';

async function main() {
  const real = process.argv.includes('--real-replay');
  if (!real && !process.argv.includes('--synthetic')) throw Error('Требуется явный --synthetic либо --real-replay.');
  const root = resolve('.review/exploratory'); mkdirSync(root, { recursive: true });
  const file = resolve('.cache/keyless-correction/snapshot.json');
  if (real && !existsSync(file)) throw Error('Реальный снимок отсутствует. Синтетической замены нет.');
  const d = await flowDriver(resolve(root, `walkthrough-${Date.now()}.sqlite`), real ? JSON.parse(readFileSync(file,'utf8')) : flowFixture(), real ? Date.parse('2026-09-24T08:58:57.295Z') : undefined, real);
  try {
    await d.enter(); await chooseDefaults(d);
    await d.click('Показать варианты для проверки');
    const detail = d.buttons().find(b => b.text.startsWith('Подробнее'));
    if (detail) {
      await d.click(detail.text); await d.click('Сохранить'); await d.click('Мои события'); await d.click('Открыть 1');
      await d.restart(); await d.click('Удалить закладку'); await d.click('Да, удалить');
    }
    if (!real) {
      await d.click('Главная'); await chooseDefaults(d); await d.click('Показать варианты для проверки');
      await d.click('Подробнее 2'); await d.click('Сохранить'); await d.click('Мои события');
      d.catalog.replace({ ...flowFixture(), events: [], stats: { ...flowFixture().stats, normalizedEvents: 0, occurrences: 0 } });
      await d.click('Открыть 1'); await d.click('Главная'); await chooseDefaults(d);
      await d.click('Дата'); await d.click('Другая дата'); await d.say('непонятная дата');
      const token = /([A-F0-9]{6}) ГГГГ/.exec(d.screen()!.body.text)![1]; await d.say(`${token} 2030-04-31`);
      await d.click('Главная'); const old = d.payload('Подобрать'); await d.click('О данных'); await d.press(old);
      await d.say('/delete_data'); await d.click('Да, удалить мои данные'); await d.restart(); await d.say('/saved');
    }
    const output = `${real ? 'PRIVATE · HISTORICAL_REPLAY · исходный clock 2026-09-24T08:58:57.295Z; новый карантин применяется; новых данных нет' : 'СИНТЕТИЧЕСКИЙ ЛОКАЛЬНЫЙ HTTP-ПРОГОН · fixed clock 2030-04-05; MAX симулирован'}\n\n${d.transcript.join('\n\n')}`;
    const target = resolve(root, real ? 'private-real-replay.txt' : 'synthetic-transcript.txt'); writeFileSync(target, output.replace(/[A-F0-9]{6}(?= (?:ГГГГ|ЧЧ|СУММА))/g, '<код формы>'));
    writeFileSync(resolve(root, real ? 'real-runtime.json' : 'synthetic-runtime.json'), JSON.stringify({ mode: real ? 'HISTORICAL_REPLAY' : 'SYNTHETIC', http: true, restart: true, operations: d.operations.length, bookmarks: (d.runtime.store.db.prepare('SELECT count(*) n FROM bookmarks').get() as { n: number }).n, result: 'PASS' },null,2));
    console.log(JSON.stringify({ result: 'PASS', transcript: target, operations: d.operations.length }));
  } finally { await d.close(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
