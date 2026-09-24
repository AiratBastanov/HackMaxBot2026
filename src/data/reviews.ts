// Локальные решения о пригодности, отдельно от неизменённых наблюдений API.
export type SourceReview = { version: 1; eventId: string; status: 'QUARANTINED'; observedAt: string;
  reason: string; sources: string[]; basis: string };
export const sourceReviews: readonly SourceReview[] = [{
  version: 1, eventId: 'kudago:58328', status: 'QUARANTINED', observedAt: '2026-09-24',
  reason: 'Не разрешено противоречие идентичности события и места: описание Красновидова и площадка в Казани.',
  sources: ['https://kzn.kudago.com/event/kazanskie-universitety-m-gorkogo/', 'https://gorkiy.tatmuseum.ru/'],
  basis: 'Противоречие описания сообщено пользователем; повторное чтение KudaGo недоступно (redirect loop / timeout). Сохранённый API связывает событие с площадкой 7733 и ценой 30 RUB. Официальный музей указывает отдельные входные тарифы 400/200 RUB и другие часы с санитарным днём. Тождество услуги не установлено; цена и площадка API не исправлены.',
}];
