import { stringify } from 'lossless-json';
export const ACTOR = '9007199254740993';
export const OTHER = '9007199254740995';
export const CHAT = '-9007199254740997';
export const BOT = '777';
export const SECRET = 'synthetic-test-secret-000000000000000000';
export const user = (id = ACTOR) => ({ user_id: BigInt(id), first_name: 'Синтетический тестировщик', is_bot: false });
export const encode = (value: unknown) => stringify(value)!;
export const lifecycle = (kind = 'bot_started', now = Date.now(), actor = ACTOR, chat = CHAT) => ({
  update_type: kind, timestamp: now, user: user(actor), chat_id: BigInt(chat),
  ...(kind === 'bot_started' ? { payload: 'g1' } : {}), ...(kind === 'dialog_muted' ? { muted_until: now + 60000 } : {}),
});
export const message = (recipient = ACTOR, mid = 'synthetic-mid', chat = CHAT) => ({
  sender: { ...user(BOT), is_bot: true }, recipient: { user_id: BigInt(recipient), chat_id: BigInt(chat), chat_type: 'dialog' },
  timestamp: Date.now(), body: { mid, seq: 1, text: 'Синтетический текст' },
});
export const callback = (command: string, callbackId = 'synthetic-callback', actor = ACTOR, now = Date.now()) => ({
  update_type: 'message_callback', timestamp: now,
  callback: { timestamp: now, callback_id: callbackId, user: user(actor), payload: `g1:${command}` },
  message: message(actor),
});
export const reply = (mid: string | undefined, now = Date.now(), text = 'готово', actor = ACTOR, ownMid = 'synthetic-reply') => ({
  update_type: 'message_created', timestamp: now,
  message: { ...message(BOT, ownMid), sender: user(actor), body: { mid: ownMid, seq: 2, text },
    ...(mid ? { link: { type: 'reply', chat_id: BigInt(CHAT), message: { mid, seq: 1, text: 'Вопрос' } } } : {}) },
});
