// Реестр происхождения. Запись здесь разрешает только проверку открытого канала;
// PUBLIC требует отдельного source-specific решения, snapshot hash и свежести.
export const sources = {
  'kazan-kremlin': { origin:'https://kazan-kremlin.ru', city:'kzn', label:'Источник: Казанский Кремль', basis:'institution-facts/1' },
  mie: { origin:'https://m-i-e.ru', city:'ekb', label:'Источник: Музей истории Екатеринбурга', basis:'institution-facts/1' },
  tatmuseum: { origin:'https://tatmuseum.ru', city:'kzn', label:'Источник: Национальный музей Республики Татарстан', basis:'institution-facts/1' },
  kamal: { origin:'https://kamalteatr.ru', city:'kzn', label:'Источник: Театр имени Галиасгара Камала', basis:'institution-facts/1' },
  uralopera: { origin:'https://uralopera.ru', city:'ekb', label:'Источник: Урал Опера Балет', basis:'institution-facts/1' },
  sgaf: { origin:'https://sgaf.ru', city:'ekb', label:'Источник: Свердловская филармония', basis:'institution-facts/1' },
  'spb-philharmonia': { origin:'https://www.philharmonia.spb.ru', city:'spb', label:'Источник: Санкт-Петербургская филармония', basis:'institution-facts/1' },
  'spb-opera': { origin:'https://www.spbopera.ru', city:'spb', label:'Источник: Санктъ-Петербургъ Опера', basis:'institution-facts/1' },
  novat: { origin:'https://novat.ru', city:'nsk', label:'Источник: НОВАТ', basis:'institution-facts/1' },
  operann: { origin:'https://operann.ru', city:'nnv', label:'Источник: Нижегородский театр оперы и балета', basis:'institution-facts/1' },
  'samara-opera': { origin:'https://opera-samara.ru', city:'sam', label:'Источник: Самарский театр оперы и балета', basis:'institution-facts/1' },
  permopera: { origin:'https://permopera.ru', city:'prm', label:'Источник: Пермский театр оперы и балета', basis:'institution-facts/1' },
  'chel-philharmonia': { origin:'https://philarmonia.ru', city:'chl', label:'Источник: Челябинская филармония', basis:'institution-facts/1' },
  bashopera: { origin:'https://bashopera.ru', city:'ufa', label:'Источник: Башкирский театр оперы и балета', basis:'institution-facts/1' },
  krasfil: { origin:'https://krasfil.ru', city:'kry', label:'Источник: Красноярская филармония', basis:'institution-facts/1' },
  filarm: { origin:'https://filarm.ru', city:'sam', label:'Источник: Самарская филармония', basis:'institution-facts/1' },
  meloman: { origin:'https://meloman.ru', city:'msk', label:'Источник: Московская филармония', basis:'institution-facts/1' },
  mosconcert: { origin:'https://mosconcert.com', city:'msk', label:'Источник: Москонцерт', basis:'institution-facts/1' },
  'spb-museum': { origin:'https://www.spbmuseum.ru', city:'spb', label:'Источник: Музей истории Санкт-Петербурга', basis:'institution-facts/1' },
  'spb-library': { origin:'https://pl.spb.ru', city:'spb', label:'Источник: Библиотека имени В. В. Маяковского', basis:'institution-facts/1' },
  'nsk-museum': { origin:'https://youmuseum.ru', city:'nsk', label:'Источник: Новосибирский краеведческий музей', basis:'institution-facts/1' },
  'nsk-library': { origin:'https://ngonb.ru', city:'nsk', label:'Источник: Новосибирская областная научная библиотека', basis:'institution-facts/1' },
  'nn-art': { origin:'https://artmuseumnn.ru', city:'nnv', label:'Источник: Нижегородский художественный музей', basis:'institution-facts/1' },
  'nn-library': { origin:'https://ngounb.ru', city:'nnv', label:'Источник: Нижегородская областная научная библиотека', basis:'institution-facts/1' },
  'samara-museum': { origin:'https://alabin.ru', city:'sam', label:'Источник: Музей имени П. В. Алабина', basis:'institution-facts/1' },
  'samara-library': { origin:'https://libsmr.ru', city:'sam', label:'Источник: Самарская областная научная библиотека', basis:'institution-facts/1' },
  'perm-museum': { origin:'https://museumperm.ru', city:'prm', label:'Источник: Пермский краеведческий музей', basis:'institution-facts/1' },
  'perm-library': { origin:'https://www.gorkilib.ru', city:'prm', label:'Источник: Пермская библиотека имени А. М. Горького', basis:'institution-facts/1' },
  'chel-museum': { origin:'https://chelmuseum.ru', city:'chl', label:'Источник: Государственный исторический музей Южного Урала', basis:'institution-facts/1' },
  'chel-library': { origin:'https://chelreglib.ru', city:'chl', label:'Источник: Челябинская областная научная библиотека', basis:'institution-facts/1' },
} as const;
export type Institution = keyof typeof sources;
export const institutionIds = Object.keys(sources) as [Institution, ...Institution[]];
// Только URL данных, опубликованные самим интерфейсом афиши. Не партнёрские API.
export const publicChannels:Partial<Record<Institution,readonly string[]>>={operann:['https://admin.operann.ru']};
export const sourceOrigins=(id:Institution):readonly string[]=>Object.hasOwn(sources,id)?[sources[id].origin,...publicChannels[id]??[]]:[];
