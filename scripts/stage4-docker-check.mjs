import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { stage4Fixture } from '../dist/src/culture/stage4-fixture.js';

// Только Docker daemon, уже разрешённый для локальной проверки. Все env здесь вымышленные.
const root=resolve('.review/stage4');mkdirSync(root,{recursive:true});
const previous=process.argv.includes('--resume')?JSON.parse(readFileSync(resolve(root,'docker.json'),'utf8')):null;
const project=previous?.project??`maxbot-stage4-${Date.now()}`, image=previous?.image??`${project}:test`,results=previous?.results??[];
const scratch=previous?readdirSync(root).filter(p=>p.startsWith('docker-')).map(p=>resolve(root,p)).find(p=>{try{return JSON.parse(readFileSync(resolve(p,'compose.image.yaml'),'utf8')).services.app.image===image;}catch{return false;}}):mkdtempSync(resolve(root,'docker-'));
assert(scratch&&/^maxbot-stage4-\d+$/.test(project)&&image===`${project}:test`);
const runtimeInputs=['src','tests','scripts'].flatMap(dir=>readdirSync(dir,{recursive:true}).filter(p=>/\.(ts|mjs)$/.test(p)).map(p=>`${dir}/${p.replaceAll('\\','/')}`)).concat(['Dockerfile','package.json','package-lock.json','tsconfig.json','.npmrc']).sort();
const sourceHash=createHash('sha256');for(const p of runtimeInputs) sourceHash.update(p+'\0').update(readFileSync(p).toString().replaceAll('\r\n','\n'));
const sourceVersion=previous?.sourceVersion??sourceHash.digest('hex');
function command(name,args,timeout=60000) {
  const started=Date.now();const p=spawnSync('docker',args,{encoding:'utf8',timeout,maxBuffer:12*1024*1024,env:{...process.env,SOURCE_VERSION:sourceVersion}});
  writeFileSync(resolve(root,`${name}.log`),(p.stdout??'')+(p.stderr??''));
  const row={name,result:p.status===0?'PASS':'FAIL',durationMs:Date.now()-started,exitCode:p.status};results.push(row);
  writeFileSync(resolve(root,'docker.json'),JSON.stringify({project,image,sourceVersion,cleanBuild:false,results},null,2));console.log(JSON.stringify(row));
  if(p.status!==0) throw Error(`DOCKER_CHECK_FAILED_${name}`);return p.stdout;
}
const override=resolve(scratch,'compose.image.yaml');writeFileSync(override,JSON.stringify({services:{app:{image}}}));
const compose=['compose','-p',project,'-f',resolve('compose.flow-test.yaml'),'-f',override];
let started=false;
try {
  if(!previous) command('docker-build',[...compose,'build','app'],300000);
  started=true;
  command(previous?'docker-resume-ready':'docker-up',[...compose,'up','-d','--no-build','--wait'],60000);
  if(!previous) {
    command('docker-journey',[...compose,'exec','-T','app','node','dist/scripts/flow-container-smoke.js'],180000);
    command('docker-restart',[...compose,'restart','app']);
    command('docker-ready-after-restart',[...compose,'up','-d','--no-build','--wait']);
  }
  command('docker-after-restart',[...compose,'exec','-T','app','node','dist/scripts/flow-container-smoke.js','--verify-restart'],60000);
  const secrets=resolve(scratch,'secrets');mkdirSync(secrets);
  writeFileSync(resolve(secrets,'max_bot_token'),'synthetic-only-token-no-network');writeFileSync(resolve(secrets,'max_webhook_secret'),'synthetic-test-secret-000000000000000000');
  const fixture=resolve(scratch,'synthetic-current.json');writeFileSync(fixture,JSON.stringify(stage4Fixture(new Date())));
  const envFile=resolve(scratch,'placeholder.env');
  writeFileSync(envFile,[`SOURCE_VERSION=${sourceVersion}`,'PUBLIC_HOST=test.example.org','ACME_EMAIL=operator@example.org',`MAX_SECRETS_DIR=${secrets.replaceAll('\\','/')}`,`LIVE_SNAPSHOT_PATH=${fixture.replaceAll('\\','/')}`,'MAX_EXPECTED_BOT_ID=777','PROBE_TESTER_IDS=9007199254740993,9007199254740995','LIVE_SCOPE_CONFIRMED=true'].join('\n'));
  const parsed=JSON.parse(command('compose-preflight',['compose','--env-file',envFile,'-p',`${project}-preflight`,'-f','deploy/compose.public.yaml','config','--format','json']));
  const app=parsed.services.app;
  assert.equal(app.environment.HOST,'0.0.0.0');assert.equal(app.environment.FLOW_DATA_MODE,'synthetic-test');assert.equal(app.environment.PUBLIC_DISPLAY,'NOT_CLEARED');
  assert.equal(app.environment.MAX_BOT_TOKEN_FILE,'/run/secrets/max_bot_token');assert.equal(app.environment.DATA_SNAPSHOT_PATH,'/app/fixtures/synthetic-client-test.json');assert.equal(app.environment.FLOW_TEST_CLOCK,undefined);
  assert.equal(parsed.services.caddy.environment.PUBLIC_HOST,'test.example.org');
  assert(app.volumes.some(v=>v.type==='bind'&&v.target==='/app/fixtures/synthetic-client-test.json'&&v.read_only&&resolve(v.source)===fixture));
  assert(app.volumes.some(v=>v.type==='bind'&&v.target==='/run/secrets'&&v.read_only&&resolve(v.source)===secrets));
  const runtimeEnv=resolve(scratch,'container.env');writeFileSync(runtimeEnv,Object.entries(app.environment).map(([k,v])=>`${k}=${v}`).join('\n'));
  command('container-preflight',['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--env-file',runtimeEnv,'--mount',`type=volume,source=${project}_flow-test-data,target=/app/runtime`,'--mount',`type=bind,source=${secrets},target=/run/secrets,readonly`,'--mount',`type=bind,source=${fixture},target=/app/fixtures/synthetic-client-test.json,readonly`,image,'node','dist/scripts/live-preflight.js']);
  const inspection=JSON.parse(command('image-inspect',['image','inspect',image]));assert.equal(inspection[0].Config.User,'node');
  writeFileSync(resolve(root,'docker-artifact.json'),JSON.stringify({imageId:inspection[0].Id,user:inspection[0].Config.User,sourceVersion,snapshotMount:true,secretMount:true,placeholderInterpolation:true,appBinding:'0.0.0.0:3000',providerDisplay:'NOT_CLEARED',volumesPreserved:true},null,2));
} catch(e) {console.error(e.message);process.exitCode=1;}
finally {if(started) command('docker-stop',[...compose,'stop'],60000);}
