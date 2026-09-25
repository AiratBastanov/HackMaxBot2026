import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,appendFileSync,readdirSync} from 'node:fs';
const [name,...args]=process.argv.slice(2);
const tasks={typecheck:['node_modules/typescript/bin/tsc','--noEmit'],build:['node_modules/typescript/bin/tsc'],
  flow:['--test','--test-timeout=20000',...readdirSync('tests').filter(f=>f.startsWith('flow-')&&f.endsWith('.test.ts')).map(f=>'dist/tests/'+f.replace(/\.ts$/,'.js'))],
  focused:['--test','--test-timeout=20000','dist/tests/flow-copy-date.test.js'],
  affected:['--test','--test-timeout=20000','dist/tests/polling.test.js','dist/tests/recovery.test.js','dist/tests/data-city-party.test.js'],
  delta:['--test','--test-timeout=20000','dist/tests/flow-bookmark-refresh.test.js','dist/tests/polling.test.js'],
  render:['dist/scripts/copy-walkthrough.js',...args]};
if(!tasks[name])throw Error('Неизвестная проверка');
mkdirSync('.review/concise-copy',{recursive:true});
const started=Date.now(),timeout=['typecheck','build'].includes(name)?180000:name==='render'?300000:120000;
const p=spawnSync(process.execPath,tasks[name],{encoding:'utf8',timeout,maxBuffer:8*1024*1024,windowsHide:true});
const output=(p.stdout??'')+(p.stderr??'');const log='.review/concise-copy/'+name+(args[0]?'-'+args[0]:'')+'.log';
writeFileSync(log,output);
const result={name,args,command:[process.execPath,...tasks[name]],started:new Date(started).toISOString(),elapsedMs:Date.now()-started,timeoutMs:timeout,exitCode:p.status,error:p.error?.code??null,log};
appendFileSync('.review/concise-copy/checks.jsonl',JSON.stringify(result)+'\n');
console.log(output.split('\n').slice(-18).join('\n'));console.log(JSON.stringify(result));process.exitCode=p.status??1;
