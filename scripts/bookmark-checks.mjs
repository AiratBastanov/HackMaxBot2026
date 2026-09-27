// Ограниченные локальные проверки; журналы остаются в ignored-каталоге.
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,appendFileSync,readdirSync} from 'node:fs';
const [name,...args]=process.argv.slice(2);
const tasks={
  typecheck:['node_modules/typescript/bin/tsc','--noEmit'],build:['node_modules/typescript/bin/tsc'],
  focused:['--test','--test-timeout=20000','dist/tests/flow-bookmark-variants.test.js','dist/tests/bookmark-storage.test.js','dist/tests/card-title.test.js','dist/tests/flow-bookmark-refresh.test.js'],
  refresh:['--test','--test-timeout=20000','dist/tests/flow-bookmark-refresh.test.js'],
  variants:['--test','--test-timeout=20000','dist/tests/flow-bookmark-variants.test.js'],
  compact:['--test','--test-timeout=20000','--test-name-pattern=^C16 HTTP/SQLite','dist/tests/flow-compact.test.js'],
  title:['--test','--test-timeout=20000','dist/tests/card-title.test.js','dist/tests/flow-copy-date.test.js','dist/tests/flow-stage4.test.js'],
  shared:['--test','--test-timeout=20000',...readdirSync('tests').filter(f=>f.endsWith('.test.ts')&&!['flow-bookmark-variants.test.ts','bookmark-storage.test.ts','card-title.test.ts','flow-bookmark-refresh.test.ts'].includes(f)).map(f=>'dist/tests/'+f.replace(/\.ts$/,'.js'))],
  walkthrough:['dist/scripts/bookmark-walkthrough.js',...args],
  container:['scripts/bookmark-container.mjs'],
};
if(!tasks[name])throw Error('Неизвестная проверка');
const dir='.review/bookmark-variants';mkdirSync(dir,{recursive:true});
const start=Date.now(),timeout=['typecheck','build'].includes(name)?180000:['container','shared','walkthrough'].includes(name)?300000:120000;
const p=spawnSync(process.execPath,tasks[name],{encoding:'utf8',timeout,maxBuffer:12*1024*1024,windowsHide:true});
const output=(p.stdout??'')+(p.stderr??'');
const log=dir+'/'+name+'-'+start+'.log';writeFileSync(log,output);
const receipt={name,started:new Date(start).toISOString(),elapsedMs:Date.now()-start,timeoutMs:timeout,exitCode:p.status,error:p.error?.code??null,log};
appendFileSync(dir+'/checks.jsonl',JSON.stringify(receipt)+'\n');
console.log(output.split('\n').slice(-24).join('\n'));console.log(JSON.stringify(receipt));process.exitCode=p.status??1;
