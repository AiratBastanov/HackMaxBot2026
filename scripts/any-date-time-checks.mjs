import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
const [name,...extra]=process.argv.slice(2),dir='.review/any-date-time';
const focused=['flow-any-date-time','data-select','data-city-party','flow-copy-date','flow-corrections','flow-bookmark-refresh','flow-bookmark-variants','bookmark-storage','card-title'];
const shared=['flow-runtime','flow-compact','flow-publication','public-access','public-data','data-correction','flow-screens'];
const suite=files=>['--test','--test-timeout=20000',...files.map(n=>'dist/tests/'+n+'.test.js')];
const tasks={typecheck:['node_modules/typescript/bin/tsc','--noEmit'],build:['node_modules/typescript/bin/tsc'],focused:suite(focused),shared:suite(shared),delta:suite(extra),
  walkthrough:['dist/scripts/any-date-time-walkthrough.js',...extra],container:['scripts/any-date-time-container.mjs']};
if(!tasks[name])throw Error('Неизвестная проверка');
mkdirSync(dir,{recursive:true});const start=Date.now(),timeout=['typecheck','build'].includes(name)?180000:['container','walkthrough'].includes(name)?300000:120000;
const p=spawnSync(process.execPath,tasks[name],{encoding:'utf8',timeout,maxBuffer:12*1024*1024,windowsHide:true});
const output=(p.stdout??'')+(p.stderr??''),log=dir+'/'+name+'-'+start+'.log';writeFileSync(log,output);
const result={name,args:extra,started:new Date(start).toISOString(),elapsedMs:Date.now()-start,timeoutMs:timeout,exitCode:p.status,error:p.error?.code??null,log};
appendFileSync(dir+'/checks.jsonl',JSON.stringify(result)+'\n');console.log(output.split('\n').slice(-35).join('\n'));console.log(JSON.stringify(result));process.exitCode=p.status??1;
