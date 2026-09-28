// Один isolated smoke на фактическом bundled каталоге; без сети, токена и рабочих томов.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('.review/multi-city'),project='maxbot-multi-city-'+Date.now(),image=project+':test';mkdirSync(root,{recursive:true});
assert(/^maxbot-multi-city-\d+$/.test(project));const hash=createHash('sha256');
for(const dir of ['src','scripts','tests'])for(const path of readdirSync(dir,{recursive:true}).filter(p=>/\.(ts|mjs)$/.test(p)).sort())hash.update(dir+'/'+path.replaceAll('\\','/')+'\0').update(readFileSync(resolve(dir,path),'utf8').replaceAll('\r\n','\n'));
const sourceHash=hash.digest('hex'),pointer=JSON.parse(readFileSync('catalog/real/active.json','utf8')),catalogSha256=createHash('sha256').update(readFileSync('catalog/real/'+pointer.snapshot)).digest('hex'),results=[];
function command(name,args,timeout=20000){const start=Date.now(),child=spawnSync('docker',args,{encoding:'utf8',timeout,maxBuffer:12*1024*1024,windowsHide:true});
 writeFileSync(resolve(root,project+'-'+name+'.log'),(child.stdout??'')+(child.stderr??''));results.push({name,exitCode:child.status,elapsedMs:Date.now()-start,error:child.error?.code??null});
 if(child.status!==0)throw Error('DOCKER_'+name+': '+(child.stderr??'').slice(-1000));return child.stdout.trim();}
const file=resolve(root,project+'.compose.json');
writeFileSync(file,JSON.stringify({services:{app:{image,build:{context:resolve('.'),target:'runtime',args:{SOURCE_VERSION:sourceHash}},
 command:['node','dist/scripts/multi-city-container-smoke.js',catalogSha256],network_mode:'none',volumes:['disposable:/app/runtime'],
 read_only:true,tmpfs:['/tmp'],cap_drop:['ALL'],security_opt:['no-new-privileges:true'],healthcheck:{disable:true},restart:'no',init:true}},volumes:{disposable:{}}},null,2));
const compose=['compose','-p',project,'-f',file];let created=false,unchanged=false,passed=false;
try{const ids=command('existing-ids',['ps','-q']).split(/\s+/).filter(Boolean),inspect=()=>ids.length?command('existing-state-'+results.length,['inspect','--format','{{.Id}} {{.State.StartedAt}} {{.RestartCount}}',...ids]):'';
 const before=inspect();command('build',[...compose,'build','app'],240000);created=true;
 const output=command('smoke',[...compose,'up','--no-build','--abort-on-container-exit','--exit-code-from','app'],90000);assert(output.includes('"result":"PASS"'));
 unchanged=before===inspect();assert(unchanged);passed=true;
}catch(e){console.error(e.message);process.exitCode=1;}
finally{if(created)try{command('remove-disposable',[...compose,'down','--volumes']);}catch(e){console.error(e.message);process.exitCode=1;passed=false;}
 const receipt={result:passed?'PASS':'FAIL',project,image,sourceHash,catalogSha256,existingContainersUnchanged:unchanged,simulatedMAX:true,network:'none',cleanBuildBenchmark:false,results};
 writeFileSync(resolve(root,'container.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));}
