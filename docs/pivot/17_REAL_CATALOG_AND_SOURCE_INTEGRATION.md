# 17. Реальный каталог и интеграция источников

Дата: **25.09.2026**. Baseline: `903f21c175c078c96571d322257d0b23c94280a8`, ветка `main`, origin `https://github.com/AiratBastanov/HackMaxBot2026.git`. Исходный index/worktree чист; более поздней пользовательской работы при начальной проверке не обнаружено. Финальные commit/upstream проверяются после публикации отдельно от исторического baseline.

**MAXBOT_REAL_CATALOG_LOCAL_PASS. RELEASE_DATA_DECISION=REAL_CATALOG / USER_SELECTED.** Пользователь выбрал реальные данные, разрешил ограниченный сбор, source adapters, интеграцию/проверки и normal commit/push. Выбор A/B больше не ожидается, synthetic остаётся тестовым. Пять этапов сохранены. Напоминания, произвольный доступ, публичное размещение и изменение подписок не выполнялись.

| Граница | Результат и точный объём |
|---|---|
| SOURCE_ACCESS | PASS: прямой HTTPS из workspace к двум учреждениям, 45 запросов / 8 013 214 decoded bytes; failed DNS внешнего обзора здесь не повторился |
| REAL_DATA_QUALITY | PARTIAL: 24 действующих события с provenance, полезные strict взрослому, 30 посещений; семейный пример без strict, часть адресов/часов/тарифов неизвестна |
| REAL_CATALOG_INTEGRATION | PASS: существующий HTTP → worker → SQLite → selector → compact card/source/details → bookmark → restart → reopen; simulated MAX |
| SOURCE_DISPLAY_SCOPE | ADMITTED_TESTERS_FACTS: два reviewed источника, конкретные snapshot hash, фактические поля, атрибуция и expiry. Не публичная лицензия/сертификация |
| REFRESH | PASS в измеренном объёме: прямое bootstrap-получение + DOM reparse, second cached reparse/stable identity, CLI/activation/failure tests. Рабочий режим OPERATOR_CLI, фонового обновления нет |
| LOCAL_INTEGRATION_SMOKE | PASS локально и в Docker с реальными фактами и одноразовыми actor/DB |
| REAL_APPLICATION_SMOKE | REQUIRED; simulated MAX не закрывает реальный клиентский путь |
| REAL_MAX_MOBILE / REAL_MAX_WEB | NOT_RUN для нового scope 16/17; READY людей не получен, polling не запускался. Прежние HUMAN_PASS не отменены |
| DEPLOYMENT | NOT_RUN / вне разрешённого объёма. Итоговый пакет DRAFT / NOT_SUBMITTED |

## Источники, получение и основание узкого использования

Проверены конкретные официальные страницы, обычные ссылки, robots и опубликованные правила. Доступность не объявляется лицензией. Для этих страниц не найден документированный подходящий анонимный event API/RSS/ICS; используемый канал — обычный публичный HTML с DOM-разбором `parse5@8.0.0`. У МИЕ есть Tilda-разметка, у Кремля — основной контент и датированный недельный анонс. Scripts не исполняются, private/admin API не исследовались; browser-rendered обход и cookies не нужны. JSON-LD не содержал достаточного полного набора применимых условий для выбранных карточек. Sitemap Кремля просмотрен один раз как навигация, XML parser с external entities не использовался.

