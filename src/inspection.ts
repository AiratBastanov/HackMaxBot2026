import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import type { userSchema } from './contracts.js';
import type { z } from 'zod';

export function publicBot(bot: z.infer<typeof userSchema>) {
  const username = bot.username && /^[a-zA-Z0-9_]{1,64}$/.test(bot.username) ? bot.username : null;
  return { botId: bot.user_id, name: bot.first_name, username, botLink: username ? `https://max.ru/${username}` : null };
}
export function pinInspectedBot(botId: string, paths = ['.env.inspect','.env.polling','.env.live']) {
  const files = paths.filter(existsSync).map(path => ({path, env:parseEnv(readFileSync(path,'utf8'))}));
  // Проверить ВСЕ existing pins до первой записи, в том числе webhook config.
  if (files.some(f => f.env.MAX_EXPECTED_BOT_ID && f.env.MAX_EXPECTED_BOT_ID !== botId)) throw Error('EXISTING_BOT_PIN_MISMATCH');
  for (const file of files.filter(f => !f.env.MAX_EXPECTED_BOT_ID && !f.path.endsWith('.live'))) {
    appendFileSync(file.path, `\nMAX_EXPECTED_BOT_ID=${botId}\n`);
  }
}
