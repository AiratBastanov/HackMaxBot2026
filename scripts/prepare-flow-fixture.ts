import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flowFixture } from '../src/culture/fixture.js';
if (process.argv[2] !== '--synthetic-current' || !process.argv[3]) throw Error('Формат: --synthetic-current <новый файл.json>');
const path = resolve(process.argv[3]);
if (!path.endsWith('.json')) throw Error('Требуется новый JSON-файл; существующий файл не перезаписывается.');
writeFileSync(path,JSON.stringify(flowFixture(new Date()),null,2),{flag:'wx'});
console.log(JSON.stringify({mode:'SYNTHETIC_FIXTURE',clock:'ACTUAL_CURRENT_TIME',path,message:'Вымышленные данные для явно выбранного технического теста, не афиша.'}));
