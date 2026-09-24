import type { Config } from './config.js';
import { parseUpdate } from './contracts.js';

// Общая граница webhook/polling: сначала полный decoder, затем actor allowlist.
export function admitUpdate(raw: unknown, config: Pick<Config, 'botId' | 'testers'>) {
  const parsed = parseUpdate(raw, config.botId);
  if (parsed.ignored) return { ignored: true as const, reason: 'EVENT_TYPE_OR_CONTEXT' };
  if (!config.testers.has(parsed.event.actor)) return { ignored: true as const, reason: 'NOT_TESTER' };
  return parsed;
}
