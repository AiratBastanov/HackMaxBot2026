// Локальные решения о пригодности, отдельно от неизменённых наблюдений API.
export type SourceReview = { version: 1; eventId: string; status: 'QUARANTINED'; observedAt: string;
  reason: string; sources: string[]; basis: string };
export const sourceReviews: readonly SourceReview[] = [{
  version: 1, eventId: 'kudago:58328', status: 'QUARANTINED', observedAt: '2026-09-24',
  reason: 'Не разрешено противоречие идентичности события и места: описание Красновидова и площадка в Казани.',
  sources: ['https://kzn.kudago.com/event/kazanskie-universitety-m-gorkogo/', 'https://gorkiy.tatmuseum.ru/'],
  basis: 'Противоречие описания сообщено пользователем; повторное чтение KudaGo недоступно (redirect loop / timeout). Сохранённый API связывает событие с площадкой 7733 и ценой 30 RUB. Официальный музей указывает отдельные входные тарифы 400/200 RUB и другие часы с санитарным днём. Тождество услуги не установлено; цена и площадка API не исправлены.',
}, ...[
  {eventId:'mie:way_to_the_dream',reason:'Период расходится: карточка до 08.11.2026, список Дома Качки до 18.10.2026.',sources:['https://m-i-e.ru/way_to_the_dream','https://m-i-e.ru/mie-filial']},
  {eventId:'mie:venya_zhiv',reason:'Начало периода расходится: карточка 17.05.2026, главная страница 17.05.2024.',sources:['https://m-i-e.ru/venya_zhiv','https://m-i-e.ru/']},
  {eventId:'kazan-kremlin:lapy-na-holste-istorii-sobak-v-iskusstve',reason:'В шапке организатор Эрмитаж-Казань; фактические объекты находятся в шести парках. Нужны отдельные места, музейный адрес неприменим.',sources:['https://kazan-kremlin.ru/exhibitions/lapy-na-holste-istorii-sobak-v-iskusstve']},
  {eventId:'mie:ot-zavoda-k-gorodu',reason:'Старая страница показывает иной режим Дома Качки; название площадки и актуальный режим требуют отдельного разбора.',sources:['https://m-i-e.ru/ot-zavoda-k-gorodu','https://m-i-e.ru/mie-filial']},
].map(r=>({...r,version:1 as const,status:'QUARANTINED' as const,observedAt:'2026-09-25',basis:'Прямой HTTPS и DOM публичных страниц; повторное получение не снимает этот карантин.'}))];
