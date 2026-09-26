import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import type { AcceptedEvent } from './contracts.js';
import { Storage, type ContactRow } from './storage.js';

export function canSend(contact: ContactRow | undefined): boolean { return contact?.access_mask === 1; }

export function observeContact(store: Storage, event: AcceptedEvent, now: number): void {
  if (!event.chat) return;
  const existing = store.contact(event.actor);
  const c: ContactRow = existing ?? { actor: event.actor, chat: event.chat, access_ts: -1, access_mask: 0, mute_ts: -1, mute_mask: 0, clear_ts: -1, updated_at: now };
  let bit = 0;
  if (event.kind === 'bot_started') bit = 1;
  if (event.kind === 'bot_stopped' || event.kind === 'dialog_removed') bit = 2;
  // Первое личное сообщение разрешает ответ; Stop/UNKNOWN не снимаются текстом.
  if (!existing && event.kind === 'message_created') bit = 1;
  if (!existing && !['bot_started','message_created'].includes(event.kind)) return;
  if (bit && event.timestamp >= c.access_ts) {
    c.access_mask = event.timestamp === c.access_ts ? c.access_mask | bit : bit;
    c.access_ts = event.timestamp;
    c.chat = event.chat;
  }
  const muteBit = event.kind === 'dialog_muted' ? 1 : event.kind === 'dialog_unmuted' ? 2 : 0;
  if (muteBit && event.timestamp >= c.mute_ts) {
    c.mute_mask = event.timestamp === c.mute_ts ? c.mute_mask | muteBit : muteBit;
    c.mute_ts = event.timestamp;
  }
  if (event.kind === 'dialog_cleared') c.clear_ts = Math.max(c.clear_ts, event.timestamp);
  store.db.prepare(`INSERT INTO contacts(actor,chat,access_ts,access_mask,mute_ts,mute_mask,clear_ts,updated_at)
    VALUES(@actor,@chat,@access_ts,@access_mask,@mute_ts,@mute_mask,@clear_ts,@updated_at)
    ON CONFLICT(actor) DO UPDATE SET chat=excluded.chat,access_ts=excluded.access_ts,access_mask=excluded.access_mask,
    mute_ts=excluded.mute_ts,mute_mask=excluded.mute_mask,clear_ts=excluded.clear_ts,updated_at=excluded.updated_at`).run({ ...c, updated_at: now });
}

export function processProbe(store: Storage, config: Config, event: AcceptedEvent, now: number): string {
  if (!config.testers.has(event.actor)) return 'IGNORED_TESTER';
  observeContact(store, event, now);
  const contact = store.contact(event.actor);
  const message = (key: string, text: string, probeId: string | null = null, purpose = 'guidance', expires = now + 60000) => {
    store.enqueue(key, event.actor, probeId, purpose, { method: 'messages', recipient: event.actor, body: { text, notify: false } }, now, expires);
  };
  if (event.probeEntry && (event.kind === 'bot_started' || event.kind === 'message_created')) {
    if (!event.chat || !canSend(contact)) return 'CONTACT_UNAVAILABLE';
    if (event.timestamp + config.probeTtlMs <= now || event.timestamp < contact!.access_ts) return 'EXPIRED_ENTRY';
    store.db.prepare("UPDATE probes SET state='SUPERSEDED' WHERE actor=? AND state<>'COMPLETE'").run(event.actor);
    // Старые ожидающие отправки нового входа не догоняют пользователя.
    store.db.prepare("UPDATE outbox SET status='STALE',result='NEW_ENTRY',finished_at=? WHERE actor=? AND status='PENDING' AND probe_id IS NOT NULL").run(now, event.actor);
    const id = randomUUID();
    const expires = Math.min(now + config.probeTtlMs, event.timestamp + config.probeTtlMs);
    store.db.prepare("INSERT INTO probes(id,actor,chat,created_at,expires_at,state) VALUES(?,?,?,?,?,'BUTTON')").run(id, event.actor, event.chat, now, expires);
    store.enqueue(`${event.key}:button`, event.actor, id, 'button', { method: 'messages', recipient: event.actor, body: {
      text: `Технический тест G1. Это проверка связи с MAX. Встречи и запись пока недоступны. Нажмите кнопку в течение ${Math.floor(config.probeTtlMs / 60000)} мин.`, notify: false,
      attachments: [{ type: 'inline_keyboard', payload: { buttons: [[{ type: 'callback', text: 'Проверить кнопку', payload: `g1:${id}` }]] } }],
    } }, now, expires);
    return 'PROBE_STARTED';
  }
  if (event.kind === 'message_callback') {
    const p = event.commandId ? store.probe(event.commandId) : undefined;
    let result = !p ? 'UNKNOWN_COMMAND' : p.actor !== event.actor || (event.chat !== null && p.chat !== event.chat) ? 'WRONG_ACTOR' : now >= p.expires_at ? 'EXPIRED_COMMAND' : p.state !== 'BUTTON' ? 'REPEATED_COMMAND' : !canSend(contact) ? 'CONTACT_UNAVAILABLE' : 'CALLBACK_ACCEPTED';
    const ok = result === 'CALLBACK_ACCEPTED';
    store.enqueue(`${event.key}:answer`, event.actor, null, 'callback_answer', { method: 'answers', callbackId: event.callbackId!, body: {
      notification: ok ? 'Технический тест: кнопка принята.' : 'Кнопка недействительна. Откройте свой технический тест заново: /probe',
    } }, now, now + 60000);
    if (ok && p) {
      store.db.prepare("UPDATE probes SET state='QUESTION_PENDING' WHERE id=?").run(p.id);
      message(`${event.key}:question`, 'Технический тест G1: кнопка сработала. Один вопрос: готовы продолжить? Используйте «Ответить» именно на это сообщение и напишите «готово». Не сообщайте личные данные.', p.id, 'question', p.expires_at);
    }
    return result;
  }
  if (event.kind === 'message_created') {
    const p = store.latestProbe(event.actor);
    if (!canSend(contact)) return 'CONTACT_UNAVAILABLE';
    if (p && p.state === 'WAITING_REPLY' && now < p.expires_at && p.chat === event.chat
      && event.replyMid === p.question_mid && (!event.replyChat || event.replyChat === p.chat) && event.replyIsReady) {
      store.db.prepare("UPDATE probes SET state='COMPLETE' WHERE id=?").run(p.id);
      message(`${event.key}:complete`, 'Технический тест G1 завершён: ответ связан с нужным вопросом. Спасибо! Это не запись на встречу.', p.id, 'complete', p.expires_at);
      return 'REPLY_ACCEPTED';
    }
    message(`${event.key}:guidance`, p && now < p.expires_at && p.state === 'WAITING_REPLY'
      ? 'Технический тест: выберите «Ответить» на вопрос бота и отправьте «готово». Обычный текст не связан с вопросом. Для нового теста: /probe.'
      : 'Технический тест: активного вопроса нет либо срок истёк. Начните заново командой /probe.');
    return 'REPLY_CONTEXT_MISSING_OR_STALE';
  }
  return 'LIFECYCLE_RECORDED';
}
