import { randomUUID } from 'node:crypto';
import { digest } from './culture/catalog.js';
import { MaxError, type MaxOperation, type MaxResult, type MessageRequest } from './max.js';
import type { OutboxRow, Storage } from './storage.js';

type Screen = { actor:string; chat:string; epoch:string; mid:string|null; purpose:string; revision:number; force_new:number };
type Tracked = { mid:string; actor:string; chat:string; epoch:string; purpose:string; revision:number; status:string; body_hash:string|null; audience:'SYNTHETIC'|'PROVIDER'|null };
const bodyHash = (body:MessageRequest) => digest({text:body.text,attachments:body.attachments??[]});
export const activeScreen = (s:Storage,actor:string) => s.db.prepare('SELECT * FROM flow_screens WHERE actor=?').get(actor) as Screen|undefined;
const tracked = (s:Storage,mid:string) => s.db.prepare('SELECT * FROM ui_messages WHERE mid=?').get(mid) as Tracked|undefined;
export function desireScreen(s:Storage,actor:string,chat:string,revision:number,purpose:string,fresh:boolean,now:number) {
  const old=activeScreen(s,actor),epoch=!old||fresh||old.chat!==chat?randomUUID():old.epoch;
  s.db.prepare('INSERT INTO flow_screens(actor,chat,epoch,mid,purpose,revision,force_new,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(actor) DO UPDATE SET chat=excluded.chat,epoch=excluded.epoch,purpose=excluded.purpose,revision=excluded.revision,force_new=excluded.force_new,updated_at=excluded.updated_at')
    .run(actor,chat,epoch,old?.mid??null,purpose,revision,Number(fresh||!old||old.force_new===1||old.chat!==chat),now);
  return {epoch,revision,chat,purpose};
}
function target(t:Tracked) { return {mid:t.mid,recipient:t.actor,chat:t.chat}; }
function replaceReconciledScreen(s:Storage,mid:string,now:number) {
  const original=s.db.prepare("SELECT * FROM outbox WHERE purpose='culture_screen' AND status='UNKNOWN_RESULT' AND json_extract(payload,'$.mid')=? ORDER BY id DESC LIMIT 1").get(mid) as OutboxRow|undefined;
  if(!original)return;
  const op=JSON.parse(original.payload) as MaxOperation,current=activeScreen(s,original.actor);
  if(op.method!=='edit'||!op.screen||current?.epoch!==op.screen.epoch||current.revision!==op.screen.revision)return;
  s.db.prepare('UPDATE flow_screens SET force_new=1 WHERE actor=?').run(original.actor);
  s.enqueue(`ui-replacement:${original.id}`,original.actor,null,'culture_screen',
    {method:'messages',recipient:original.actor,body:op.body,audience:op.audience,displayRefs:op.displayRefs,screen:op.screen},now,original.expires_at,{revision:original.flow_revision!,catalogVersion:original.catalog_version??undefined});
}
export function queueReconciliation(s:Storage,now:number) {
  const rows=s.db.prepare("SELECT * FROM ui_messages WHERE status='UNCERTAIN' LIMIT 20").all() as Tracked[];
  for(const t of rows) {
    const key=`ui-reconcile:${t.mid}:${t.revision}`;
    const old=s.db.prepare('SELECT status FROM outbox WHERE action_key=?').get(key) as {status:string}|undefined;
    if(old&&!['PENDING','SENDING'].includes(old.status)) {s.db.prepare("UPDATE ui_messages SET status='BLOCKED' WHERE mid=?").run(t.mid);continue;}
    s.enqueue(key,t.actor,null,'culture_reconcile',{method:'read',...target(t)},now,now+60000);
  }
}
// Единственный путь изменения UI: PUT. POST /answers только снимает spinner.
export function prepareScreenOperation(s:Storage,row:OutboxRow,operation:MaxOperation,now:number):MaxOperation|null {
  let op=operation;
  if(row.purpose==='culture_screen') {
    const current=activeScreen(s,row.actor);
    if(!op.screen||!current||current.epoch!==op.screen.epoch||current.revision!==op.screen.revision||current.chat!==op.screen.chat) {
      s.finishOutbox(row.id,'STALE','SCREEN_GENERATION_CHANGED',now);return null;
    }
    if(op.method==='messages'&&current.mid&&!current.force_new) {
      const t=tracked(s,current.mid);
      if(t?.status==='UNCERTAIN') {s.db.prepare('UPDATE outbox SET next_at=? WHERE id=?').run(now+1200,row.id);return null;}
      if(t&&t.actor===row.actor&&t.chat===current.chat&&t.status==='ACTIVE') op={...op,method:'edit',...target(t)};
    }
  }
  if(op.method==='edit'||op.method==='read'||op.method==='delete') {
    const t=tracked(s,op.mid),current=activeScreen(s,row.actor);
    const owns=t&&t.actor===row.actor&&t.actor===op.recipient&&t.chat===op.chat;
    const allowed=row.purpose==='culture_screen'?current?.mid===op.mid&&t?.status==='ACTIVE'
      :row.purpose==='culture_reconcile'?t?.status==='UNCERTAIN'
      :['culture_cleanup','culture_retire'].includes(row.purpose)&&t?.status==='OBSOLETE'&&current?.mid!==op.mid;
    if(!owns||!allowed) {s.finishOutbox(row.id,'STALE','UI_TARGET_NOT_OWNED_OR_CURRENT',now);return null;}
  }
  s.db.prepare('UPDATE outbox SET payload=? WHERE id=?').run(JSON.stringify(op),row.id);
  if(op.method==='edit') s.db.prepare("UPDATE ui_messages SET status='MUTATING',body_hash=?,revision=?,updated_at=? WHERE mid=?").run(bodyHash(op.body),op.screen?.revision??row.id,now,op.mid);
  return op;
}
function cleanup(s:Storage,t:Tracked,now:number) {
  if(t.status==='UNCERTAIN'||t.status==='BLOCKED') return;
  s.db.prepare("UPDATE ui_messages SET status='OBSOLETE' WHERE mid=?").run(t.mid);
  s.enqueue(`ui-cleanup:${t.mid}`,t.actor,null,'culture_cleanup',{method:'delete',...target(t)},now,now+60000);
}
export function completeScreenOperation(s:Storage,row:OutboxRow,op:MaxOperation,result:MaxResult,now:number,superseded:boolean) {
  if(row.purpose==='culture_reconcile'&&op.method==='read') {
    const t=tracked(s,op.mid);
    const matches=result.message&&t?.body_hash===bodyHash(result.message);
    // Не совпало/недоступно: этот mid больше не меняем; допускается новый экран.
    s.db.prepare('UPDATE ui_messages SET status=?,updated_at=? WHERE mid=?').run(matches?'ACTIVE':'BLOCKED',now,op.mid);
    if(!matches)replaceReconciledScreen(s,op.mid,now);return;
  }
  if(row.purpose==='culture_cleanup'&&op.method==='delete') {s.db.prepare("UPDATE ui_messages SET status='DELETED',body_hash=NULL WHERE mid=?").run(op.mid);return;}
  if(row.purpose==='culture_retire'&&op.method==='edit') {s.db.prepare("UPDATE ui_messages SET status='RETIRED',body_hash=NULL WHERE mid=?").run(op.mid);return;}
  if(row.purpose!=='culture_screen'||!op.screen||(op.method!=='messages'&&op.method!=='edit')) return;
  if(!result.mid||result.chat!==op.screen.chat) throw new MaxError('MALFORMED',200);
  const current=activeScreen(s,row.actor);
  const same=current?.epoch===op.screen.epoch&&current.revision===op.screen.revision;
  if(op.method==='messages') {
    s.db.prepare('INSERT INTO ui_messages(mid,actor,chat,epoch,purpose,revision,status,body_hash,updated_at,audience) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(result.mid,row.actor,op.screen.chat,op.screen.epoch,op.screen.purpose,op.screen.revision,'ACTIVE',bodyHash(op.body),now,op.audience??null);
    if(same&&!superseded) {
      const old=current.mid?tracked(s,current.mid):undefined;
      s.db.prepare('UPDATE flow_screens SET mid=?,force_new=0,updated_at=? WHERE actor=? AND epoch=? AND revision=?').run(result.mid,now,row.actor,op.screen.epoch,op.screen.revision);
      if(old&&old.mid!==result.mid) cleanup(s,old,now);
    } else cleanup(s,tracked(s,result.mid)!,now);
  } else {
    // Обновляется только подтверждённый факт доставки, не draft/actions/desired revision.
    s.db.prepare("UPDATE ui_messages SET status='ACTIVE',purpose=?,updated_at=? WHERE mid=? AND actor=?").run(op.screen.purpose,now,op.mid,row.actor);
  }
}
export function failedScreenOperation(s:Storage,row:OutboxRow,op:MaxOperation,error:MaxError,now:number,ambiguous:boolean) {
  if(op.method==='read') {s.db.prepare("UPDATE ui_messages SET status='BLOCKED' WHERE mid=?").run(op.mid);replaceReconciledScreen(s,op.mid,now);return;}
  if(op.method==='delete') {
    if(!ambiguous&&['PERMISSION','SEMANTIC'].includes(error.kind)) s.enqueue(`ui-retire:${op.mid}`,row.actor,null,'culture_retire',
      {method:'edit',...target(tracked(s,op.mid)!),body:{text:(op.audience==='SYNTHETIC'?'🧪 Демо · тестовый экран\n':'')+'Экран закрыт. Актуальные действия — в новом сообщении.',notify:false,attachments:[]}},now,now+60000);
    else s.db.prepare("UPDATE ui_messages SET status='BLOCKED' WHERE mid=?").run(op.mid);
    return;
  }
  if(op.method!=='edit') return;
  if(error.kind==='RATE_LIMIT') {s.db.prepare("UPDATE ui_messages SET status=? WHERE mid=?").run(row.purpose==='culture_retire'?'OBSOLETE':'ACTIVE',op.mid);return;}
  s.db.prepare('UPDATE ui_messages SET status=?,updated_at=? WHERE mid=?').run(ambiguous?'UNCERTAIN':'BLOCKED',now,op.mid);
  if(row.purpose==='culture_screen'&&op.screen&&!ambiguous&&['SEMANTIC','PERMISSION','HTTP'].includes(error.kind)) {
    const current=activeScreen(s,row.actor);
    if(current?.epoch===op.screen.epoch&&current.revision===op.screen.revision) {
      s.db.prepare('UPDATE flow_screens SET force_new=1 WHERE actor=?').run(row.actor);
      s.enqueue(`ui-replacement:${row.id}`,row.actor,null,'culture_screen',{method:'messages',recipient:row.actor,body:op.body,audience:op.audience,displayRefs:op.displayRefs,screen:op.screen},now,row.expires_at,{revision:row.flow_revision!,catalogVersion:row.catalog_version??undefined});
    }
  }
}
