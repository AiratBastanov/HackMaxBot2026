import type { Config } from './config.js';
import { parseUpdate } from './contracts.js';

export function actorAllowed(config: Pick<Config,'admissionMode'|'testers'>, actor:string) {
  return /^[1-9][0-9]{0,18}$/.test(actor) && BigInt(actor)<=9223372036854775807n
    && (config.admissionMode==='PUBLIC'||config.testers.has(actor));
}
// Общая граница webhook/polling: actor берётся только из проверенного MAX Update.
export function admitUpdate(raw: unknown, config: Pick<Config, 'botId' | 'testers' | 'admissionMode'>) {
  const parsed = parseUpdate(raw, config.botId);
  if (parsed.ignored) return { ignored: true as const, reason: 'EVENT_TYPE_OR_CONTEXT' };
  if (!actorAllowed(config,parsed.event.actor)) return { ignored: true as const, reason: 'NOT_ADMITTED' };
  if(config.admissionMode==='PUBLIC') {
    parsed.event.probeEntry=false; parsed.event.commandId=undefined;
    if(parsed.event.kind==='bot_started')parsed.event.homeEntry=true;
  }
  return parsed;
}
