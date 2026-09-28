// Один изолированный кандидат; Compose-профили поставки, симулятор MAX, одноразовые тома.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,copyFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('.review/catalog-startup'),project='maxbot-catalog-'+Date.now(),image=project+':test',candidate=resolve(root,project);
mkdirSync(candidate,{recursive:true});assert(/^maxbot-catalog-\d+$/.test(project));
const results=[],projects=new Set();let before='',ids=[],passed=false;
const env={...process.env,CULTURAL_PLAN_IMAGE:image,COMPOSE_PROJECT_NAME:project};
function run(name,args,{cwd=candidate,timeout=30000,expected=0}={}){
  const start=Date.now(),r=spawnSync('docker',args,{cwd,env,encoding:'utf8',timeout,maxBuffer:16*1024*1024,windowsHide:true});
  writeFileSync(resolve(root,project+'-'+name+'.log'),(r.stdout??'')+(r.stderr??''));results.push({name,exitCode:r.status,elapsedMs:Date.now()-start,error:r.error?.code??null});
  if(expected!==null&&r.status!==expected)throw Error(name+': '+((r.stderr??'')+(r.stdout??'')).slice(-2200));return r;
}
function compose(p,files,extra,options){projects.add(p);return run(extra[0]+'-'+results.length,['compose','-p',p,...files.flatMap(f=>['-f',f]),...extra],options);}
const tracked=spawnSync('git',['ls-files','-z'],{encoding:'utf8',windowsHide:true});assert.equal(tracked.status,0);
const files=new Set([...tracked.stdout.split('\0').filter(n=>/^(src\/|tests\/|scripts\/|catalog\/real\/|deploy\/|docs\/evidence\/multi-city\/)/.test(n)||['Dockerfile','compose.yaml','compose.polling.yaml','compose.setup.yaml','.dockerignore','.env.public.example','.npmrc','package.json','package-lock.json','tsconfig.json'].includes(n)),
  'src/catalog-prepare.ts','scripts/catalog-prepare.ts','scripts/catalog-startup-scenarios.ts','scripts/catalog-startup-container.mjs','tests/catalog-startup.test.ts']);
