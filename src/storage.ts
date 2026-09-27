import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Config } from './config.js';
import type { AcceptedEvent } from './contracts.js';
import type { MaxOperation } from './max.js';
import { normalizeCity, resolveCity } from './data/cities.js';
import { observeContact } from './probe.js';

export type InboxRow = { id: number; payload: string; attempts: number; received_at: number };
export type ProbeRow = { id: string; actor: string; chat: string; expires_at: number; state: string; question_mid: string | null; created_at: number };
export type ContactRow = { actor: string; chat: string; access_ts: number; access_mask: number; mute_ts: number; mute_mask: number; clear_ts: number; updated_at: number };
export type OutboxRow = { id: number; actor: string; probe_id: string | null; purpose: string; payload: string; status: string; attempts: number; expires_at: number; next_at: number; flow_revision: number | null; catalog_version: string | null };

export class Storage {
  readonly db: Database.Database;
  private readonly publicAdmission:boolean;
  constructor(path: string, config: Pick<Config, 'mode' | 'botId' | 'ingress' | 'admissionMode'>, recoverInterrupted = true) {
    this.publicAdmission=config.admissionMode==='PUBLIC';
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { timeout: 1000 });
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('foreign_keys = ON');
    const version = this.db.pragma('user_version', { simple: true });
    if (![0, 1, 2, 3, 4].includes(Number(version))) { this.db.close(); throw new Error('Версия SQLite не поддерживается'); }
    if(Number(version)>0) {
      const recovery=this.getMeta('recovery_state');
      if(recovery==='BACKUP'||recovery==='QUARANTINED') {this.db.close();throw new Error('RECOVERY_QUARANTINED');}
    }
    try { this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS inbox (
          id INTEGER PRIMARY KEY, delivery_key TEXT UNIQUE NOT NULL, kind TEXT NOT NULL,
          payload TEXT, received_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
          result TEXT, attempts INTEGER NOT NULL DEFAULT 0, finished_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS inbox_pending ON inbox(status, id);
        CREATE TABLE IF NOT EXISTS ingress_limits (actor TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS contacts (
          actor TEXT PRIMARY KEY, chat TEXT NOT NULL, access_ts INTEGER NOT NULL DEFAULT -1,
          access_mask INTEGER NOT NULL DEFAULT 0, mute_ts INTEGER NOT NULL DEFAULT -1,
          mute_mask INTEGER NOT NULL DEFAULT 0, clear_ts INTEGER NOT NULL DEFAULT -1, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS probes (
          id TEXT PRIMARY KEY, actor TEXT NOT NULL, chat TEXT NOT NULL, created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL, state TEXT NOT NULL, question_mid TEXT
        );
        CREATE INDEX IF NOT EXISTS probes_actor ON probes(actor, created_at);
        CREATE TABLE IF NOT EXISTS outbox (
          id INTEGER PRIMARY KEY, action_key TEXT UNIQUE NOT NULL, actor TEXT NOT NULL, probe_id TEXT,
          purpose TEXT NOT NULL, payload TEXT, status TEXT NOT NULL DEFAULT 'PENDING',
          attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
          next_at INTEGER NOT NULL, finished_at INTEGER, result TEXT, http_status INTEGER, message_mid TEXT
        );
        CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(status, next_at, id);
      `);
      if (Number(version) < 2) this.db.exec(`
        ALTER TABLE outbox ADD COLUMN flow_revision INTEGER;
        ALTER TABLE outbox ADD COLUMN catalog_version TEXT;
        CREATE TABLE flow_states (actor TEXT PRIMARY KEY, revision INTEGER NOT NULL, event_ts INTEGER NOT NULL, updated_at INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE TABLE flow_actions (id TEXT PRIMARY KEY, actor TEXT NOT NULL, revision INTEGER NOT NULL, purpose TEXT NOT NULL, data TEXT NOT NULL, expires_at INTEGER NOT NULL);
        CREATE INDEX flow_actions_actor ON flow_actions(actor);
        CREATE TABLE bookmarks (actor TEXT NOT NULL, identity TEXT NOT NULL, generation TEXT NOT NULL, saved_at INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(actor,identity));
        PRAGMA user_version = 2;
      `);
      if (Number(version) < 3) this.db.exec(`
        CREATE TABLE flow_screens (actor TEXT PRIMARY KEY, chat TEXT NOT NULL, epoch TEXT NOT NULL, mid TEXT,
          purpose TEXT NOT NULL, revision INTEGER NOT NULL, force_new INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE ui_messages (mid TEXT PRIMARY KEY, actor TEXT NOT NULL, chat TEXT NOT NULL, epoch TEXT NOT NULL,
          purpose TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, body_hash TEXT, updated_at INTEGER NOT NULL, audience TEXT);
        PRAGMA user_version = 3;
      `);
      // identity теперь ID закладки; event/occurrence остаются внутри исходной Card.
      // Legacy ID, generation, saved_at и JSON не меняются: старые ссылки однозначны.
      if (Number(version) < 4) this.db.exec(`
        ALTER TABLE bookmarks ADD COLUMN save_action TEXT;
        CREATE UNIQUE INDEX bookmarks_save_action ON bookmarks(actor,save_action);
        CREATE INDEX bookmarks_order ON bookmarks(actor,saved_at DESC,identity);
        DELETE FROM flow_actions WHERE purpose='save';
        PRAGMA user_version = 4;
      `);
      const identity = `${config.ingress === 'test-polling' ? 'test-polling' : config.mode}:${config.botId}`;
      const previous = this.getMeta('identity');
      if (previous && previous !== identity && !(this.publicAdmission&&config.mode==='live'&&previous===`test-polling:${config.botId}`)) throw new Error('SQLite принадлежит другому режиму/боту');
      this.setMeta('identity', identity);
      // После crash неизвестно, принял ли MAX запрос. Не отправляем повторно.
      if (recoverInterrupted) {
        this.db.prepare("UPDATE outbox SET status='UNKNOWN_RESULT', result='RESTART_DURING_SEND', finished_at=? WHERE status='SENDING'").run(Date.now());
        this.db.prepare("UPDATE ui_messages SET status='UNCERTAIN' WHERE status='MUTATING'").run();
      }
    }).immediate(); } catch (error) { this.db.close(); throw error; }
  }
  close() { this.db.close(); }
  health() { this.db.prepare('SELECT 1').get(); }
  getMeta(key: string): string | undefined { return (this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as { value: string } | undefined)?.value; }
  setMeta(key: string, value: string) { this.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }
  pollingMarker(): string | null { return JSON.parse(this.getMeta('poll_marker') ?? 'null') as string | null; }
  acceptPollBatch(events: AcceptedEvent[], marker: string | null, now: number) {
    return this.db.transaction(() => {
      let accepted = 0, duplicate = 0;
      for (const event of events) this.accept(event, now) === 'accepted' ? accepted++ : duplicate++;
      this.setMeta('poll_marker', JSON.stringify(marker));
      return { accepted, duplicate };
    }).immediate();
  }
  accept(event: AcceptedEvent, now: number): 'accepted' | 'duplicate' | 'rate_limited' {
    return this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM inbox WHERE delivery_key=?').get(event.key)) return 'duplicate' as const;
      if(this.publicAdmission) {
        const limit=this.db.prepare('SELECT window_start,count FROM ingress_limits WHERE actor=?').get(event.actor) as {window_start:number;count:number}|undefined;
        const pending=this.db.prepare("SELECT count(*) n FROM inbox WHERE status='PENDING' AND json_extract(payload,'$.actor')=?").get(event.actor) as {n:number};
        // Stop/removal применяется даже при переполнении, но не создаёт новую очередь.
        if(['bot_stopped','dialog_removed','dialog_muted','dialog_cleared'].includes(event.kind))observeContact(this,event,now);
        if(pending.n>=8||limit&&now-limit.window_start<60000&&limit.count>=30)return 'rate_limited' as const;
        this.db.prepare(`INSERT INTO ingress_limits(actor,window_start,count) VALUES(?,?,1) ON CONFLICT(actor) DO UPDATE SET
          count=CASE WHEN ?-window_start>=60000 THEN 1 ELSE count+1 END, window_start=CASE WHEN ?-window_start>=60000 THEN ? ELSE window_start END`)
          .run(event.actor,now,now,now,now);
      }
      const cutoff=Number(this.getMeta('recovery_cutoff')??0);
      if(event.timestamp<=cutoff) {
        this.db.prepare("INSERT INTO inbox(delivery_key,kind,received_at,status,result,finished_at) VALUES(?,?,?,'PROCESSED','PRE_RECOVERY_EVENT',?)").run(event.key,event.kind,now,now);
        return 'accepted' as const;
      }
      const backlog = this.db.prepare("SELECT count(*) n FROM inbox WHERE status='PENDING'").get() as { n: number };
      if (backlog.n >= 1000) throw new Error('INBOX_FULL');
      let accepted=event;
      if(event.input && /^[\p{L} -]+$/u.test(event.input)) {
        const state=this.db.prepare('SELECT data FROM flow_states WHERE actor=?').get(event.actor) as {data:string}|undefined;
        const cityInput=state&&JSON.parse(state.data).stage==='city';
        accepted={...event,input:cityInput?(resolveCity(event.input).length?normalizeCity(event.input):'?'):undefined};
      }
      this.db.prepare('INSERT INTO inbox(delivery_key,kind,payload,received_at) VALUES(?,?,?,?)').run(event.key, event.kind, JSON.stringify(accepted), now);
      return 'accepted' as const;
    }).immediate();
  }
  pendingInbox(limit: number): InboxRow[] { return this.db.prepare("SELECT id,payload,attempts,received_at FROM inbox WHERE status='PENDING' ORDER BY id LIMIT ?").all(limit) as InboxRow[]; }
  finishInbox(id: number, result: string, now: number) { this.db.prepare("UPDATE inbox SET status='PROCESSED',result=?,finished_at=? WHERE id=?").run(result, now, id); }
  contact(actor: string) { return this.db.prepare('SELECT * FROM contacts WHERE actor=?').get(actor) as ContactRow | undefined; }
  probe(id: string) { return this.db.prepare('SELECT * FROM probes WHERE id=?').get(id) as ProbeRow | undefined; }
  latestProbe(actor: string) { return this.db.prepare('SELECT * FROM probes WHERE actor=? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(actor) as ProbeRow | undefined; }
  enqueue(key: string, actor: string, probeId: string | null, purpose: string, operation: MaxOperation, now: number, expires: number,
    fence?: { revision: number; catalogVersion?: string }) {
    if(operation.method!=='answers'&&operation.recipient!==actor)throw Error('OUTGOING_ACTOR_MISMATCH');
    if(this.publicAdmission) {
      const pending=this.db.prepare("SELECT count(*) n FROM outbox WHERE actor=? AND status IN ('PENDING','SENDING')").get(actor) as {n:number};
      if(pending.n>=16)return;
    }
    this.db.prepare('INSERT OR IGNORE INTO outbox(action_key,actor,probe_id,purpose,payload,created_at,expires_at,next_at,flow_revision,catalog_version) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(key, actor, probeId, purpose, JSON.stringify({...operation,actor}), now, Math.min(now + 60000, expires), now, fence?.revision ?? null, fence?.catalogVersion ?? null);
  }
  hasPending(actor:string) {return !!this.db.prepare("SELECT 1 FROM inbox WHERE status='PENDING' AND json_extract(payload,'$.actor')=? LIMIT 1").get(actor);}
  pendingOutbox(now: number) { return this.db.prepare("SELECT * FROM outbox o WHERE status='PENDING' AND next_at<=? AND NOT EXISTS (SELECT 1 FROM inbox i WHERE i.status='PENDING' AND json_extract(i.payload,'$.actor')=o.actor) ORDER BY id LIMIT 1").get(now) as OutboxRow | undefined; }
  finishOutbox(id: number, status: string, result: string, now: number, httpStatus?: number, mid?: string) {
    this.db.prepare('UPDATE outbox SET status=?,result=?,finished_at=?,http_status=?,message_mid=? WHERE id=?').run(status, result, now, httpStatus ?? null, mid ?? null, id);
  }
  erasePersonal(actor:string,now:number) {
    for(const table of ['bookmarks','flow_actions','flow_states','flow_screens','ui_messages','contacts','probes','ingress_limits'])this.db.prepare(`DELETE FROM ${table} WHERE actor=?`).run(actor);
    this.db.prepare("UPDATE inbox SET payload=NULL,status='PROCESSED',result='PERSONAL_DATA_ERASED',finished_at=? WHERE json_extract(payload,'$.actor')=?").run(now,actor);
    this.db.prepare("UPDATE outbox SET payload=NULL,actor='',probe_id=NULL,message_mid=NULL,status=CASE WHEN status IN ('PENDING','SENDING') THEN 'STALE' ELSE status END,result='PERSONAL_DATA_ERASED',finished_at=COALESCE(finished_at,?) WHERE actor=?").run(now,actor);
  }
  finishErasureRequests(now:number) {
    const rows=this.db.prepare("SELECT actor,flow_revision FROM outbox WHERE actor<>'' AND payload IS NOT NULL AND json_extract(payload,'$.forgetAfterSend')=1 AND (status NOT IN ('PENDING','SENDING') OR expires_at<=?)").all(now) as {actor:string;flow_revision:number}[];
    for(const row of rows){const state=this.db.prepare('SELECT revision FROM flow_states WHERE actor=?').get(row.actor) as {revision:number}|undefined;
      if(state?.revision===row.flow_revision)this.erasePersonal(row.actor,now);
    }
  }
  cleanup(now: number) {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM ingress_limits WHERE window_start<?').run(now-60000);
      this.db.prepare("UPDATE inbox SET payload=NULL WHERE status<>'PENDING' AND finished_at<?").run(now - 86400000);
      this.db.prepare("UPDATE outbox SET payload=NULL,actor='' WHERE status NOT IN ('PENDING','SENDING') AND finished_at<?").run(now - 86400000);
      this.db.prepare('DELETE FROM inbox WHERE received_at<?').run(now - 7 * 86400000);
      this.db.prepare('DELETE FROM outbox WHERE created_at<?').run(now - 7 * 86400000);
      this.db.prepare('DELETE FROM probes WHERE expires_at<?').run(now - 86400000);
      this.db.prepare('DELETE FROM flow_actions WHERE expires_at<=?').run(now);
      this.db.prepare('DELETE FROM flow_states WHERE updated_at<?').run(now - 30 * 86400000);
      this.db.prepare('DELETE FROM flow_screens WHERE updated_at<?').run(now - 30 * 86400000);
      this.db.prepare('DELETE FROM ui_messages WHERE updated_at<? AND mid NOT IN (SELECT mid FROM flow_screens WHERE mid IS NOT NULL)').run(now - 86400000);
      this.db.prepare('DELETE FROM contacts WHERE updated_at<? AND actor NOT IN (SELECT actor FROM flow_states) AND actor NOT IN (SELECT actor FROM bookmarks)').run(now - 7 * 86400000);
    }).immediate();
  }
}
