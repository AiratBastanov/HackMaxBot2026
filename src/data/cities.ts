import { z } from 'zod';

// Общий реестр городов и местного времени для всех адаптеров. Наличие города
// здесь не означает наличие пригодного снимка. Пользовательский текст не становится URL.
export const cityKeySchema = z.enum(['kzn', 'ekb', 'msk', 'spb', 'nnv', 'nsk', 'sam', 'prm', 'chl', 'ufa', 'kry']);
export type CityKey = z.infer<typeof cityKeySchema>;
export const timezoneSchema = z.enum(['Europe/Moscow', 'Asia/Yekaterinburg', 'Asia/Novosibirsk', 'Europe/Samara', 'Asia/Krasnoyarsk']);
export type Timezone = z.infer<typeof timezoneSchema>;
export const cities: Record<CityKey, { name: string; aliases: string[]; timezone: Timezone }> = {
  kzn: { name: 'Казань', aliases: ['казань', 'kazan', 'казан'], timezone: 'Europe/Moscow' },
  ekb: { name: 'Екатеринбург', aliases: ['екатеринбург', 'екб', 'екат', 'yekaterinburg'], timezone: 'Asia/Yekaterinburg' },
  msk: { name: 'Москва', aliases: ['москва', 'мск', 'moscow'], timezone: 'Europe/Moscow' },
  spb: { name: 'Санкт-Петербург', aliases: ['санкт петербург', 'петербург', 'питер', 'спб'], timezone: 'Europe/Moscow' },
  nnv: { name: 'Нижний Новгород', aliases: ['нижний новгород', 'нижний', 'новгород'], timezone: 'Europe/Moscow' },
  nsk: { name: 'Новосибирск', aliases: ['новосибирск', 'нск', 'novosibirsk'], timezone: 'Asia/Novosibirsk' },
  sam: { name: 'Самара', aliases: ['самара', 'samara'], timezone: 'Europe/Samara' },
  prm: { name: 'Пермь', aliases: ['пермь', 'perm'], timezone: 'Asia/Yekaterinburg' },
  chl: { name: 'Челябинск', aliases: ['челябинск', 'chelyabinsk'], timezone: 'Asia/Yekaterinburg' },
  ufa: { name: 'Уфа', aliases: ['уфа', 'ufa'], timezone: 'Asia/Yekaterinburg' },
  kry: { name: 'Красноярск', aliases: ['красноярск', 'krasnoyarsk'], timezone: 'Asia/Krasnoyarsk' },
};
export const normalizeCity = (s: string) => s.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[-–]/g, ' ').trim().replace(/\s+/g, ' ');
export function resolveCity(input: string): CityKey[] {
  const name = normalizeCity(input);
  if (!name || name.length > 64) return [];
  const entries = Object.entries(cities) as [CityKey, typeof cities.kzn][];
  const exact = entries.filter(([id, c]) => [id, c.name, ...c.aliases].some(a => normalizeCity(a) === name));
  // Сокращение используется только для предложения выбора, не для угадывания.
  return (exact.length ? exact : name.length >= 3 ? entries.filter(([, c]) => c.aliases.some(a => a.startsWith(name))) : []).map(([id]) => id);
}
const zones: Record<Timezone,{offset:number;label:string}> = {'Europe/Moscow':{offset:3,label:'Москва'},'Asia/Yekaterinburg':{offset:5,label:'Екатеринбург'},'Asia/Novosibirsk':{offset:7,label:'Новосибирск'},'Europe/Samara':{offset:4,label:'Самара'},'Asia/Krasnoyarsk':{offset:7,label:'Красноярск'}};
export const offsetHours = (zone: Timezone) => zones[zone].offset;
export const zoneLabel = (zone: Timezone) => `${zones[zone].label}, UTC+${offsetHours(zone)}`;
export const localISO = (iso: string, zone: Timezone = 'Europe/Moscow') => new Date(Date.parse(iso) + offsetHours(zone) * 3600000).toISOString();
export const cityDate = (iso: string, zone: Timezone = 'Europe/Moscow') => localISO(iso, zone).slice(0, 10);
export const cityInstant = (date: string, time: string, zone: Timezone) => new Date(`${date}T${time}:00+0${offsetHours(zone)}:00`).toISOString();
export function cityWindow(clock: Date, key: CityKey) {
  const start = cityInstant(cityDate(clock.toISOString(), cities[key].timezone), '00:00', cities[key].timezone);
  return { start, end: new Date(Date.parse(start) + 30 * 86400000).toISOString() };
}
