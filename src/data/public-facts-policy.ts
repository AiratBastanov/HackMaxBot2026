// Решение проекта после просмотра публичных страниц 26.09.2026.
// Это ограниченная публикация фактов с прямой ссылкой, не лицензия на тексты/изображения.
// При изменении условий меняется policy hash; старые очереди и snapshots теряют допуск.
export const publicFactsPolicies = {
  'kazan-kremlin': {review:'PF-01',channel:'ordinary-html',evidence:['https://kazan-kremlin.ru/','https://kazan-kremlin.ru/robots.txt'],basis:'Самостоятельно изложенные минимальные факты опубликованной афиши; источник в каждой карточке.'},
  mie: {review:'PF-02',channel:'ordinary-html',evidence:['https://m-i-e.ru/','https://m-i-e.ru/robots.txt'],basis:'Факты публичной афиши и площадок; запрещённые robots маршруты не собираются.'},
  tatmuseum: {review:'PF-03',channel:'ordinary-html',evidence:['https://tatmuseum.ru/events/','https://tatmuseum.ru/visitors/','https://tatmuseum.ru/visitors/tickets/','https://tatmuseum.ru/robots.txt'],basis:'Минимальные даты, место, часы и условия тарифа из страниц учреждения; без редакционных описаний.'},
  uralopera: {review:'PF-04',channel:'ordinary-html',evidence:['https://uralopera.ru/','https://uralopera.ru/contacts','https://uralopera.ru/robots.txt'],basis:'Расписание конкретных показов, возрастная маркировка и опубликованная продолжительность; цены и наличие не домысливаются.'},
  sgaf: {review:'PF-05',channel:'ordinary-html',evidence:['https://sgaf.ru/','https://sgaf.ru/contacts','https://sgaf.ru/terms/purchase','https://sgaf.ru/terms/concertrules','https://sgaf.ru/robots.txt'],basis:'Факты опубликованных концертов и экскурсий; прямые ссылки на отдельные сеансы; условия покупки не переносятся на неизвестные тарифы.'},
} as const;
export const publicBasis = {version:1,reviewedAt:'2026-09-26T00:00:00Z',validUntil:'2026-10-26T00:00:00Z',
  fields:'title-period-session-venue-hours-tariff-admission-source',
  excluded:['editorial-descriptions','images','logos','reviews','advertising','kamal','kudago','culture.ru'],
  inventory:'docs/SOURCE_INVENTORY.md'} as const;
