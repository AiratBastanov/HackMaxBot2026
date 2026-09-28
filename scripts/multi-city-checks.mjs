// Watchdog действует вне проверяемого процесса, включая зависший синхронный подбор.
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,appendFileSync,readdirSync} from 'node:fs';
const [name,...extra]=process.argv.slice(2),dir='.review/multi-city';
const shared=readdirSync('tests').filter(n=>n.endsWith('.test.ts'));
const suite=files=>['--test','--test-timeout=20000',...files.map(n=>'dist/tests/'+n.replace(/\.ts$/,'.js'))];
const tasks={typecheck:['node_modules/typescript/bin/tsc','--noEmit'],build:['node_modules/typescript/bin/tsc'],shared:suite(shared),delta:suite(extra.map(n=>n+'.test.ts')),
 matrix:['dist/scripts/multi-city-verify.js','catalog/real/active.json','.review/multi-city/matrix','matrix'],
 journeys:['dist/scripts/multi-city-verify.js','catalog/real/active.json','.review/multi-city/verification','full'],container:['scripts/multi-city-container.mjs']};
if(!tasks[name])throw Error('Неизвестная проверка');mkdirSync(dir,{recursive:true});
const start=Date.now(),timeout=name==='matrix'?10000:name==='container'?360000:['build','typecheck'].includes(name)?180000:120000;
const child=spawnSync(process.execPath,tasks[name],{encoding:'utf8',timeout,maxBuffer:12*1024*1024,windowsHide:true});
const output=(child.stdout??'')+(child.stderr??''),log=dir+'/'+name+'-'+start+'.log';writeFileSync(log,output);
const result={name,args:extra,started:new Date(start).toISOString(),elapsedMs:Date.now()-start,timeoutMs:timeout,exitCode:child.status,error:child.error?.code??null,
 tests:Number(output.match(/# tests (\d+)/)?.[1]??0),passed:Number(output.match(/# pass (\d+)/)?.[1]??0),failed:Number(output.match(/# fail (\d+)/)?.[1]??0),log};
appendFileSync(dir+'/checks.jsonl',JSON.stringify(result)+'\n');console.log(output.split('\n').slice(-25).join('\n'));console.log(JSON.stringify(result));process.exitCode=child.status??1;
