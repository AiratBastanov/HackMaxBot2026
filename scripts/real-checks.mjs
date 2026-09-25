import { spawnSync } from 'node:child_process';
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
// Только актуальные исходники тестов: старые emitted JS в dist не являются новой кампанией.
mkdirSync('.review/real-catalog',{recursive:true});
const files=readdirSync('tests').filter(f=>f.endsWith('.test.ts')).map(f=>'dist/tests/'+f.replace(/\.ts$/,'.js')).sort();
const p=spawnSync(process.execPath,['--test','--test-timeout=20000',...files],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,windowsHide:true});
const output=(p.stdout??'')+(p.stderr??'');writeFileSync('.review/real-catalog/regression-current.log',output);
console.log(output.split('\n').slice(-10).join('\n'));process.exitCode=p.status??1;
