// Локальная проверка существующего public Compose. Никаких live credentials, Caddy, портов или MAX.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, renameSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const baseline='a72b77aabdbf88da97fb154873e82115a2557865';
const name='maxbot-r19-smoke-'+Date.now(),root=resolve('runtime/max-test',name),evidence=resolve('.review/real-webhook-r19');
mkdirSync(root,{recursive:true});mkdirSync(evidence,{recursive:true});
const inputs=['Dockerfile','package.json','package-lock.json','tsconfig.json','.npmrc','.dockerignore','deploy/compose.public.yaml','deploy/Caddyfile'];
function walk(dir){for(const item of readdirSync(dir,{withFileTypes:true})){assert(!item.isSymbolicLink());const path=dir+'/'+item.name;if(item.isDirectory())walk(path);else inputs.push(path);}}
for(const dir of ['src','tests','scripts','catalog/real'])walk(dir);
const manifest=inputs.sort().map(path=>createHash('sha256').update(readFileSync(path)).digest('hex')+'  '+path).join('\n')+'\n';
const sourceVersion=createHash('sha256').update(manifest).digest('hex');writeFileSync(resolve(evidence,'runtime-source.sha256'),manifest);
const catalog=resolve(root,'catalog'),secrets=resolve(root,'secrets');mkdirSync(catalog);mkdirSync(secrets);
const current=JSON.parse(readFileSync('catalog/real/active.json','utf8'));
const old={version:1,snapshot:'6b96474106ae4a2018b5.json',review:'6b96474106ae4a2018b5.review.json'};
assert.notEqual(current.snapshot,old.snapshot);
for(const f of new Set([old.snapshot,old.review,current.snapshot,current.review]))copyFileSync(resolve('catalog/real',f),resolve(catalog,f));
writeFileSync(resolve(catalog,'active.json'),JSON.stringify(old));
writeFileSync(resolve(secrets,'max_bot_token'),'offline-webhook-smoke-token');
writeFileSync(resolve(secrets,'max_webhook_secret'),'offline-webhook-secret-000000000000000000');
const slash=p=>p.replaceAll('\\','/'),envPath=resolve(root,'offline.env'),override=resolve(root,'offline.yaml');
writeFileSync(envPath,[`SOURCE_VERSION=${sourceVersion}`,`PUBLIC_HOST=offline-webhook.example.org`,`PUBLIC_BASE_URL=https://offline-webhook.example.org`,`ACME_EMAIL=offline@example.org`,`MAX_SECRETS_DIR=${slash(secrets)}`,`REAL_CATALOG_DIR=${slash(catalog)}`,'MAX_EXPECTED_BOT_ID=777','PROBE_TESTER_IDS=9007199254740993','LIVE_SCOPE_CONFIRMED=true','LIVE_EXCLUSIVE_CONSUMER_CONFIRMED=true'].join('\n')+'\n');
writeFileSync(override,`services:\n  app:\n    image: maxbot-real-webhook:r19\n    network_mode: none\n    restart: "no"\n    command: ["node", "dist/scripts/webhook-profile-smoke.js"]\n`);
const args=['compose','--project-name',name,'--env-file',envPath,'-f','deploy/compose.public.yaml','-f',override];
function run(cmd,a,ms=60000){const p=spawnSync(cmd,a,{encoding:'utf8',timeout:ms,maxBuffer:8*1024*1024,windowsHide:true});if(p.status!==0)throw Error(cmd+' failed: '+(p.stderr||p.stdout).slice(-2400));return a[0]==='logs'?p.stdout+p.stderr:p.stdout;}
const report={baseline,sourceVersion,at:new Date().toISOString(),scope:'LOCAL_INTEGRATION_SMOKE',container:name,network:'none',ports:[],caddy:'NOT_STARTED',current:current.snapshot,results:{},stopped:false};
const save=()=>writeFileSync(resolve(evidence,'container.json'),JSON.stringify(report,null,2));save();
let created=false;
try {
  run('docker',[...args,'config','--quiet']);
  const resolved=JSON.parse(run('docker',[...args,'config','--format','json'])),app=resolved.services.app;
  assert.equal(app.environment.APP_INGRESS,'webhook');assert.equal(app.environment.FLOW_DATA_MODE,'real');assert.equal(app.environment.DATA_SNAPSHOT_PATH,'/app/catalog/real/active.json');assert.equal(app.network_mode,'none');assert.equal(app.read_only,true);assert.equal(app.user,'1000:1000');assert(!app.ports?.length);
  assert(app.volumes.some(v=>v.target==='/app/catalog/real'&&v.read_only&&v.source===slash(catalog)));
  assert(app.volumes.some(v=>v.target==='/run/secrets'&&v.read_only));
  report.results.compose='PASS';save();
  if(process.argv.includes('--reuse-image'))report.results.build='REUSED_FOR_DIAGNOSTIC';
  else {const build=spawnSync('docker',[...args,'build','app'],{encoding:'utf8',timeout:300000,maxBuffer:12*1024*1024,windowsHide:true});
  writeFileSync(resolve(evidence,'build.log'),(build.stdout??'')+(build.stderr??''));assert.equal(build.status,0,'BUILD');report.results.build='PASS';}save();
  run('docker',[...args,'run','--no-deps','-d','--name',name,'app']);created=true;
  const firstExit=run('docker',['wait',name],180000).trim();
  const first=run('docker',['logs',name]);writeFileSync(resolve(evidence,'container-first.log'),first);assert.equal(firstExit,'0',first);
  const inspect=JSON.parse(run('docker',['inspect',name]))[0];
  assert.equal(inspect.HostConfig.NetworkMode,'none');assert.equal(inspect.HostConfig.ReadonlyRootfs,true);assert.equal(inspect.Config.User,'1000:1000');assert.deepEqual(inspect.HostConfig.PortBindings,{});
  if(!process.argv.includes('--reuse-image'))assert.equal(inspect.Config.Labels['org.opencontainers.image.revision'],sourceVersion);
  report.results.first=JSON.parse(first.trim().split('\n').at(-1));save();
  // Та же directory mount и тот же container; только атомарная смена reviewed pointer.
  writeFileSync(resolve(catalog,'next.tmp'),JSON.stringify(current));renameSync(resolve(catalog,'next.tmp'),resolve(catalog,'active.json'));
  run('docker',['start',name]);const secondExit=run('docker',['wait',name],180000).trim();
  const all=run('docker',['logs',name]);writeFileSync(resolve(evidence,'container.log'),all);assert.equal(secondExit,'0',all);
  report.results.second=JSON.parse(all.trim().split('\n').at(-1));assert.equal(report.results.second.phase,'restart-current-and-failures');
  report.results.catalogFiles=[current.snapshot,current.review].map(path=>({path,sha256:createHash('sha256').update(readFileSync(resolve(catalog,path))).digest('hex')}));
} finally {
  if(created){run('docker',['stop','-t','20',name]);run('docker',['rm',name]);}
  // Только volume/network уникального одноразового проекта; другие процессы/данные не затрагиваются.
  run('docker',[...args,'down','--volumes']);report.stopped=true;save();
}
console.log(JSON.stringify(report));
