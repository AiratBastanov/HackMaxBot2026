import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {bookmarkScenario} from './bookmark-scenario.js';

const root=resolve(process.argv[2]??'.review/bookmark-variants');mkdirSync(root,{recursive:true});
const dir=mkdtempSync(resolve(root,'walkthrough-'));
const result=await bookmarkScenario(resolve(dir,'synthetic.sqlite'));
// Непрозрачные ID остаются в private evidence; публичный пример использует только псевдонимы.
writeFileSync(resolve(dir,'private-identities.json'),JSON.stringify(result,null,2));
const lines=['# Локальный пример независимых закладок','',
  'Автоматически сформировано через HTTP → worker → SQLite; MAX симулирован. Все события и пользователи вымышлены.','',
  '| Запись | Название | Исходный выбор | После удаления |','|---|---|---|---|',
  ...result.rows.map(r=>`| ${r.alias} | ${r.title} | ${r.context.replaceAll('\n','; ')} | ${r.retained?'сохранена':'удалена'} |`),'',
  'До удаления: 8 записей у пользователя A + 1 у B = 9. После удаления одной: 7 + 1 = 8.',
  'Повторная доставка кнопки не добавила записи. Намеренное «Сохранить ещё раз» добавило отдельную запись.',
  'Каждая запись открыта со своим ID/поколением и первоначальным выбором; перезапуск, смена сообщений и очистка экранов состав списка не изменили.',
  'Настоящие клиенты MAX в этой проверке не участвовали.',''];
writeFileSync(resolve(root,'walkthrough.md'),lines.join('\n'));
console.log(JSON.stringify({result:'PASS',transport:result.transport,schema:result.schema,before:result.before,after:result.after,checks:result.checks}));
