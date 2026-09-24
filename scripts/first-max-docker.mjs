import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const output='.review/first-max-session';mkdirSync(output,{recursive:true});
const image='maxbot-first-max-session:review';
const started=Date.now();
const build=spawnSync('docker',['build','--tag',image,'.'],{encoding:'utf8',timeout:180000,maxBuffer:12*1024*1024,windowsHide:true});
writeFileSync(`${output}/docker-build.log`,(build.stdout??'')+(build.stderr??''));
const receipt={result:build.status===0?'PASS':'FAIL',image,durationMs:Date.now()-started,exitCode:build.status,cleanSubmissionBenchmark:false,containerStarted:false};
if(build.status===0) {
  const inspect=spawnSync('docker',['image','inspect','--format','{{.Id}} {{.Config.User}}',image],{encoding:'utf8',timeout:10000,windowsHide:true});
  receipt.imageIdentity=inspect.status===0?inspect.stdout.trim():'NOT_VERIFIED';
} else {console.error((build.stderr??'').slice(-2000));process.exitCode=1;}
writeFileSync(`${output}/docker.json`,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
