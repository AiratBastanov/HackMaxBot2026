import type { Config } from './config.js';
import type { AcceptedEvent } from './contracts.js';
import { MaxError, type MaxOperation, type MaxTransport } from './max.js';
import { Storage } from './storage.js';
import { canSend, processProbe } from './probe.js';
import { Catalog } from './culture/catalog.js';
import { getState, processCulture, enterProbeRoute } from './culture/flow.js';
import { queueReconciliation, prepareScreenOperation, completeScreenOperation, failedScreenOperation } from './screens.js';

export class Worker {
  private timer?: NodeJS.Timeout;
  private current?: Promise<void>;
  private stopping = false;
  private lastCleanup = 0;
  private ticking = false;
  private nextFlowSend = 0;
  constructor(readonly store: Storage, private readonly config: Config, private readonly max: MaxTransport,
    private readonly clock: () => number = Date.now, private readonly report: (value: object) => void = () => {},
    private readonly catalog: Catalog = new Catalog(config.flowDataMode)) {}

  start() {
    this.stopping = false;
    const run = () => {
      if (this.stopping) return;
      this.current = this.tick().catch(() => this.report({ operation: 'worker', errorClass: 'STORAGE_OR_PROCESSING' }))
        .finally(() => { if (!this.stopping) this.timer = setTimeout(run, 1100); });
    };
    run();
  }
  async stop() { this.stopping = true; clearTimeout(this.timer); await this.current; }
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try { await this.runTick(); } finally { this.ticking = false; }
  }
  private async runTick(): Promise<void> {
    // Один process/tick; транзакции только синхронные. Сеть идёт после commit.
    for (const row of this.store.pendingInbox(20)) {
      try {
        this.store.db.transaction(() => {
          const now = this.clock();
          const event = JSON.parse(row.payload) as AcceptedEvent;
          const flowState = getState(this.store,event.actor);
          const probeRoute = !flowState || JSON.parse(flowState.data).route === 'probe';
          const probe = event.probeEntry || event.commandId || (event.kind === 'message_created' && !event.homeEntry && !['/saved','/delete_data'].includes(event.input??'') && probeRoute && this.store.latestProbe(event.actor));
          const olderRoute = event.probeEntry && flowState && event.timestamp < flowState.event_ts;
          const result = olderRoute ? 'FLOW_OLDER_EVENT' : probe ? processProbe(this.store, this.config, event, now) : processCulture(this.store, this.config, event, now, this.catalog);
          // Менять владельца диалога можно только ПОСЛЕ принятия нового входа.
          if (result === 'PROBE_STARTED') {
            enterProbeRoute(this.store,event,now);
            this.store.db.prepare('DELETE FROM flow_actions WHERE actor=?').run(event.actor);
            this.store.db.prepare("UPDATE outbox SET status='STALE',result='ROUTE_CHANGED',finished_at=? WHERE actor=? AND status='PENDING' AND flow_revision IS NOT NULL").run(now,event.actor);
          } else if (result === 'FLOW_ACCEPTED') {
            this.store.db.prepare("UPDATE probes SET state='SUPERSEDED' WHERE actor=? AND state<>'COMPLETE'").run(event.actor);
          }
          this.store.finishInbox(row.id, result, now);
        }).immediate();
        this.report({ operation: 'inbox_processed', result: (this.store.db.prepare('SELECT result FROM inbox WHERE id=?').get(row.id) as {result:string}).result });
      } catch {
        const attempts = row.attempts + 1;
        this.store.db.prepare("UPDATE inbox SET attempts=?,status=?,result=?,finished_at=? WHERE id=?")
          .run(attempts, attempts >= 3 ? 'FAILED' : 'PENDING', 'PROCESSING_FAILURE', attempts >= 3 ? this.clock() : null, row.id);
      }
    }
    // Не отправлять экран, пока более новые уже принятые события ещё ждут обработки.
    if (this.store.pendingInbox(1).length) return;
    const now = this.clock();
    queueReconciliation(this.store,now);
    this.store.db.prepare("UPDATE outbox SET status='STALE',result='EXPIRED',finished_at=? WHERE status='PENDING' AND expires_at<=?").run(now, now);
    const row = this.store.pendingOutbox(now);
    if (row) {
      if (row.purpose.startsWith('culture') && now < this.nextFlowSend) return;
      const probe = row.probe_id ? this.store.probe(row.probe_id) : undefined;
      if (row.flow_revision !== null && (getState(this.store, row.actor)?.revision !== row.flow_revision
        || (row.catalog_version !== null && row.catalog_version !== this.catalog.version))) {
        this.store.finishOutbox(row.id, 'STALE', 'FLOW_OR_SNAPSHOT_CHANGED', now);
      } else if (row.probe_id && (!probe || probe.expires_at <= now || probe.state === 'SUPERSEDED')) {
        this.store.finishOutbox(row.id, 'STALE', 'PROBE_EXPIRED_OR_REPLACED', now);
      } else if (this.config.ingress === 'test-polling' && !this.config.testers.has(row.actor)) {
        this.store.finishOutbox(row.id, 'SUPPRESSED_TESTER', 'NOT_ADMITTED', now);
      } else if (this.store.getMeta('auth_blocked') === 'true') {
        this.store.finishOutbox(row.id, 'FAILED_AUTH', 'AUTH_BLOCKED', now);
      } else if (!canSend(this.store.contact(row.actor))) {
        this.store.finishOutbox(row.id, 'SUPPRESSED_CONTACT', 'CONTACT_UNAVAILABLE', now);
      } else {
        let operation = JSON.parse(row.payload) as MaxOperation;
        if (this.config.mode === 'live' && (operation.audience === 'PROVIDER' || (operation.audience === 'SYNTHETIC' && this.config.flowDataMode !== 'synthetic-test'))) {
          this.store.finishOutbox(row.id, 'SUPPRESSED_DISPLAY', 'SOURCE_DISPLAY_NOT_CLEARED', now); return;
        }
        const prepared=prepareScreenOperation(this.store,row,operation,now);
        if(!prepared) return;
        operation=prepared;
        if (row.purpose.startsWith('culture')) this.nextFlowSend = now + 1100;
        this.store.db.prepare("UPDATE outbox SET status='SENDING',attempts=attempts+1 WHERE id=?").run(row.id);
        try {
          const result = await this.max.execute(operation);
          this.store.db.transaction(() => {
            const finished = this.clock();
            const superseded = row.flow_revision !== null && (getState(this.store,row.actor)?.revision !== row.flow_revision
              || (row.catalog_version !== null && row.catalog_version !== this.catalog.version) || this.store.pendingInbox(1).length > 0);
            completeScreenOperation(this.store,row,operation,result,finished,superseded);
            this.store.finishOutbox(row.id, result.simulated ? 'SIMULATED' : 'ACKNOWLEDGED', superseded ? 'SENT_BEFORE_NEW_INPUT_OR_SNAPSHOT' : result.simulated ? 'LOCAL_ONLY' : 'MAX_ACCEPTED', finished, 200, result.mid);
            if (row.purpose === 'question' && result.mid && probe && finished < probe.expires_at) {
              this.store.db.prepare("UPDATE probes SET question_mid=?,state='WAITING_REPLY' WHERE id=? AND state='QUESTION_PENDING'").run(result.mid, probe.id);
            }
          }).immediate();
          this.report({ operation: operation.method, purpose:row.purpose,result: result.simulated ? 'SIMULATED' : 'MAX_ACCEPTED', attempts: row.attempts + 1 });
        } catch (error) {
          // Ошибка фиксации после ответа MAX тоже не допускает повторной отправки.
          const e = error instanceof MaxError ? error : new MaxError('TRANSPORT_AMBIGUOUS');
          const finished = this.clock();
          const nextAt = finished + Math.max(e.retryAfterMs ?? 0, 2000 * 2 ** row.attempts);
          this.store.db.transaction(() => {
            const ambiguous = ['MALFORMED', 'SERVER', 'TIMEOUT_AMBIGUOUS', 'TRANSPORT_AMBIGUOUS', 'CANCELLED'].includes(e.kind);
            failedScreenOperation(this.store,row,operation,e,finished,ambiguous);
            if (e.kind === 'AUTH') this.store.setMeta('auth_blocked', 'true');
            if (e.kind === 'RATE_LIMIT' && row.attempts + 1 < 3 && nextAt < row.expires_at) {
              this.store.db.prepare("UPDATE outbox SET status='PENDING',result='RATE_LIMIT',http_status=429,next_at=? WHERE id=?").run(nextAt, row.id);
            } else {
              this.store.finishOutbox(row.id, ambiguous ? 'UNKNOWN_RESULT' : `FAILED_${e.kind}`, e.kind, finished, e.status);
            }
          }).immediate();
          this.report({ operation: operation.method, purpose:row.purpose,errorClass: e.kind, status: e.status, attempts: row.attempts + 1 });
        }
      }
    }
    if (now - this.lastCleanup >= 60000) { this.store.cleanup(now); this.lastCleanup = now; }
  }
}
