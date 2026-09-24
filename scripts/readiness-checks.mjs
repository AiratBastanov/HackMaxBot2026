import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root=resolve('.review/user-readiness');mkdirSync(root,{recursive:true});
const group=prefix=>readdirSync('tests').filter(p=>p.startsWith(prefix)&&p.endsWith('.test.ts')).sort().map(p=>`dist/tests/${p.slice(0,-3)}.js`);
const checks=[
  ['typecheck',['node_modules/typescript/bin/tsc','--noEmit'],180000],
  ['build',['node_modules/typescript/bin/tsc'],180000],
  ['unit',['--test','--test-timeout=10000','dist/tests/config.test.js','dist/tests/contracts.test.js','dist/tests/live-admin.test.js'],120000],
  ['integration',['--test','--test-timeout=20000','dist/tests/integration.test.js','dist/tests/recovery.test.js'],300000],
  ['flow',['--test','--test-timeout=20000',...group('flow-')],120000],
  ['data',['--test','--test-timeout=10000',...group('data-')],120000],
];
const results=[];
for(const [name,args,timeout] of checks) {
  const began=Date.now(),p=spawnSync(process.execPath,args,{encoding:'utf8',timeout,maxBuffer:8*1024*1024});
  const log=(p.stdout??'')+(p.stderr??'');writeFileSync(resolve(root,`${name}.log`),log);
  const count=label=>Number(new RegExp(`^# ${label} (\\d+)$`,'m').exec(log)?.[1]??0);
  const row={name,args,result:p.status===0?'PASS':'FAIL',exitCode:p.status,durationMs:Date.now()-began,tests:count('tests'),passed:count('pass'),failed:count('fail'),cancelled:count('cancelled')};
  results.push(row);writeFileSync(resolve(root,'checks.json'),JSON.stringify({node:process.version,platform:process.platform,results},null,2));console.log(JSON.stringify(row));
  if(p.status!==0) {process.exitCode=1;break;}
}
