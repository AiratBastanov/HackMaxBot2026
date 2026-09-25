import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { Catalog } from '../src/culture/catalog.js';
import { flowFixture, syntheticClock } from '../src/culture/fixture.js';
import { LocalMax, type MaxOperation, type Button } from '../src/max.js';
import { ACTOR, OTHER, SECRET, encode, lifecycle, callback, reply } from '../tests/fixtures.js';
import { activeScreen } from '../src/screens.js';

// Локальный драйвер вызывает реальный HTTP webhook; транспорт MAX явно симулирован.
export async function flowDriver(databasePath: string, input: unknown = flowFixture(), clock = syntheticClock.getTime(), real = false, review:unknown=null) {
  let now = clock, seq = 0;
  const config = loadConfig({ APP_MODE: 'local', DATABASE_PATH: databasePath, MAX_WEBHOOK_SECRET: SECRET,
    PROBE_TESTER_IDS: `${ACTOR},${OTHER}`, FLOW_DATA_MODE: real ? 'real' : 'synthetic-test' });
  let catalog = new Catalog(config.flowDataMode, input,review);
  const operations: MaxOperation[] = [], transcript: string[] = [];
  const simulated = new LocalMax();
  const transport = { async execute(op: MaxOperation) {
    const result = await simulated.execute(op); operations.push(op);
    if (op.method === 'messages'||op.method==='edit') transcript.push(`Бот (${op.method==='edit'?'изменение экрана':'новое сообщение'}): ${op.body.text}\nКнопки: ${op.body.attachments?.flatMap(a => a.payload.buttons.flat().map(b => b.text)).join(' · ') ?? 'нет'}`);
    else if(op.method==='answers') transcript.push(`Ответ на кнопку: ${op.body.notification}`);
    else transcript.push(`MAX (${op.method}): выполнено в симуляции`);
    return result;
  } };
  let runtime = createApp(config, { catalog, clock: () => now, transport });
  let origin = '';
  const listen = async () => { await runtime.app.listen({ host: '127.0.0.1', port: 0 }); const a = runtime.app.server.address(); if (!a || typeof a === 'string') throw Error('listen'); origin = `http://127.0.0.1:${a.port}`; };
  await listen();
  const post = async (value: unknown, secret = SECRET) => fetch(`${origin}/webhooks/max`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-max-bot-api-secret': secret }, body: encode(value), signal: AbortSignal.timeout(5000) });
  const drain = async () => {
    for (let i = 0; i < 60; i++) {
      now += 1200; await runtime.worker.tick();
      if (!runtime.store.pendingInbox(1).length && !runtime.store.pendingOutbox(now) && !runtime.store.db.prepare("SELECT 1 FROM ui_messages WHERE status='UNCERTAIN'").get()) break;
    }
    const failed = runtime.store.db.prepare("SELECT count(*) n FROM inbox WHERE status='FAILED'").get() as { n: number };
    if (failed.n) throw Error('FLOW_PROCESSING_FAILED');
  };
  const screen = (actor = ACTOR) => operations.filter(op => (op.method === 'messages'||op.method==='edit') && op.recipient === actor && op.screen).at(-1) as Extract<MaxOperation,{method:'messages'|'edit'}> | undefined;
  const buttons = (actor = ACTOR): Button[] => screen(actor)?.body.attachments?.flatMap(a => a.payload.buttons.flat()) ?? [];
  const payload = (text: string, actor = ACTOR) => { const b = buttons(actor).find(b => b.text === text); if (!b || b.type !== 'callback') throw Error(`BUTTON_NOT_FOUND: ${text}`); return b.payload; };
  const press = async (p: string, actor = ACTOR, id = `flow-${++seq}`, timestamp = ++now, flush = true) => {
    const v = callback('', id, actor, timestamp); v.callback.payload = p;v.message.body.mid=activeScreen(runtime.store,actor)?.mid??v.message.body.mid; const r = await post(v); if (!r.ok) throw Error(`HTTP_${r.status}`); if (flush) await drain(); return r.json();
  };
  return { config, get catalog(){return catalog;}, operations, transcript, post, drain, payload, buttons, screen, press,
    get runtime() { return runtime; }, get now() { return now; }, get origin() { return origin; }, advance(ms: number) { now += ms; },
    async enter(actor = ACTOR) { transcript.push('Пользователь: /start'); const v = lifecycle('bot_started', ++now, actor); delete (v as { payload?: string }).payload; await post(v); await drain(); },
    async click(text: string, actor = ACTOR) { transcript.push(`Пользователь: ${text}`); return press(payload(text, actor), actor); },
    async say(text: string, actor = ACTOR) { transcript.push(`Пользователь: ${text.replace(/^[A-F0-9]{6} /, '<код формы> ')}`); await post(reply(undefined, ++now, text, actor, `flow-text-${++seq}`)); await drain(); },
    async restart() { await runtime.app.close(); runtime = createApp(config, { catalog, clock: () => now, transport }); await listen(); },
    async reloadCatalog(snapshotPath:string) { await runtime.app.close();catalog=Catalog.load({...config,snapshotPath});runtime=createApp(config,{catalog,clock:()=>now,transport});await listen(); },
    close: () => runtime.app.close(),
  };
}
export async function chooseDefaults(d: Awaited<ReturnType<typeof flowDriver>>) {
  for (const text of ['Подобрать', 'Казань','Завтра', '12:00–18:00', 'Продолжить','До 500 ₽', 'Любой', 'Показать результаты']) await d.click(text);
}