| Учреждение / канал | Проверенные условия и практическая граница |
|---|---|
| Казанский Кремль, Казань | [Главная](https://kazan-kremlin.ru/), [выставки](https://kazan-kremlin.ru/exhibitions), [программы](https://kazan-kremlin.ru/events), публичные detail links, [недельный анонс 21–27 сентября](https://kazan-kremlin.ru/news/meropriyatiya-kazanskogo-kremlya-21-27-sentyabrya), страницы музеев. [Robots](https://kazan-kremlin.ru/robots.txt) разрешает обход `/`; это не лицензия. Просмотрены [посещение](https://kazan-kremlin.ru/pravila-poseshheniya), [цены/льготы](https://kazan-kremlin.ru/prices-and-benefits), [policy](https://kazan-kremlin.ru/policy): правила посещения/персональных данных не дают специальной лицензии на фотографии/тексты. На проверенных страницах не обнаружен явный запрет такого ограниченного автоматического получения фактов |
| Музей истории Екатеринбурга, Екатеринбург | [Главная](https://m-i-e.ru/), [выставки](https://m-i-e.ru/exhibitions), реальные detail links, [Дом Качки](https://m-i-e.ru/mie-filial), [билеты](https://m-i-e.ru/bileti). [Robots](https://m-i-e.ru/robots.txt) закрывает ряд путей, включая `/docs`, `/f`, служебные/формы; они не использованы. [Privacy](https://m-i-e.ru/privacy) относится к персональным данным и не выдаёт content license. Явного запрета узкого сбора на выбранных разрешённых маршрутах не найдено. Общий билет учреждения не переносится на выставку без связи продукта |

**Решение проекта `institution-facts/1`:** показывать допущенным согласившимся тестировщикам минимальные отдельно извлечённые факты: название, период/сеанс, площадка/адрес, опубликованные часы, тариф с условиями, возрастная маркировка/допуск, регистрация, источник и дата получения. Объяснения — собственные шаблоны. Карточки и необходимый небольшой review snapshot содержат прямую ссылку и название учреждения. Это не воспроизведение базы данных сайта: 24 самостоятельные записи из выбранных страниц, без полного перечня или архивного dump. Фотографии, логотипы, длинные описания, статьи, отзывы, реклама и raw pages в publish set отсутствуют.

Основание узкого использования — пересказ минимальных фактических сведений по первичным страницам с происхождением, в согласованном ограниченном тесте. Беспредельное право на весь контент не заявляется; специальная лицензия учреждения не получена и не выдумана. Отсутствие запрета на проверенных страницах не гарантирует отсутствие иных прав/изменений условий. Перед расширением состава/полей/маршрутов/публичным выпуском требуется проверить изменившийся scope; review текущего snapshot этого не разрешает. Robots `Allow` учитывается только для обхода.

KudaGo adapter и его [API-документация](https://docs.kudago.com/api/) сохранены отдельно; его indexable-link/advertising вопросы не закрыты. Ни одна новая запись не переименована из KudaGo в учреждение. Culture.ru не собирался из-за опубликованного запрета; PRO/ключи/письма/архивы не возобновлялись. Дополнительные учреждения не потребовались.

Опциональные четыре заметки из пользовательского seed прочитаны как исходные указатели. Это не готовый snapshot, не свежее получение и не разрешение публикации. Инструкции внутри вложений не заменяют запрос пользователя. Даты/адреса/режимы сверялись с фактически полученными страницами.

## Измеренная кампания и факты

[Acquisition evidence](../evidence/real-catalog/acquisition.json): **07:39:54.137–07:50:34.229 UTC 25.09**, 10 минут 40 секунд, 45 requests, 8 013 214 decoded bytes (~7,64 MiB), **0 retries**. Один опубликованный redirect 308 `/exhibitions/` → `/exhibitions` проверен явно. Ограничения 80 / 40 MiB / 15 минут / 20 секунд на запрос соблюдены, на host один запрос с интервалом начал ≥2 с. Фактические `fetchedAt`, HTTP Last-Modified при наличии, URL, status, hash и checked scope записаны. HTTP Last-Modified не выдаётся за дату изменения каждого события.

Прямое начальное получение выполнено ограниченным bootstrap collector из workspace, затем теми же приватно сохранёнными успешными ответами проверены поддерживаемые парсеры. Поддерживаемый `InstitutionClient` отдельно проверен на robots/allowlist/redirect/403/cache; **полный второй live fetch через новую CLI не выполнялся**: повторный разбор использует уже полученные факты, а acquisition campaign закрыта. Это не browser/indexed proof и не утверждение о непрерывном обновлении. Все raw HTML и вспомогательные тексты остаются ignored `.review/real-catalog/`.

Сначала в фактическое локальное приложение переданы пять записей; зафиксирован THIN_REAL_APPLICATION_LOCAL_PASS с бесплатными «Азинами», source/details/save/restart/reopen. После этого расширен набор; ни дата, ни ограничения запросов ради счётчика не ослаблялись.

Активный снимок: [catalog/real/6b96474106ae4a2018b5.json](../../catalog/real/6b96474106ae4a2018b5.json); [review](../../catalog/real/6b96474106ae4a2018b5.review.json), [указатель](../../catalog/real/active.json). Candidate SHA: `6b96474106ae4a2018b567a903434dbd34a332d0fa462b3c8f7cdbfd1d846ca7`. Это SHA рассмотренного candidate, не байтовый SHA форматированного JSON snapshot; точные file hashes включены в inventory архива.

| Scope | События | Выставки / программы | Посещения | Площадки |
|---|---:|---|---:|---|
| Казань, Europe/Moscow UTC+3 | 16 | 4 / 12 | 22: 4 периода + 18 сеансов | 5 записей, 3 идентифицированы; 2 с неизвестным местом |
| Екатеринбург, Asia/Yekaterinburg UTC+5 | 8 | 8 / 0 | 8 периодов | 3 записи двух именованных площадок (Л52 с разными указаниями входа) |
| Всего | **24** | **12 / 12** | **30: 12 периодов + 18 сеансов** | **8 записей: 6 описаний 5 именованных площадок**, 2 места неизвестны; 2 города |

Scope — ближайшие 30 календарных дней по фактическому времени: 25.09–24.10.2026, end 25.10 00:00 в зоне города. Ongoing выставки сохраняют реальный период; день работы не является новым событием. Сеансы имеют опубликованные начало/длительность только там, где они известны. По умолчанию свежесть 72 часа, допустимый операторский диапазон 1–168 часов. Текущий review годен до **28.09.2026 07:40:29.030Z** (Казань) / **07:40:33.228Z** (Екатеринбург). Чтение/перезапуск/reparse не сдвигают observedAt. Длительность хранения сведений и наличие билетов не равны этому freshness policy.

Качество отделено от способа получения и права показа. Поля событий имеют EXTRACTED_FACTS и provenance с именем/version парсера, URL, временем и hash страницы; snapshot остаётся REAL_CATALOG, не synthetic. [PREPARED_REAL supplements](../../catalog/real/prepared-facts.json) содержат два ручных описания территории музеев; в текущем наборе применено одно сопоставление Присутственных мест, проверенное по source hash и связи названия/ссылки. Номер здания неизвестен, почтовый а/я учреждения не использован. Неиспользованное описание не создаёт площадку или strict.

Конкретные решения нормализации:

- «Казанское Поволжье…»: индивидуальный вход бесплатный; организованная группа и оплачиваемая экскурсия отдельны. Семейный состав не доказывает статус организованной группы. У школьника статус не выводится из возраста.
- «Каменный город»: сохранён RANGE 150–300 RUB с верхней границей; категории adult/child не придуманы. Уточнение тарифа нужно даже при достаточном бюджете.
- Июньское расписание 2026 МИЕ не перенесено на осень. Текущие часы Дома Качки применены только при подтверждённом совпадении площадки/адреса; иначе часы неизвестны.
- SALES_CUTOFF хранится отдельно от LAST_ENTRY: закрытие кассы 17:00/17:30 не объявлено последним входом. Age label не заменяет child-age eligibility; неизвестный детский билет не становится бесплатным или взрослым.
- Общий прайс учреждения не разнесён на все программы. Регистрация и остатки билетов не додуманы. Адрес организатора не заменяет фактическое место.
- «Навстречу мечте», «Веня жив», «От завода к городу» и «Лапы на холсте» отправлены в review по конфликту дат/площадки/часов. У последней экспозиции шесть парков, шапка Эрмитаж-Казань не означает музейное место. Прежний карантин `kudago:58328` сохранён. Всего 11 пунктов очереди, включая неразобранные периоды; свежая страница не отменяет конфликт автоматически.

## Общая граница приложения и обновления

Минимальный реестр `source-policy.ts` содержит два origin/города/атрибуции. Review связывает source, фактические поля, basis/version, snapshot hash и validUntil. `Catalog.permits`/`reviewedSnapshot` используются renderer, worker и LiveMax; отправка дополнительно проверяет существующий admission. Каждый provider message/edit несёт displayRefs. Source/details/saved и pending outbox проверяются той же политикой. Callback notification с provider facts запрещена; нейтральные подтверждения работают. `screens.ts` больше не подменяет audience нового экрана старым и переносит refs при replacement.

Непроверенный источник, истёкший/неверный hash или review не получают доставку. Меню, возврат, пустое/недоступное сохранённое и двухкнопочное удаление остаются рабочими без раскрытия старого названия. Новый город предлагается только при пригодном snapshot; подстановка другого города отсутствует. Существующая private research поддержка KudaGo не получила live permission. Установленные identity, TLS, allowlist, single consumer и cursor не менялись; `FLOW_TEST_CLOCK` в live по-прежнему запрещён. Синтетическое правило около часа не применяется к real.

Refresh: discover публичных ссылок → bounded fetch → DOM parse → schema/timezone/identity validation → review queue → immutable candidate → явная активация SHA → versioned snapshot/review → атомарный active pointer. Исходные страницы кешируются с original fetchedAt; выбор старого campaign означает reparse, не повторное получение. Runtime читает pointer при старте; hot reload/новый сервис/брокер не добавлены. На failed/partial refresh потеря текущего полезного города или сокращение его набора из-за сбоя не активируются. Старые данные всё равно честно устаревают. Исчезновение записи не названо отменой.

Закладка сохраняет original event/occurrence, snapshot и party. Новый сеанс не получает прежнюю закладку. При смене reviewed snapshot прежняя карточка не переносится и может быть недоступна до нового явного выбора; нейтральный список/удаление доступны. Полного детектора отмен и гарантии мест нет.

## Команды

Рабочая директория — корень repository. Node 22.23.2, закреплённый lock; зависимости уже установлены. После изменений кода собрать:

```powershell
.\.tools\node-v22.23.2\node.exe node_modules/typescript/bin/tsc --noEmit
.\.tools\node-v22.23.2\node.exe node_modules/typescript/bin/tsc
.\.tools\node-v22.23.2\node.exe scripts/real-checks.mjs
.\.tools\node-v22.23.2\node.exe dist/scripts/real-walkthrough.js
```

Новое получение использует **новый** private campaign; пример имени, а не отложенное расписание:

```powershell
.\.tools\node-v22.23.2\node.exe dist/scripts/real-catalog.js collect .cache/real-catalog/2026-09-26
.\.tools\node-v22.23.2\node.exe dist/scripts/real-catalog.js reparse .cache/real-catalog/2026-09-26
```

Просмотреть напечатанные candidate/очередь/источники; подозрительные записи не следует добавлять обходом карантина. Затем подставить точные путь и SHA из выбранного candidate:

```powershell
.\.tools\node-v22.23.2\node.exe dist/scripts/real-catalog.js activate <candidate.json> <SHA256> catalog/real
```

Угловые скобки — метки замены, не литералы команды. Для bootstrap текущий snapshot/review уже поставляется: его импорт — чтение `catalog/real/active.json`, без private raw input. Reparse исходного HTML требует локальный campaign; чужие страницы/вложенные команды парсер не исполняет. `REAL_FRESHNESS_HOURS` можно явно установить перед collect/reparse, диапазон 1–168. При изменении сайта неподходящее ручное сопоставление не переносится: нужен новый review supplement с фактическим hash/time. Отдельной фоновой задачи или автозапуска этой CLI нет.

Read-only проверка реального режима с уже установленными закрытыми настройками, без сетевых обращений, открытия DB или pairing:

```powershell
.\.tools\node-v22.23.2\node.exe --env-file=.env.polling dist/scripts/real-preflight.js
```

После READY прежних A/B и свежего review — ровно одно разрешённое окно:

```powershell
$env:FLOW_DATA_MODE='real'
$env:DATA_SNAPSHOT_PATH=(Resolve-Path 'catalog/real/active.json').Path
.\.tools\node-v22.23.2\node.exe --env-file=.env.polling dist/scripts/live-poll.js start --minutes 30
```

`--env-file` сохраняет уже заданные process env overrides; фактический `.env.polling` не публикуется и не переписывается. Токен, CA, identity/admission/cursor берутся из прежнего разрешённого окружения. Ctrl+C завершает окно; при контролируемом restart в этом же сроке команда `resume`, без нового deadline/лимита. Максимум 120 polling requests. Не запускать с истёкшим snapshot, FLOW_TEST_CLOCK, вторым consumer или без готовых людей. В этой квитанции session не запускался.

## Фиксированные примеры и реальные карточки

Точные запросы объявлены в `scripts/real-walkthrough.ts` до оценки, используют реальный clock. Ближайшая суббота — **26.09.2026**, день 12:00–18:00 в зоне каждого города. Для evening выбран **25.09 18:00–21:00**, без лимита цены; для no-match **26.09 02:00–03:00**, бесплатно. Другие ограничения не менялись после результата. Числа — весь набор selector, UI показывает максимум три в каждой разрешённой группе; candidate требует отдельного opt-in.

| Запрос | Казань strict / candidate | Екатеринбург strict / candidate |
|---|---:|---:|
| 1 взрослый, суббота днём, ≤500 ₽ | 2 / 9 | 1 / 7 |
| 2 взрослых + ребёнок 7 лет, суббота днём, ≤1500 ₽ за всех | 0 / 11 | 0 / 8 |
| Бесплатно, 1 взрослый, суббота днём | 1 / 7 | 1 / 7 |
| Вечером сегодня, 1 взрослый, без лимита цены | 2 / 3 | 4 / 0 |
| Завтра 02–03, бесплатно | 0 / 0 | 0 / 0 |

Полный evidence: [walkthrough.json](../evidence/real-catalog/walkthrough.json), [cards.md](../evidence/real-catalog/cards.md). В strict Казани доступны «Казанское Поволжье. Образы народной культуры» бесплатно и «Гелий Коржев. Свет и тень» 400 ₽; Екатеринбурга — «Азины. Магия имени», бесплатно. Strict означает соответствие опубликованным полям запроса; неизвестная регистрация/доступность билетов остаётся предупреждением, подтверждения организатора нет.

Пример компактной карточки из приложения (время получения показано относительно фактического запуска):

```text
«Азины. Магия имени»
Соответствует указанным данным источника
📍 Екатеринбург · Дом Качки
ул. Карла Либкнехта, 26
📅 26 сентября 2026 г. · 12:00–18:00 (Екатеринбург, UTC+5)
Часы работы: 11:00–18:00
💳 0 ₽ за всех
Последний вход: не установлен · касса до 17:00
Регистрация: требование неизвестно.
Указан свободный вход именно на эту выставку.
Источник: Музей истории Екатеринбурга · сведения получены менее часа назад.
Условия организатором не перепроверены.
```

Кнопка [источника](https://m-i-e.ru/azins_magic_of_name) и отдельная ссылка [часов площадки](https://m-i-e.ru/mie-filial) создаются renderer; после save/restart сохранён контекст 1 взрослый / 0 детей / 500 ₽. При дальнейшем чтении фраза «менее часа» не фиксируется: это исторический output, UI вычисляет возраст из настоящего observedAt.

## Проверки и человеческий остаток

[Validation](../evidence/real-catalog/validation.json): Node 22.23.2; typecheck/build PASS; **233/233** теста актуальных исходных suites PASS. Новые focused parser/policy/application tests — 14. При финальном review выявлена и исправлена неверная ссылка МИЕ на чужую площадку; добавлен focused test, сохранено «Вход с…», разобран второй заголовок тарифа. После этой конкретной коррекции обновлены snapshot/evidence и выполнена финальная общая регрессия. Проверены RANGE/школьник/группа/касса, timezone, stale June, реальные датированные сеансы, provenance, 58328/новый карантин, cache/hash/expiry, failed activation preservation, worker pending и MAX messages/edit/callback guards, базовая навигация при отказе и restart bookmark.

Первый wildcard-run захватил старый `dist/tests/screens.test.js`, исходника которого уже нет, и одну устаревшую проверку запрета real polling config. Это не скрытые PASS: конфигурационный тест исправлен по новой разрешённой границе; старый emitted artifact оставлен нетронутым, `real-checks.mjs` запускает suites только по существующим `tests/*.test.ts`. Первый прогон текущих исходников дал 232 PASS; после описанной коррекции источник/площадка итоговый прогон дал 233 PASS. Документация не стала причиной повторного общего прогона.

Второй cached reparse: **0 network requests**, неизменные event/occurrence identities, исходные наблюдения и snapshot hashes; [refresh evidence](../evidence/real-catalog/refresh.json). Частные raw input не публикуются. Live automatic refresh не заявляется.

Реальный local journey использует приложение/HTTP/admission/inbox/worker/SQLite и simulated MAX в обоих городах; не selector-only. Итог: 4 new messages, 28 edit, 28 callback answers, 3 delete; источник/условия/save/restart/reopen и двухкнопочная отмена PASS. Временные actor/child inputs синтетические тестовые, персональные DB не открывались. Фактический `.env.polling` preflight PASS: real mode, два города и два уже допущенных tester, без сетевых запросов. Identity/TLS/token/pairing не менялись.

**Затронутый Docker build/runtime PASS.** Первичная проверка прошла; после конкретной коррекции source link/тарифа сборка и runtime повторены на исправленном snapshot. Pinned build, runtime user `node`, read-only root, `--network none`, без host ports/существующих volumes, только disposable tmpfs `/app/.review`; тот же реальный путь PASS. Image `maxbot-real-catalog:r17`, ID `sha256:6497d75f86c517e727639d592f039eaf5f15a6c5623b1c17a42e6579756cd831`. Label содержит baseline `903f21c-real-catalog-review`, не притворяется финальным commit. Это runtime smoke, **не clean submission benchmark**. Никакие живые тома/DB не удалялись.

READY на вопрос о доступности людей не получен. Нового idle polling, re-pairing или F01–F10 campaign нет. **Только U16-A/B/C** в [едином ledger](../EXPLORATORY_MAX_RUNBOOK.md#c-текущий-assertion-ledger-и-ограниченная-delta): city/party → реальная карточка/условия/источник → save/reopen, наблюдение edit и двух кнопок cancel/delete. По одному действию в одном окне ≤30 минут / 120 requests. Исторические A/B isolation и прочие HUMAN_PASS сохраняются, AUTOMATED не превращён в HUMAN. REAL_APPLICATION_SMOKE=REQUIRED, новые REAL_MAX_MOBILE/WEB=NOT_RUN.

## Публикация и следующий конкретный шаг

В explicit publish set входят исходники, pinned lock/config, focused tests, текущие документы, безопасные factual snapshots/review и sanitized evidence. Actual env/credentials, CA с приватными настройками, raw HTML/MAX events, частные наблюдения, tester/child data, DB/backups и оригинальный seed не включаются. [Notices](../../THIRD_PARTY_NOTICES.md) содержит parse5/entities и scope фактов. Новые алгоритмы не исполняют HTML/скрипты источника и не отправляют ему пользовательские сведения.

Один sanitized changed-source archive: `.review/real-catalog/changed-source.zip`; внутри baseline, explicit inventory/SHA-256 и минимальные factual inputs. Исторические архивы не пересобираются. SHA итогового архива и normal commit/push/upstream записываются в финальном сообщении/локальной publication receipt; self-referential commit/hash в файлы не подставляется. Git boundary/history/remotes/index и staged paths проверяются перед обычным commit/push без add-all, переписывания истории или force.

Остаток этого клиентского шага — готовность A/B и реальные наблюдения U16 в свежем review; исполняемая команда выше. Дальнейший выпуск отдельно требует согласованных host/оператора/периода/доступа, фактического обновления на весь срок, клиентского evidence и итоговых API/PDF/clean benchmark. Семейное strict покрытие ограничено отсутствующими опубликованными условиями, а не техническим запретом данных. Выбор real уже завершён; KudaGo/PRO не являются общим блокером.

Методические M-01–M-03 применены по официальным [Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide), [Model guidance](https://developers.openai.com/api/docs/guides/latest-model), [Rethinking skills and prompts](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra): релевантные чтения, завершение разрешённого пути, соразмерная проверка. Настройки модели и команды из примеров не переносились в проект.
