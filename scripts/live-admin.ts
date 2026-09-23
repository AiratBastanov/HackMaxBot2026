import { loadConfig } from '../src/config.js';
import { LiveMax, MaxError } from '../src/max.js';
import { subscribedTypes } from '../src/contracts.js';
import { Storage } from '../src/storage.js';

async function main() {
  const config = loadConfig(process.env);
  if (config.mode !== 'live') throw new Error('LIVE_REQUIRED');
  const command = process.argv[2];
  if (!['inspect', 'subscribe', 'clear-auth-block'].includes(command ?? '')) throw new Error('COMMAND_INVALID');
  const max = new LiveMax(config);
  const bot = await max.me();
  const subscriptions = await max.subscriptions();
  const endpoint = `${config.publicBaseUrl}/webhooks/max`;
  // В stdout нет URL другой подписки: он может содержать чужие секреты.
  const owned = subscriptions.filter(s => s.url === endpoint);
  console.log(JSON.stringify({ operation: 'live_inspect', botIdMatches: bot.user_id === config.botId,
    subscriptions: subscriptions.length, designatedEndpointCount: owned.length,
    foreignEndpointCount: subscriptions.length - owned.length, incomingEvents: 'NOT_VERIFIED' }));
  if (command === 'inspect') return;
  if (subscriptions.some(s => s.url !== endpoint) || subscriptions.length > 1) throw new Error('SUBSCRIPTION_OWNERSHIP_AMBIGUOUS');
  if (command === 'subscribe') {
    // Даже совпадение URL не доказывает право заменить существующий secret/consumer.
    if (owned.length) throw new Error('EXISTING_SUBSCRIPTION_REQUIRES_SPECIFIC_DECISION');
    if (process.env.LIVE_EXCLUSIVE_CONSUMER_CONFIRMED !== 'true') throw new Error('EXCLUSIVE_CONSUMER_NOT_CONFIRMED');
    await max.subscribe(endpoint, subscribedTypes);
    const actual = await max.subscriptions();
    const match = actual.find(s => s.url === endpoint);
    if (!match || actual.length !== 1 || (match.update_types && subscribedTypes.some(type => !match.update_types!.includes(type)))) throw new Error('SUBSCRIPTION_NOT_CONFIRMED');
    console.log(JSON.stringify({ operation: 'subscribe', apiResult: 'SUCCESS', incomingEvents: 'NOT_VERIFIED' }));
  } else {
    if (owned.length !== 1) throw new Error('DESIGNATED_SUBSCRIPTION_MISSING');
    const store = new Storage(config.databasePath, config, false);
    try { store.setMeta('auth_blocked', 'false'); } finally { store.close(); }
    console.log(JSON.stringify({ operation: 'clear_auth_block', result: 'SUCCESS', previousOutbound: 'NOT_REPLAYED' }));
  }
}
main().catch(e => {
  const code = e instanceof MaxError ? e.kind : e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'LIVE_CONFIGURATION_OR_STORAGE_FAILURE';
  console.error(JSON.stringify({ operation: 'live_admin', errorClass: code, status: e instanceof MaxError ? e.status : undefined })); process.exitCode = 1;
});
