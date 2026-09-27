import { z } from 'zod';

// MAX GET /updates: timeout 0..90 секунд; запас покрывает сеть и чтение тела.
export const pollTimeoutSecondsSchema = z.coerce.number().int().min(0).max(90).default(30);
const transportMarginMs = 5000;

export function pollingTiming(timeoutSeconds: unknown = undefined) {
  const serverTimeoutSeconds = pollTimeoutSecondsSchema.parse(timeoutSeconds);
  // Deadline не настраивается независимо: он всегда строго больше server wait.
  return { serverTimeoutSeconds, clientDeadlineMs: serverTimeoutSeconds * 1000 + transportMarginMs };
}
