// Локальные проверки R27. Журналы и одноразовые БД не публикуются.
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,appendFileSync,readdirSync} from 'node:fs';
const [name,...extra]=process.argv.slice(2),dir='.review/flow-corrections';
const focused=['flow-corrections','flow-contact-corrections','flow-bookmark-variants','bookmark-storage','card-title','flow-bookmark-refresh','flow-copy-date','flow-screens'];
const tasks={typecheck:['node_modules/typescript/bin/tsc','--noEmit'],build:['node_modules/typescript/bin/tsc'],
  focused:['--test','--test-timeout=20000',...focused.map(n=>'dist/tests/'+n+'.test.js')],
  delta:['--test','--test-timeout=20000',...extra.map(n=>'dist/tests/'+n+'.test.js')],
  shared:['--test','--test-timeout=20000',...readdirSync('tests').filter(f=>f.endsWith('.test.ts')&&!focused.some(n=>f===n+'.test.ts')).map(f=>'dist/tests/'+f.replace(/\.ts$/,'.js'))],
  walkthrough:['dist/scripts/corrections-walkthrough.js',...extra],container:['scripts/corrections-container.mjs']};
if(!tasks[name])throw Error('Неизвестная проверка');
mkdirSync(dir,{recursive:true});const start=Date.now(),timeout=['typecheck','build'].includes(name)?180000:['shared','container'].includes(name)?300000:120000;
const p=spawnSync(process.execPath,tasks[name],{encoding:'utf8',timeout,maxBuffer:12*1024*1024,windowsHide:true});
const output=(p.stdout??'')+(p.stderr??''),log=dir+'/'+name+'-'+start+'.log';writeFileSync(log,output);
const result={name,args:extra,started:new Date(start).toISOString(),elapsedMs:Date.now()-start,timeoutMs:timeout,exitCode:p.status,error:p.error?.code??null,log};
appendFileSync(dir+'/checks.jsonl',JSON.stringify(result)+'\n');console.log(output.split('\n').slice(-30).join('\n'));console.log(JSON.stringify(result));process.exitCode=p.status??1;
