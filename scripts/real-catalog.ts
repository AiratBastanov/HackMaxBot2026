import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { InstitutionClient, atomicJson } from '../src/data/institution-http.js';
import { collectInstitutions, reparse, preparedSchema, privateCampaign, activate, type CandidateFile } from '../src/data/real-refresh.js';
import { snapshotDigest } from '../src/data/source-policy.js';
import { Catalog } from '../src/culture/catalog.js';
import { collectExtended } from '../src/data/extended-institutions.js';

const [command,...args]=process.argv.slice(2);
try {
  if(command==='collect'||command==='reparse'||command==='refresh') {
    if(!args[0])throw Error('CAMPAIGN_REQUIRED');
    const root=privateCampaign(args[0]),client=new InstitutionClient(root);
    if(command!=='reparse'){await collectInstitutions(client);await collectExtended(client,new Date().toISOString());}
    const prepared=preparedSchema.parse(JSON.parse(readFileSync('catalog/real/prepared-facts.json','utf8')));
    const destination=resolve(args[1]??'runtime/catalog');
    if(command==='refresh'&&destination!==resolve('runtime/catalog'))throw Error('REFRESH_TARGET');
    const previous=Catalog.load({flowDataMode:'real',snapshotPath:resolve(process.env.DATA_SNAPSHOT_PATH??'catalog/real/active.json')} as any);
    const candidate=reparse(client,prepared,new Date().toISOString(),Number(process.env.REAL_FRESHNESS_HOURS??72),previous.availableCities.flatMap(c=>previous.forCity(c)??[]));
    const hash=snapshotDigest(candidate),path=resolve(root,'candidate-'+hash.slice(0,20)+'.json');atomicJson(path,candidate);
    const activated=command==='refresh'?activate(candidate,hash,destination,Date.now(),true):false;
    console.log(JSON.stringify({candidate:path,sha256:hash,records:candidate.snapshots.reduce((n,s)=>n+s.events.length,0),reviewQueue:candidate.reviewQueue,changes:candidate.changes,sources:candidate.sourceStatus,mode:'OPERATOR_CLI',activated}));
  }else if(command==='activate') {
    if(args.length!==3)throw Error('USE_ACTIVATE_CANDIDATE_SHA_DESTINATION');
    const path=resolve(args[0]!);privateCampaign(resolve(path,'..'));
    const candidate=JSON.parse(readFileSync(path,'utf8')) as CandidateFile;
    const target=resolve(args[2]!);if(target!==resolve('catalog/real')&&target!==resolve('runtime/catalog')&&!target.startsWith(resolve('runtime/max-test')+sep))throw Error('ACTIVATION_TARGET');
    console.log(JSON.stringify(activate(candidate,args[1]!,target,Date.now(),process.env.ADMISSION_MODE==='PUBLIC')));
  }else throw Error('USE_COLLECT_REPARSE_OR_ACTIVATE');
}catch(e){console.error(e instanceof Error?e.message:'REAL_CATALOG_FAILED');process.exitCode=1;}
