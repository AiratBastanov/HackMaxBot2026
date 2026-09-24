import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Новый project и том; обычный rebuild, не финальный clean benchmark.
const root=resolve('.review/user-readiness');mkdirSync(root,{recursive:true});
const scratch=mkdtempSync(resolve(root,'docker-')),project=`maxbot-readiness-${Date.now()}`,image=`${project}:test`,results=[];
const inputs=['src','tests','scripts'].flatMap(dir=>readdirSync(dir,{recursive:true}).filter(p=>/\.(ts|mjs)$/.test(p)).map(p=>`${dir}/${p.replaceAll('\\','/')}`))
  .concat(['Dockerfile','package.json','package-lock.json','tsconfig.json','.npmrc']).sort();
const hash=createHash('sha256');for(const p of inputs) hash.update(p+'\0').update(readFileSync(p).toString().replaceAll('\r\n','\n'));
const sourceVersion=hash.digest('hex');
function command(name,args,timeout=60000) {
  const began=Date.now(),p=spawnSync('docker',args,{encoding:'utf8',timeout,maxBuffer:12*1024*1024,env:{...process.env,SOURCE_VERSION:sourceVersion}});
  writeFileSync(resolve(root,`${name}.log`),(p.stdout??'')+(p.stderr??''));
  const row={name,result:p.status===0?'PASS':'FAIL',durationMs:Date.now()-began,exitCode:p.status};results.push(row);
  writeFileSync(resolve(root,'docker.json'),JSON.stringify({project,image,sourceVersion,cleanBuild:false,volumesPreserved:true,results},null,2));console.log(JSON.stringify(row));
  if(p.status!==0) throw Error(`DOCKER_CHECK_FAILED_${name}`);return p.stdout;
}
const override=resolve(scratch,'compose.image.yaml');writeFileSync(override,JSON.stringify({services:{app:{image}}}));
const compose=['compose','-p',project,'-f',resolve('compose.flow-test.yaml'),'-f',override];
let started=false;
try {
  command('docker-build',[...compose,'build','app'],300000);started=true;
  command('docker-up',[...compose,'up','-d','--no-build','--wait']);
  command('docker-journey',[...compose,'exec','-T','app','node','dist/scripts/flow-container-smoke.js'],180000);
  command('docker-restart',[...compose,'restart','app']);command('docker-ready-after-restart',[...compose,'up','-d','--no-build','--wait']);
  command('docker-after-restart',[...compose,'exec','-T','app','node','dist/scripts/flow-container-smoke.js','--verify-restart']);
  const inspected=JSON.parse(command('docker-image-inspect',['image','inspect',image]));assert.equal(inspected[0].Config.User,'node');
  writeFileSync(resolve(root,'docker-artifact.json'),JSON.stringify({imageId:inspected[0].Id,user:'node',sourceVersion,realMax:false,cleanBuild:false},null,2));
} catch(e) {console.error(e.message);process.exitCode=1;}
finally {if(started) command('docker-stop',[...compose,'stop']);}
