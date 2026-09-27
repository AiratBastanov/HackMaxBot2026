// Единственный изолированный runtime smoke R27. Без MAX/каталожной сети и чужих томов.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('.review/flow-corrections'),project='maxbot-corrections-'+Date.now(),image=project+':test';mkdirSync(root,{recursive:true});
assert(/^maxbot-corrections-\d+$/.test(project));
const hash=createHash('sha256');
for(const dir of ['src','scripts','tests'])for(const p of readdirSync(dir,{recursive:true}).filter(p=>/\.(ts|mjs)$/.test(p)).sort())hash.update(dir+'/'+p.replaceAll('\\','/')+'\0').update(readFileSync(resolve(dir,p),'utf8').replaceAll('\r\n','\n'));
const sourceHash=hash.digest('hex'),results=[];
function command(name,args,timeout=20000){
  const start=Date.now(),p=spawnSync('docker',args,{encoding:'utf8',timeout,maxBuffer:12*1024*1024,windowsHide:true});
  writeFileSync(resolve(root,project+'-'+name+'.log'),(p.stdout??'')+(p.stderr??''));results.push({name,exitCode:p.status,elapsedMs:Date.now()-start,error:p.error?.code??null});
  if(p.status!==0)throw Error('DOCKER_'+name+': '+(p.stderr??'').slice(-1000));return p.stdout.trim();
}
const file=resolve(root,project+'.compose.json');
writeFileSync(file,JSON.stringify({services:{app:{image,build:{context:resolve('.'),target:'runtime',args:{SOURCE_VERSION:sourceHash}},
  command:['node','dist/scripts/corrections-walkthrough.js','/app/runtime/evidence'],network_mode:'none',volumes:['disposable:/app/runtime'],
  read_only:true,tmpfs:['/tmp'],cap_drop:['ALL'],security_opt:['no-new-privileges:true'],healthcheck:{disable:true},restart:'no',init:true}},volumes:{disposable:{}}},null,2));
const compose=['compose','-p',project,'-f',file];let created=false,unchanged=false,passed=false;
try {
  const ids=command('existing-ids',['ps','-q']).split(/\s+/).filter(Boolean);
  const inspect=()=>ids.length?command('existing-state-'+results.length,['inspect','--format','{{.Id}} {{.State.StartedAt}} {{.RestartCount}}',...ids]):'';
  const before=inspect();command('build',[...compose,'build','app'],240000);created=true;
  const output=command('smoke',[...compose,'up','--no-build','--abort-on-container-exit','--exit-code-from','app'],45000);
  assert(output.includes('"result":"PASS"'));unchanged=before===inspect();assert(unchanged);passed=true;
}catch(e){console.error(e.message);process.exitCode=1;}
finally {
  if(created)try{command('remove-disposable',[...compose,'down','--volumes']);}catch(e){console.error(e.message);process.exitCode=1;passed=false;}
  const receipt={result:passed?'PASS':'FAIL',project,image,sourceHash,existingContainersUnchanged:unchanged,simulatedMAX:true,network:'none',cleanBuildBenchmark:false,results};
  writeFileSync(resolve(root,'container.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}
