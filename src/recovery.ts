import Database from 'better-sqlite3';
import { closeSync, existsSync, linkSync, lstatSync, mkdirSync, openSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';

type Identity=Pick<Config,'mode'|'botId'>;
type Receipt={schema:2|3;identity:string;createdAt:string;integrity:'ok';state:string};
const meta=(db:Database.Database,key:string)=>(db.prepare('SELECT value FROM meta WHERE key=?').get(key) as {value:string}|undefined)?.value;
const set=(db:Database.Database,key:string,value:string)=>db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
function inspect(db:Database.Database,expected:Identity) {
  if(![2,3].includes(Number(db.pragma('user_version',{simple:true})))) throw Error('RECOVERY_UNSUPPORTED_SCHEMA');
  if(db.pragma('integrity_check',{simple:true})!=='ok'||(db.pragma('foreign_key_check') as unknown[]).length) throw Error('RECOVERY_INTEGRITY');
  if(meta(db,'identity')!==`${expected.mode}:${expected.botId}`) throw Error('RECOVERY_WRONG_IDENTITY');
}
function open(path:string,readonly=true) {
  if(statSync(path).size>256*1024*1024) throw Error('RECOVERY_SIZE_LIMIT');
  return new Database(path,{readonly,fileMustExist:true,timeout:1000});
}
// Только явно заданные private/ignored каталоги этого проекта, без symlink/junction выхода.
export function privateTarget(path:string) {
  const root=realpathSync(process.cwd()), full=resolve(path), rel=relative(root,full);
  if(!['runtime','backups','.tmp','.review'].includes(rel.split(sep)[0]!)||!full.endsWith('.sqlite')) throw Error('RECOVERY_PRIVATE_PATH_REQUIRED');
  let current=dirname(full);
  while(!existsSync(current)) current=dirname(current);
  if(relative(root,realpathSync(current)).startsWith('..')||lstatSync(current).isSymbolicLink()) throw Error('RECOVERY_PATH_ESCAPE');
  if(existsSync(full)||existsSync(full+'-wal')||existsSync(full+'-shm')) throw Error('RECOVERY_DESTINATION_EXISTS');
  mkdirSync(dirname(full),{recursive:true});return full;
}
async function copy(source:Database.Database,target:string,finalize:(db:Database.Database)=>Receipt) {
  const destination=privateTarget(target), partial=`${destination}.recovery-${randomUUID()}`;
  closeSync(openSync(partial,'wx',0o600));
  try {
    const deadline=Date.now()+60000;
    await source.backup(partial,{progress:()=>{if(Date.now()>deadline) throw Error('RECOVERY_DEADLINE');return 128;}});
    const db=open(partial,false);let result:Receipt;
    try {result=finalize(db);db.pragma('wal_checkpoint(TRUNCATE)');db.pragma('journal_mode=DELETE');}
    finally {db.close();}
    // Эксклюзивная публикация готового файла; существующий путь не заменяется.
    linkSync(partial,destination);return result;
  } finally {if(existsSync(partial)) unlinkSync(partial);}
}
export async function backupDatabase(source:string,target:string,expected:Identity):Promise<Receipt> {
  const db=open(source);
  try {
    inspect(db,expected);
    if(['BACKUP','QUARANTINED'].includes(meta(db,'recovery_state')??'')) throw Error('RECOVERY_SOURCE_UNRESOLVED');
    return await copy(db,target,output=>{
      inspect(output,expected);
      const receipt:Receipt={schema:Number(output.pragma('user_version',{simple:true})) as 2|3,identity:meta(output,'identity')!,createdAt:new Date().toISOString(),integrity:'ok',state:'BACKUP'};
      output.transaction(()=>{set(output,'backup_manifest',JSON.stringify(receipt));set(output,'recovery_state','BACKUP');}).immediate();
      inspect(output,expected);return receipt;
    });
  } finally {db.close();}
}
export async function restoreDatabase(source:string,target:string,expected:Identity):Promise<Receipt> {
  const db=open(source);
  try {
    inspect(db,expected);const manifest=JSON.parse(meta(db,'backup_manifest')??'null') as Receipt|null;
    if(meta(db,'recovery_state')!=='BACKUP'||!manifest||manifest.schema!==db.pragma('user_version',{simple:true})||manifest.identity!==`${expected.mode}:${expected.botId}`||manifest.integrity!=='ok'||!Number.isFinite(Date.parse(manifest.createdAt))) throw Error('RECOVERY_INVALID_BACKUP');
    return await copy(db,target,output=>{
      inspect(output,expected);const now=Date.now();
      output.transaction(()=>{
        set(output,'recovery_state','QUARANTINED');set(output,'restored_at',new Date(now).toISOString());
        output.prepare('DELETE FROM flow_actions').run();
        if(manifest.schema===3) {output.prepare('DELETE FROM flow_screens').run();output.prepare('DELETE FROM ui_messages').run();}
        output.prepare("UPDATE outbox SET payload=NULL,status='RECOVERY_SUPPRESSED',result='OLD_SNAPSHOT',finished_at=COALESCE(finished_at,?),message_mid=NULL").run(now);
        output.prepare("UPDATE inbox SET payload=NULL,status='PROCESSED',result='OLD_SNAPSHOT',finished_at=COALESCE(finished_at,?)").run(now);
        output.prepare("UPDATE probes SET state='SUPERSEDED',question_mid=NULL").run();
      }).immediate();
      inspect(output,expected);
      return {...manifest,state:'QUARANTINED'};
    });
  } finally {db.close();}
}
// Только остановленная НОВАЯ восстановленная копия. Отказ от старой персонализации явный.
export function discardRestoredPersonalization(path:string,expected:Identity,confirmation:string):Receipt {
  if(confirmation!=='DISCARD_RESTORED_PERSONALIZATION') throw Error('RECOVERY_CONFIRMATION_REQUIRED');
  const db=open(path,false);
  try {
    inspect(db,expected);
    if(meta(db,'recovery_state')!=='QUARANTINED') throw Error('RECOVERY_NOT_QUARANTINED');
    db.transaction(()=>{
      for(const table of ['bookmarks','flow_states','flow_actions','contacts','probes','inbox','outbox']) db.exec(`DELETE FROM ${table}`);
      if(db.pragma('user_version',{simple:true})===3) {db.prepare('DELETE FROM flow_screens').run();db.prepare('DELETE FROM ui_messages').run();}
      set(db,'recovery_state','RESOLVED_DISCARDED');set(db,'recovery_cutoff',String(Date.now()));
    }).immediate();
    inspect(db,expected);
    return {schema:Number(db.pragma('user_version',{simple:true})) as 2|3,identity:meta(db,'identity')!,createdAt:new Date().toISOString(),integrity:'ok',state:'RESOLVED_DISCARDED'};
  } finally {db.close();}
}
