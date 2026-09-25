import { createHash } from 'node:crypto';
import { parse, isLosslessNumber } from 'lossless-json';
import { z } from 'zod';

// JSON.parse не вызывается на внешнем JSON: лексема int64 сохраняется до схемы.
export function parseJson(text: string): unknown {
  const value = parse(text, undefined, { onDuplicateKey: () => { throw new Error('duplicate_key'); } });
  let nodes = 0;
  function check(v: unknown, depth: number): void {
    if (++nodes > 20000 || depth > 32) throw new Error('json_complexity');
    if (!v || typeof v !== 'object' || isLosslessNumber(v)) return;
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) throw new Error('unsafe_prototype');
    for (const [key, child] of Object.entries(v)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('unsafe_key');
      check(child, depth + 1);
    }
  }
  check(value, 0);
  return value;
}

// Принимается именно JSON integer, а не строка и не уже округлённый number.
export const int64 = z.custom<{ value: string }>(v => isLosslessNumber(v) && /^-?(0|[1-9][0-9]*)$/.test(v.value)
  && BigInt(v.value) >= -9223372036854775808n && BigInt(v.value) <= 9223372036854775807n).transform(v => v.value);
const timestamp = int64.refine(v => BigInt(v) >= 0n && BigInt(v) <= BigInt(Number.MAX_SAFE_INTEGER)).transform(Number);
const userId = int64.refine(v => BigInt(v) > 0n);
const shortString = z.string().min(1).max(512);
export const userSchema = z.object({ user_id: userId, first_name: z.string(), is_bot: z.boolean(), username: z.string().nullable().optional() });
const recipientSchema = z.object({ chat_type: z.enum(['dialog', 'chat', 'channel']), chat_id: int64.nullable().optional(), user_id: userId.nullable().optional() });
const bodySchema = z.object({ mid: shortString, seq: int64, text: z.string().nullable().optional(), attachments: z.array(z.unknown()).nullable().optional() });
export const messageSchema = z.object({ sender: userSchema.nullable().optional(), recipient: recipientSchema,
  timestamp, body: bodySchema.nullable(),
  link: z.object({ type: z.enum(['reply', 'forward']), message: bodySchema, chat_id: int64.optional() }).nullable().optional(),
});
const envelopeSchema = z.object({ update_type: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), timestamp });
export const lifecycleTypes = ['bot_started', 'bot_stopped', 'dialog_removed', 'dialog_cleared', 'dialog_muted', 'dialog_unmuted'] as const;
export const subscribedTypes = [...lifecycleTypes, 'message_created', 'message_callback'];
export type LifecycleType = typeof lifecycleTypes[number];
export type AcceptedEvent = {
  key: string; kind: LifecycleType | 'message_created' | 'message_callback'; timestamp: number;
  actor: string; chat: string | null; callbackId?: string; commandId?: string;
  mid?: string; replyMid?: string; replyChat?: string; replyIsReady?: boolean; probeEntry?: boolean;
  flowAction?: string; input?: string; homeEntry?: boolean;
};
export type ParsedEvent = { ignored: true } | { ignored: false; event: AcceptedEvent };

export function parseUpdate(raw: unknown, botId: string): ParsedEvent {
  const base = envelopeSchema.parse(raw);
  const hash = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  if (lifecycleTypes.includes(base.update_type as LifecycleType)) {
    const v = z.object({ user: userSchema, chat_id: int64, payload: z.string().max(512).nullable().optional(), muted_until: int64.optional() }).parse(raw);
    if (base.update_type === 'dialog_muted' && v.muted_until === undefined) throw new Error('muted_until');
    if (v.user.is_bot) return { ignored: true };
    const key = hash([base.update_type, v.user.user_id, v.chat_id, base.timestamp, base.update_type === 'bot_started' ? v.payload ?? null : null]);
    return { ignored: false, event: { key, kind: base.update_type as LifecycleType, timestamp: base.timestamp, actor: v.user.user_id, chat: v.chat_id, probeEntry: base.update_type === 'bot_started' && v.payload === 'g1', homeEntry: base.update_type === 'bot_started' && !v.payload } };
  }
  if (base.update_type === 'message_callback') {
    const v = z.object({ callback: z.object({ callback_id: shortString, timestamp, user: userSchema, payload: z.string().max(4096).optional() }), message: messageSchema.nullable().optional() }).parse(raw);
    if (v.callback.user.is_bot || (v.message && v.message.recipient.chat_type !== 'dialog')) return { ignored: true };
    if (v.message?.sender && v.message.sender.user_id !== botId) return { ignored: true };
    return { ignored: false, event: { key: hash(['message_callback', v.callback.callback_id]), kind: 'message_callback', timestamp: base.timestamp,
      actor: v.callback.user.user_id, chat: v.message?.recipient.chat_id ?? null, callbackId: v.callback.callback_id,
      mid: v.message?.body?.mid,
      commandId: /^g1:[0-9a-f-]{36}$/.test(v.callback.payload ?? '') ? v.callback.payload!.slice(3) : undefined,
      flowAction: /^cp:[a-zA-Z0-9_-]{24}$/.test(v.callback.payload ?? '') ? v.callback.payload!.slice(3) : undefined } };
  }
  if (base.update_type === 'message_created') {
    const { message: v } = z.object({ message: messageSchema }).parse(raw);
    if (v.recipient.chat_type !== 'dialog' || !v.sender || v.sender.is_bot || v.recipient.user_id !== botId || !v.recipient.chat_id || !v.body) return { ignored: true };
    return { ignored: false, event: { key: hash(['message_created', v.body.mid]), kind: 'message_created', timestamp: base.timestamp,
      actor: v.sender.user_id, chat: v.recipient.chat_id, mid: v.body.mid,
      replyMid: v.link?.type === 'reply' ? v.link.message.mid : undefined,
      replyChat: v.link?.type === 'reply' ? v.link.chat_id : undefined,
      replyIsReady: v.body.text?.trim().toLocaleLowerCase('ru') === 'готово', probeEntry: v.body.text?.trim() === '/probe',
      homeEntry: v.body.text?.trim() === '/start',
      // Не архивируем произвольный пользовательский текст: только ограниченный язык ввода.
      input: /^(?:[A-F0-9]{6} (?:\d{4}-\d{2}-\d{2}|\d{2}:\d{2}-\d{2}:\d{2}|[\d, ?]{1,32})|[\p{L} -]{1,64}|\d{1,2}|\/start|\/saved|\/delete_data)$/u.test(v.body.text?.trim() ?? '') ? v.body.text!.trim() : undefined } };
  }
  // Неизвестный/нерелевантный тип с валидным базовым Update подтверждаем без сохранения тела.
  return { ignored: true };
}

export const simpleResultSchema = z.object({ success: z.boolean(), message: z.string().optional() });
export const subscriptionsSchema = z.object({ subscriptions: z.array(z.object({ url: z.string().url(), time: timestamp, update_types: z.array(z.string()).nullable().optional() })) });

export function validateMessage(raw: unknown, recipient: string) {
  const parsed = z.object({ message: messageSchema }).parse(raw).message;
  if (!parsed.body || parsed.recipient.chat_type !== 'dialog' || parsed.recipient.user_id !== recipient) throw new Error('recipient_or_message');
  return parsed;
}