for(const file of files){const target=resolve(candidate,file);assert(target.startsWith(candidate));mkdirSync(dirname(target),{recursive:true});copyFileSync(file,target);}
mkdirSync(resolve(candidate,'secrets'));writeFileSync(resolve(candidate,'secrets/max_bot_token'),'offline-webhook-smoke-token\n');
if(existsSync('secrets/max-official-root.pem')){copyFileSync('secrets/max-official-root.pem',resolve(candidate,'secrets/max-official-root.pem'));env.NODE_EXTRA_CA_CERTS_CONTAINER='/run/secrets/max-official-root.pem';}
writeFileSync(resolve(candidate,'setup.verify.yaml'),'services:\n  setup:\n    network_mode: none\n    command: [node, /app/dist/scripts/polling-setup-check.js, --initialize, --organizer]\n');
writeFileSync(resolve(candidate,'polling.verify.yaml'),'services:\n  catalog-init:\n    network_mode: none\n  app:\n    network_mode: none\n    ports: !reset []\n    command: [node, dist/scripts/polling-setup-check.js, --organizer, --real-catalog]\n');
writeFileSync(resolve(candidate,'demo.verify.yaml'),'services:\n  app:\n    network_mode: none\n    ports: !reset []\n');
const polling=['--env-file','.env.public','-f','compose.polling.yaml','-f','polling.verify.yaml'];
try{
  ids=run('existing-ids',['ps','-q']).stdout.trim().split(/\s+/).filter(Boolean);
  if(ids.length)before=run('existing-before',['inspect','--format','{{.Id}} {{.State.StartedAt}} {{.RestartCount}}',...ids]).stdout;
  compose(project,['compose.setup.yaml','setup.verify.yaml'],['build','setup'],{timeout:300000});
  const identity=compose(project,['compose.setup.yaml','setup.verify.yaml'],['run','--rm','setup'],{timeout:45000});assert(identity.stdout.includes('docker-identity-from-example-no-overwrite'));
  const fresh=run('documented-real-start',['compose','-p',project,...polling,'up','--build'],{timeout:180000});assert(fresh.stdout.includes('FRESH-01/PUBLIC-01/RESTART-01/BOOKMARK-01'));
  const cases=run('upgrade-and-faults',['compose','-p',project,...polling,'run','--rm','--no-deps','app','node','dist/scripts/catalog-startup-scenarios.js','/app/runtime/scenarios'],{timeout:90000});assert(cases.stdout.includes('NO-DOWNGRADE-01'));assert(cases.stdout.includes('PARTIAL-REFRESH-01'));
  // Просроченный fault fixture: canonical hashes пересчитаны только в disposable копии.
  const staleProject=project+'-stale',staleRoot=resolve(candidate,'.verification/stale');mkdirSync(staleRoot,{recursive:true});
  const pointer=JSON.parse(readFileSync('catalog/real/active.json','utf8')),data=JSON.parse(readFileSync('catalog/real/'+pointer.snapshot,'utf8')),review=JSON.parse(readFileSync('catalog/real/'+pointer.review,'utf8'));
  const expired=new Date(Date.now()-5*86400000).toISOString();review.reviewedAt=expired;
  for(let i=0;i<data.snapshots.length;i++){const s=data.snapshots[i];s.retrievedAt=expired;for(const v of [...s.events,...s.venues])for(const o of v.observations)o.retrievedAt=expired;
    review.entries[i].snapshotHash=createHash('sha256').update(JSON.stringify(s)).digest('hex');review.entries[i].validUntil=new Date(Date.parse(expired)+72*3600000).toISOString();}
  for(const[name,value]of [['active.json',pointer],[pointer.snapshot,data],[pointer.review,review]])writeFileSync(resolve(staleRoot,name),JSON.stringify(value));
  copyFileSync('catalog/real/prepared-facts.json',resolve(staleRoot,'prepared-facts.json'));
  writeFileSync(resolve(candidate,'stale.verify.yaml'),'services:\n  catalog-init:\n    volumes:\n      - ./.verification/stale:/app/catalog/real:ro\n');
  projects.add(staleProject);
  const stale=run('stale-pre-start',['compose','-p',staleProject,...polling,'-f','stale.verify.yaml','up','--no-build'],{timeout:155000,expected:null});
  assert.notEqual(stale.status,0);assert((stale.stdout+stale.stderr).includes('Каталог не подготовлен.'));assert(!(stale.stdout+stale.stderr).includes('polling_started'));
  const demoProject=project+'-demo';compose(demoProject,['compose.yaml','demo.verify.yaml'],['up','--build','-d','--wait'],{timeout:120000});
  const demo=compose(demoProject,['compose.yaml','demo.verify.yaml'],['exec','-T','app','node','dist/scripts/organizer-check.js'],{timeout:45000});assert(demo.stdout.includes('PASS'));
  compose(demoProject,['compose.yaml','demo.verify.yaml'],['restart']);
  const persistence=compose(demoProject,['compose.yaml','demo.verify.yaml'],['exec','-T','app','node','dist/scripts/organizer-check.js','--restart'],{timeout:45000});assert(persistence.stdout.includes('PASS'));
  const after=ids.length?run('existing-after',['inspect','--format','{{.Id}} {{.State.StartedAt}} {{.RestartCount}}',...ids]).stdout:'';assert.equal(after,before);passed=true;
}catch(e){console.error(e.message);process.exitCode=1;}
finally{
  for(const p of projects){const files=p.endsWith('-demo')?['compose.yaml','demo.verify.yaml']:p.endsWith('-stale')?['compose.polling.yaml','polling.verify.yaml','stale.verify.yaml']:['compose.polling.yaml','polling.verify.yaml'];
    try{run('cleanup-'+p,['compose','-p',p,...(existsSync(resolve(candidate,'.env.public'))?['--env-file','.env.public']:[]),...files.flatMap(f=>['-f',f]),'down','--volumes','--remove-orphans'],{timeout:30000});}catch(e){console.error(e.message);passed=false;process.exitCode=1;}}
  const report={result:passed?'PASS':'FAIL',project,image,candidate,network:'none',realMAXRequests:0,existingContainersUnchanged:passed,cleanBuildBenchmark:false,results};
  writeFileSync(resolve(root,'container.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
