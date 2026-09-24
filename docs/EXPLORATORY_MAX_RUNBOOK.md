# Культурный план: первый технический smoke MAX mobile/web

**MAXBOT_REAL_CLIENT_SMOKE_PARTIAL; BOT_API_INSPECTION = PASS; REAL_APPLICATION_SMOKE = REQUIRED; REAL_MAX_MOBILE = PARTIAL; REAL_MAX_WEB = PARTIAL; CROSS_CLIENT_CONTINUITY = PASS в описанном объёме; CROSS_USER_ISOLATION = NOT_VERIFIED; WEBHOOK_INGRESS = NOT_VERIFIED; PUBLIC_DEPLOYMENT = NOT_VERIFIED (не развёрнуто).** /me повторно подтвердил «Хакатон МАХ 432», ID `426717762`, [@t432_hakaton_max_bot](https://max.ru/t432_hakaton_max_bot); subscriptions=0. Ротация и единственный consumer подтверждены оператором. Прежнее отсутствие токена относится к истории [10](pivot/10_USER_READINESS_AND_FIRST_MAX_CHECK.md); первое подключение — [11](pivot/11_FIRST_AUTHENTICATED_MAX_SESSION.md), базовые реальные наблюдения — [12](pivot/12_REAL_CLIENT_SMOKE_COMPLETION.md), историческое окно/решение выпуска — [13](pivot/13_RELEASE_DECISION_AND_REMAINING_SMOKE.md); текущая delta — [14](pivot/14_DELTA_CLIENT_VERIFICATION.md) и [ledger](#c-текущий-assertion-ledger-и-ограниченная-delta). PUBLIC_DISPLAY = NOT_CLEARED, DATA_SUITABILITY = EXPLORATORY_ONLY.

Задача разрешает техническую настройку уже конкретно одобренного test environment, synthetic-каталог и consenting testers. Старый запрет phase 2/3 на deployment/subscription не запрещает этот узкий этап. Разрешение не определяет отсутствующего владельца host или бота. Новые hosting/accounts, DNS/firewall, desktop tunnels, provider-карточки и публичный выпуск не входят в работу.

## Проверенные первичные контракты, 24.09.2026

| Метод | Значение для этого сеанса |
|---|---|
| [GET /me](https://dev.max.ru/docs-api/methods/GET/me) | Возвращает BotInfo назначенного токеном бота, включая int64 user_id; внешний host для GET не нужен |
| [GET /subscriptions](https://dev.max.ru/docs-api/methods/GET/subscriptions) | Возвращает subscriptions; сначала проверить владельца текущего consumer |
| [GET /updates](https://dev.max.ru/docs-api/methods/GET/updates) | Допустим при разработке/тестировании без webhook. Без marker/null приходит последнее обновление; следующий marker подтверждает предшествующие события. int64 нельзя округлять |
| [POST /subscriptions](https://dev.max.ru/docs-api/methods/POST/subscriptions) | Webhook использует доверенный HTTPS на 443 и X-Max-Bot-Api-Secret. При активной подписке polling не работает; это основной production ingress |
| [POST /messages](https://dev.max.ru/docs-api/methods/POST/messages) | Текст до 4000 символов, inline keyboard; предел два сообщения в секунду на диалог. Текущая очередь отправляет последовательно с интервалом |
| [POST /answers](https://dev.max.ru/docs-api/methods/POST/answers) | Ответ на callback: сообщение и/или одноразовое уведомление; не более двух ответов в секунду в диалог. Успех транспорта не равен наблюдению человеком |

Методы указывают `https://platform-api2.max.ru`, токен только в Authorization. Действующая конфигурация/адаптер уже используют этот контракт. Authenticated запросов без рабочего токена не выполняем; placeholders предназначены только для offline проверки конфигурации.

## A. Только чтение identity и subscriptions

Нужны назначенный проектный бот, установленная область доступа и безопасный локальный credential file. Рабочий HTTPS endpoint, БД и тестировщики для GET не нужны. `.env.inspect.example` — безопасный шаблон; `.env.inspect` и `secrets/` ignored. Секреты не вводятся в чат, argv, Git или журналы.

1. `npm.cmd run live:prepare` создаёт отсутствующие .env.inspect/.env.polling из safe examples. Оператор сохраняет заменённый токен только в secrets/max_bot_token и подтверждает MAX_CREDENTIAL_ROTATION_CONFIRMED=true. MAX_INSPECTION_SCOPE_CONFIRMED=true отражает уже имеющееся разрешение, не создаёт его. Это не доказательство отзыва прежнего credential.
2. Из корня после build: `npm.cmd run live:inspect` (Linux: `npm run live:inspect`). Только GET /me и GET /subscriptions; SQLite не открывается. Отчёт содержит bot ID, публичные имя/username/ссылку и число подписок, без токена и чужих URL; результат каждого шага сохраняется в ignored runtime/max-test/inspection.json.
3. Успешный /me добавляет MAX_EXPECTED_BOT_ID в .env.inspect/.env.polling при отсутствии pin; существующие pins, включая .env.live, сначала проверяются и не заменяются. Повторная проверка с expected ID отвергает другого бота. Identity не доказывает право менять чужой consumer.

Если TLS требует дополнительного CA, использовать только проверенный официальный файл через NODE_EXTRA_CA_CERTS в окружении процесса. Не отключать TLS и не менять системное хранилище. Контракт MAX указывает platform-api2.max.ru, заголовок Authorization и доверенную цепочку.

На этой машине Node потребовал Russian Trusted Root CA: проверены официальные HTTPS-download, совпадение DER/PEM, self-signature, CA и срок; fingerprint/source приведены в 11. Перед npm в **том же PowerShell** выполнить `$env:NODE_EXTRA_CA_CERTS = (Resolve-Path secrets/max-official-root.pem).Path`. Одного NODE_EXTRA_CA_CERTS в .env недостаточно: Node читает CA до загрузки --env-file; это проверено отдельным запросом без credential. Переменная действует только на этот процесс/дочерние процессы; Windows trust store не меняется.

## B. Одобренные test host/endpoint и регистрация

Этот будущий webhook-маршрут сохранён как инструкция; текущая задача **не выполняет** hosting/subscription mutations. Для разрешённого теста без host используется B2.

Нужны конкретные существующие host/HTTPS origin, доступ оператора, закреплённый bot ID и ID согласившихся A/B. Один consumer; Long Polling одновременно с webhook не использовать. Существующие ambiguous/чужие subscriptions сохраняются. Пользовательская или G1 БД в тест не переносится.

Public Compose/Caddy действительно находятся в Git. Compose использует отдельный client-test-data, /app/runtime/client-test.sqlite, HOST=0.0.0.0, secret mount и read-only mount нового synthetic snapshot. Caddy принимает только /healthz и /webhooks/max; HTTPS — 443. Наличие файла не разрешает занять 80/443 или выпустить сертификат на чужом host.

Из корня на разрешённом host:

```sh
# Оператор заполняет .env.live по .env.live.example; SOURCE_VERSION — reviewed SHA.
node dist/scripts/prepare-flow-fixture.js --synthetic-current runtime/synthetic-client-test.json
docker compose --env-file .env.live -f deploy/compose.public.yaml config --quiet
docker compose --env-file .env.live -f deploy/compose.public.yaml build app
docker compose --env-file .env.live -f deploy/compose.public.yaml run --rm --no-deps app node dist/scripts/live-preflight.js
docker compose --env-file .env.live -f deploy/compose.public.yaml up -d --no-build --wait
```

Генератор создаёт новые вымышленные события на фактическое время, существующий JSON не заменяет. Для повторного сеанса выбрать новый файл и обновить путь. FLOW_TEST_CLOCK в live запрещён. Нельзя менять даты реальных событий. Встроенный /app/synthetic-catalog.json с часами 2030 года для клиентов не используется.

Пути: --env-file .env.live разрешается от cwd; относительные bind sources ../secrets и ../runtime/... — от deploy/compose.public.yaml; внутри app используются /run/secrets/... и /app/fixtures/.... .env.live участвует в interpolation, целиком в контейнер не импортируется. Host admin CLI использует свои ./secrets/... paths. Не выводить resolved live `compose config`; допустим --quiet.

live-preflight.js без сети/БД проверяет live synthetic config, snapshot возрастом ≤1 часа, чтение secrets, writable runtime и bind address. Образ работает как node (UID 1000); оператор заранее обеспечивает чтение mounts этим пользователем, без запуска app от root и без системного изменения ACL. Optional NODE_EXTRA_CA_CERTS_CONTAINER=/run/secrets/verified-official-ca.pem передаёт проверенный CA только процессу. Startup выполняет GET /me до открытия БД/порта и никогда не регистрирует подписку.

После проверки HTTPS /healthz, ownership и отсутствия другого consumer:

```sh
# В .env.live: LIVE_EXCLUSIVE_CONSUMER_CONFIRMED=true после фактической проверки.
docker compose --env-file .env.live -f deploy/compose.public.yaml up -d --no-build app
docker compose --env-file .env.live -f deploy/compose.public.yaml exec -T app node dist/scripts/live-admin.js subscribe
```

Команда повторяет GET /me и GET /subscriptions; при любой существующей подписке ничего не меняет. Правильный существующий endpoint повторно не регистрируют: оператор отдельно подтверждает типы событий/секрет и доставку. При неоднозначном POST выполняется GET reconciliation без повторного POST. Журнал в /app/runtime/subscription-journal/ переживает restart и запрещает слепой повтор, даже если GET пока пуст. ATTEMPTED/RECONCILIATION_REQUIRED требуют приватной сверки с владельцем consumer; отсутствие записи само по себе не доказывает, что POST не был принят. Нельзя удалять журнал или менять его путь для обхода блокировки. Новая попытка — только после документированного разрешения неопределённости; автоматического retry нет.

## B2. Тестовый polling без host

MAX допускает test-only Long Polling без webhook. Entry point **реализован**: `APP_MODE=live`, `APP_INGRESS=test-polling`, отдельный [.env.polling.example](../.env.polling.example). Сначала A, пустые subscriptions и отдельное подтверждение оператора об отсутствии других consumers; на этой машине они уже получены. Нельзя снимать существующий webhook ради polling или автоматически выбирать ingress.

Runner повторно использует decoder/admission/worker/renderer/SQLite/MAX adapter. DB только `runtime/max-test/<bot-id>.sqlite`, identity test-polling отделена от local/webhook/recovery. Нужны свежий synthetic-current snapshot и allowlist. Для неизвестного ID оператор запускает `npm.cmd run live:poll -- pair`: A отправляет одноразовый код проверенному боту, затем оператор отдельно подтверждает его в локальном терминале. До этого ни flow, ни исходящих сообщений нет. ID сохраняется только в ignored runtime/max-test/testers.json; подробности/expiry — [11](pivot/11_FIRST_AUTHENTICATED_MAX_SESSION.md#исполняемый-путь). B необязателен для A, но нужен для F09.

Обычный сеанс: `npm.cmd run live:poll -- start`; Ctrl+C, затем `npm.cmd run live:poll -- resume` для F10 внутри той же кампании. Limit=10, timeout=30 с, отдельный deadline=35 с; POST остаётся 5 с. По умолчанию ≤15 минут/120 polling requests; по отдельной просьбе пользователя добавлен явный новый `start --minutes 30` с тем же пределом 120 запросов. `resume` не продлевает deadline. ≥1 с между запросами, Retry-After, максимум три повторные ошибки. Счётчик/deadline/cursor переживают restart; БД не чистить. Worker не блокируется ожидающим GET. ОС mutex на loopback запрещает второй cooperating consumer на workstation; удалённые/сторонние процессы не обнаруживает. Подписки повторно проверяются в каждом цикле.

Marker хранится lossless; весь batch валидируется до атомарного inbox/cursor commit. Ошибка не продвигает marker. Без marker/null API отдаёт только latest, не историю; bootstrap предшествует **READY_FOR_TESTER_ACTION**, после которого A отправляет /start. Непустой ответ без next marker или сброс cursor в null прекращает polling. Prepared/API/processed/send/human результаты различаются. Новый путь прошёл offline HTTP E2E и 21 focused тест; это не real-client PASS. WEBHOOK_INGRESS и PUBLIC_DEPLOYMENT остаются NOT_VERIFIED; production использует webhook.

## C. Текущий assertion-ledger и ограниченная delta

Единственный текущий реестр — таблица ниже; [11](pivot/11_FIRST_AUTHENTICATED_MAX_SESSION.md), [12](pivot/12_REAL_CLIENT_SMOKE_COMPLETION.md) и [13](pivot/13_RELEASE_DECISION_AND_REMAINING_SMOKE.md) неизменны и служат evidence, а не очередями исполнения. Итог delta — [14](pivot/14_DELTA_CLIENT_VERIFICATION.md). `C = 7c8fab121ba8ac01be10b77b92232fe00d358720`, опубликованный baseline — `b98d9df524224d9d3a2aeb58fb82e6399490f754`; после C до baseline менялись только документы. `S11/S12/S13` — исторические synthetic fixtures соответствующих квитанций; новый fixture сам по себе не отменяет проверку поведения.

`HUMAN_PASS` сохраняется в указанном клиенте; `NOT_RUN` — точное отсутствующее наблюдение, не FAIL. `AUTOMATED_PASS` — уже исполненная автоматическая проверка, не новый HUMAN PASS. PARTIAL группы не делает её выполненные assertions ожидающими. Перед повтором PASS сюда записываются конкретное релевантное изменение, противоречащий результат либо доказанный дефект evidence и затронутый scope; без причины повтор запрещён. Документ, квитанция, кампания или новая synthetic-дата не являются такой причиной. Незавершённый MOBILE не понижает WEB. **Причин инвалидировать перенесённые PASS в delta нет.**

Автоматическое evidence `V11` — [записанный passing run](evidence/first-max-session/validation.json) и [область проверки 11](pivot/11_FIRST_AUTHENTICATED_MAX_SESSION.md#проверки-и-реальные-наблюдения): Node 22.23.2, 40 flow tests в составе 118 уникальных host tests; отдельное уточнение polling E2E в 14:31:59 UTC. Поле `baseline` в JSON обозначает исходную версию до работы 11, а итоговый код привязан квитанцией 11 к C. Проверены тела перечисленных ниже assertions и их passing записи в ignored `.review/first-max-session/flow.log`; набор заново не запускался.

| Assertion ID / проверяемое утверждение | Scope | Статус | Evidence | Код / вход | Точное оставшееся действие |
|---|---|---|---|---|---|
| F01.M.menu — маркировка и меню | MOBILE A | HUMAN_PASS | 12 C12-06 | C / S12 | Нет |
| F01.W.menu — маркировка и меню | WEB A | HUMAN_PASS | 11; 12 C12-01 | C / S11–12 | Нет |
| F02.W.custom-date — Back/повторный вход, custom-дата | WEB A | HUMAN_PASS | 12 C12-01 | C / S12 | Нет |
| F02.W.custom-time — Back/повторный вход, custom-время | WEB A | HUMAN_PASS | 12 C12-02 | C / S12 | Нет |
| F02.W.custom-budget — Back/повторный вход, custom-сумма | WEB A | HUMAN_PASS | 12 C12-03 | C / S12 | Нет |
| F02.M.back-date — custom → Назад → preset | MOBILE | NOT_RUN | 11: Back без клиента | C | «Другая дата» → «Назад» → «Завтра», увидеть следующий экран |
| F02.M.back-time — custom → Назад → preset | MOBILE | NOT_RUN | 11: Back без клиента | C | «Другое время» → «Назад» → «12:00–18:00», увидеть следующий экран |
| F02.M.back-budget — custom → Назад → preset | MOBILE | NOT_RUN | 11: Back без клиента | C | «Другая сумма» → «Назад» → «До 500 ₽», увидеть следующий экран |
| F02.W.back-date — custom → Назад → preset | WEB | NOT_RUN | 13: точный остаток F02 | C | Только Back → «Завтра»; сводку/reset F06 не перепроверять |
| F02.W.back-time — custom → Назад → preset | WEB | NOT_RUN | 13: точный остаток F02 | C | Только Back → «12:00–18:00» |
| F02.W.back-budget — custom → Назад → preset | WEB | NOT_RUN | 13: точный остаток F02 | C | Только Back → «До 500 ₽» |
| F03.M.candidate — отдельная мастерская, время известно, тариф неизвестен | MOBILE A | HUMAN_PASS | 11 F03 | C / S11 | Нет |
| F03.W.order — театр раньше света | WEB A | HUMAN_PASS | 12 C12-03–04 | C / S12 | Нет |
| F03.W.optin — кандидаты по отдельному действию | WEB A | HUMAN_PASS | 12 C12-03–04 | C / S12 | Нет |
| F03.W.exclusion — дорогого зала нет | WEB A | HUMAN_PASS | 12 C12-03–04 | C / S12 | Нет |
| F03.M.results — порядок и исключение дорогого зала | MOBILE B | HUMAN_PASS | 14 C14-02 | C / S13, запрос 25.09.2026 12–18 / 500 ₽ / театр | Нет |
| F03.W.detail-candidate — «Подробнее 3» открывает мастерскую | WEB | NOT_RUN | 13 остаток F03 | C | После opt-in открыть именно «Подробнее 3» |
| F04.M.card — карточка открывается | MOBILE A | HUMAN_PASS | 11 F04 | C / S11 | Нет |
| F04.W.conditions — существенные условия | WEB A | HUMAN_PASS | 11 F04 | C / S11 | Нет |
| F04.W.date-zone — дата, Москва/UTC+3, давность | WEB A | HUMAN_PASS | 12 C12-04 | C / S12 | Нет |
| F04.W.source — переход по source-link | WEB A | HUMAN_PASS | 12 C12-04 | C / S12 | Нет; HTTP 200 вымышленной страницы не требовался |
| F04.M.conditions — читаемые существенные условия/дата/зона/давность | MOBILE | NOT_RUN | 12 C12-07; 14 C14-03: остановка до действия/ответа | C | На одной карточке увидеть адрес, 10–18/12–18, вход 17:30, 200 ₽, регистрацию, дату/Москва UTC+3/оговорку о давности |
| F04.M.source — открытие ссылки | MOBILE | NOT_RUN | 12 C12-07 | C | Открыть фактическую кнопку ссылки; отдельно записать переход и ответ example.org |
| F04.M.full-back — полные условия и возврат | MOBILE | NOT_RUN | 13 остаток F04 | C | «Все условия» → «К карточке»; с detail также «К результатам» |
| F04.W.full-back — полные условия и возврат | WEB | NOT_RUN | 13 остаток F04 | C | Только ещё не наблюдённый возврат «К карточке» → «К результатам» |
| F05.W.strict — save/open strict | WEB A | HUMAN_PASS | 11 F05 | C / S11 | Нет |
| F05.M.strict-open — strict из WEB открыт | MOBILE A | HUMAN_PASS | 11 F05 | C / S11 | Нет |
| F05.M.candidate-save — candidate сохранён | MOBILE A | HUMAN_PASS | 11 F05 | C / S11 | Нет |
| F05.W.candidate-open — candidate из MOBILE с неопределённостью | WEB A | HUMAN_PASS | 11 F05 | C / S11 | Нет |
| F05.X.continuity — strict WEB→MOBILE и candidate MOBILE→WEB | Один A / оба клиента | HUMAN_PASS | 11 F05 | C / S11 | Нет; A WEB + B MOBILE эту проверку не заменяет |
| F06.W.budget — preset/edit/summary/reset | WEB A | HUMAN_PASS | 13 C13-11–14 | C / S13 | Нет |
| F06.W.date — preset/edit/summary/reset | WEB A | HUMAN_PASS | 13 C13-15–18 | C / S13 | Нет |
| F06.W.time — preset/edit/summary/reset | WEB A | HUMAN_PASS | 13 C13-19–22 | C / S13 | Нет |
| F06.W.stale-budget — старое действие не вернуло запрос | WEB A | HUMAN_PASS | 13 C13-11–14 | C / S13 | Нет; краткое notification не критерий целостности |
| F06.M.date — edit/сводка/reset | MOBILE | NOT_RUN | 13: новых действий A не было | C | Из включённых вариантов изменить дату, увидеть сводку и отдельный opt-in |
| F06.M.time — edit/сводка/reset | MOBILE | NOT_RUN | 13: новых действий A не было | C | Из включённых вариантов изменить время, увидеть сводку и отдельный opt-in |
| F06.M.budget — edit/сводка/reset | MOBILE | NOT_RUN | 12 C12-05: только технический результат | C | Из включённых вариантов изменить сумму, увидеть сводку и отдельный opt-in |
| F07.W.date — invalid/current/old-code | WEB A | HUMAN_PASS | 12 C12-01 | C / S12 | Нет |
| F07.W.time — invalid/current/old-code | WEB A | HUMAN_PASS | 12 C12-02 | C / S12 | Нет |
| F07.W.budget — invalid/current/old-code | WEB A | HUMAN_PASS | 12 C12-03 | C / S12 | Нет |
| F07.M.date — доставка текущего custom-ввода | MOBILE | NOT_RUN | 13 остаток F07 | C | Фактический код + допустимая дата, увидеть её принятие |
| F07.M.time — доставка текущего custom-ввода | MOBILE | NOT_RUN | 13 остаток F07 | C | Фактический код + 12:00-18:00, увидеть принятие |
| F07.M.budget — доставка текущего custom-ввода | MOBILE | NOT_RUN | 13 остаток F07 | C | Фактический код + сумма, увидеть принятие |
| F07.M.rejection — видимый отказ ввода | MOBILE | NOT_RUN | 13 остаток F07 | C | Один пример неверной суммы, затем прежнего кода; исправление текущим кодом совместить с F07.M.budget |
| F08.M.delete — обычное удаление | MOBILE A | HUMAN_PASS | 11 follow-up | C / S11 | Нет |
| F08.W.delete — обычное удаление | WEB A | HUMAN_PASS | 13 C13-35–36 | C / S13 | Нет |
| F08.W.erase — явное стирание и нейтральный ответ | WEB A | HUMAN_PASS | 12 C12-06 | C / S12 | Нет; действие в F09 только setup изоляции |
| F08.W.empty — пустой список после erasure | WEB A | HUMAN_PASS | 12 C12-06 | C / S12 | Нет |
| F08.M.empty — пустой список после erasure | MOBILE A | HUMAN_PASS | 12 C12-06 | C / S12 | Нет |
| F08.W.after-old-save — текущий список после C13-37 | WEB A | NOT_RUN | 13 C13-37–38: поздняя инструкция | C / S13 | Один свежий `/saved` до нового изменения данных; это наблюдение списка, не повтор старого save |
| F08.C.generation — реальная старая кнопка против новой закладки | Один реальный клиент | NOT_RUN | 13 остаток F08 | C | Удалить/сохранить то же событие заново, намеренно нажать прежнее «Да, удалить», проверить новый список и открыть запись |
| F09.X.isolation — независимая закладка B переживает стирание A | A WEB / B MOBILE | NOT_RUN | 14 C14-P01–02: B допущен; C14-03: люди остановили окно до сохранения | C | B сохраняет; A стирает; B свежим `/saved` и открытием подтверждает сохранность; pairing не повторять |
| F10.M.restart-card — карточка после restart | MOBILE A | HUMAN_PASS | 11 F10 | C / S11 | Нет |
| F10.W.restart-conditions — условия после restart | WEB A | HUMAN_PASS | 12 C12-06 | C / S12 | Нет |
| F10.W.probe-start — `/probe` → `/start` | WEB A | HUMAN_PASS | 12 C12-06 | C / S12 | Нет |
| F10.M.probe-start — возврат из probe | MOBILE | NOT_RUN | 13 остаток F10 | C | `/probe`, затем `/start` после ответа; без restart |
| F08.S.generation — delete/re-save и stale delete | Общий сервер | AUTOMATED_PASS; HUMAN NOT_RUN для дублирующих клиентов | V11; [flow-runtime](../tests/flow-runtime.test.ts), «Delete → save again» | C / synthetic test | Нет повторов по обоим клиентам; один реальный путь остаётся F08.C.generation |
| F08.S.erase-ack — текущее стирание/один ACK/очистка payload | Общий сервер | AUTOMATED_PASS; собственный MOBILE erasure HUMAN NOT_RUN | V11; [flow-stage4](../tests/flow-stage4.test.ts), R08-04 current erasure | C / synthetic test | Нет отдельного MOBILE erasure ради серверного ACK; WEB-наблюдение сохранено |
| F08.S.old-save — прежнее save после стирания не восстанавливает запись | Общий сервер | AUTOMATED_PASS; полный исторический HUMAN NOT_RUN | V11; flow-stage4 R08-04 current erasure, oldSave/count=0 | C / synthetic test | Нет новой ручной перестановки; конкретный поздний список C13 остаётся F08.W.after-old-save |
| F08.S.old-erase — прежнее erase не удаляет новую запись | Общий сервер | AUTOMATED_PASS; HUMAN NOT_RUN | V11; flow-stage4 R08-04 current erasure, re-save/confirm/count=1 | C / synthetic test | Нет дублирующих client mutations |
| F09.S.foreign — чужие open/save/delete и сохранность другого actor | Общий сервер | AUTOMATED_PASS; передача чужого callback через UI HUMAN NOT_RUN | V11; flow-runtime «Пользователь B…»; flow-stage4 R08-04 | C / synthetic test | Серверные комбинации закрыты; возможность переслать actionable callback не заявлена; реальная изоляция остаётся F09.X.isolation |
| F07.S.validation — invalid/old-code комбинации трёх форм | Общий сервер | AUTOMATED_PASS; непроведённые MOBILE комбинации HUMAN NOT_RUN | V11; flow-runtime «Ввод ограничен…»; flow-stage4 R08-02 edit/back/binding | C / synthetic test | Только доставка трёх текущих вводов и один видимый отказ в MOBILE; WEB не повторять |
| F06.S.stale — прежний callback не возвращает старый запрос | Общий сервер | AUTOMATED_PASS; отдельный MOBILE old-editor HUMAN NOT_RUN | V11; flow-runtime «Опциональные варианты…», «Из двух клиентов принимается один переход…»; WEB C13-11–14 отдельно HUMAN | C / synthetic test | Нет ещё одной MOBILE перестановки старого редактора; реальное старое действие остаётся F08.C.generation |
| F04.S.projection — отсутствие повторов и группировка происхождения | Общий renderer | AUTOMATED_PASS; отдельные HUMAN assertions NOT_RUN | V11; [flow-readiness](../tests/flow-readiness.test.ts), два R10-B | C / synthetic projection | Нет ручного подсчёта всех повторов в обоих клиентах; чтение MOBILE и пути full/back остаются |
| F10.S.restart-delete — restart → list/open → обычное удаление | Общий сервер | AUTOMATED_PASS; единая HUMAN последовательность NOT_RUN | V11; flow-runtime «HTTP: секрет…»; flow-stage4 R08-01 projection/restart | C / synthetic test | Нет нового restart: реальные card/full-conditions и обычные удаления уже наблюдались отдельно |

### Замороженная очередь delta — окно завершено

Заморожена **до main start** 24.09.2026. Установлено: **WEB — A, MOBILE — B, оба готовы** (C14-P01); B отправил одноразовый код и оператор подтвердил допуск (C14-P02). Pairing завершён 17:24:05.181 UTC, exit 0, 3 polling requests; read-only проверка: два разных admitted actor, lock свободен. A повторно не сопрягался. Версии клиентов сохраняются `NOT_PROVIDED`; повторного запроса версий нет.

Очередь оператора ниже разворачивается **по одному действию**, с точным аккаунтом/клиентом, текущей label/кодом и ожидаемым результатом. Это максимум разрешённого остатка, не требование успеть всё ценой второго start. Setup уже проверенного экрана не требует отдельного подтверждения корректности. Одно наблюдение закрывает несколько явно названных assertions; ответ сразу записывается с клиентом и ID в ignored evidence.

1. B MOBILE: обычная настройка первого подбора → strict bookmark. Единственный экран результатов закрывает F03.M.results; карточка — F04.M.conditions, если человек подтвердит указанные читаемые условия. A WEB: свежий `/saved` закрывает только F08.W.after-old-save; затем штатное стирание A. B MOBILE: `/saved` → открыть свою запись — F09.X.isolation. Стирание A не переоценивает уже выполненный WEB F08.
2. B MOBILE: один remove/re-save того же события → намеренно прежнее «Да, удалить» → свежий `/saved` → открыть новое поколение (F08.C.generation). Нормальный повторный подбор здесь только необходимый setup. Старые save/erase и повтор этого пути в WEB удалены из очереди по V11.
3. MOBILE B: F02.M три Back→preset и F07.M три текущих ввода совместить с F06.M тремя edit/summary/reset. Неверный ввод/старый код наблюдать только на сумме. Не переигрывать WEB F06/F07 и не вводить отдельную проверку каждой старой кнопки. Правильный рабочий запрос для дневной выдачи: фактическое завтра, 12–18, 500 ₽, театр; после временной смены даты явно восстановить его обычной навигацией.
4. MOBILE B: оставшиеся «Все условия» → «К карточке»/«К результатам» и source-link; `/probe` → `/start`. WEB A: только три F02 Back→preset и detail/back, включая candidate через «Подробнее 3». Изменения фильтров по пути — setup, не новые WEB F06 PASS.

Одно разрешённое `start --minutes 30`, максимум 120 polling requests; последние **5 минут — резерв** завершения текущего assertion, проверки состояния и остановки, без длинной новой цепочки. Перед **каждой** инструкцией: фактические часы, runner active/owner, deadline/остаток запросов, текущий запрос/fixture/экран. До READY действует только setup допуска; после shutdown/неопределённой остановки никаких `/saved` и других действий. Пустой результат на сегодняшней уже законченной дате не объявлять ошибкой приложения. Краткое notification может быть пропущено: итог определяет свежая проверка состояния.

Использовать pinned Node/существующие credentials/CA и штатные startup identity/subscription/consumer guards без дублирующего `live:inspect`. Обновлять **только истёкший** synthetic fixture в новый файл до main start; старые файлы/DB/cursor сохранять. Запрещены правка live DB, поддельные callbacks/наблюдения, TTL override, subscription mutation и автоматическое второе окно. При новом конфликте остановиться и сохранить его. Останавливать только проверенный owned PID; Ctrl+C считать успешным только при exit/освобождении lock. Новый restart без конкретного неотвеченного integration-вопроса не нужен.

### Итог окна и одна передача

Перенесены **33 HUMAN_PASS**, добавлен **1 HUMAN_PASS — F03.M.results (C14-02)**; **9 строк AUTOMATED_PASS** ссылаются на существующие проверки, новых запусков нет. Открыты **22 точных HUMAN assertions** в таблице. WEB не понижен и новых WEB-наблюдений нет. Сами пункты 1–4 выше — зафиксированный порядок использованного окна, **не действующие инструкции после остановки**; завершённый F03.M.results повторно в исполнение не включать.

Main: **17:29:47.837–17:40:07.356 UTC / 20:29:47–20:40:07 МСК**, 22/120 зарезервированных запросов, 21 успешный ответ/commit, 7 обработанных событий, MAX принял 7 messages + 6 answers. Пользователь C14-03 сообщил «Сейчас продолжить не можем — завершить окно». Ctrl+C не остановил runner; после повторной проверки владельца применён `Stop-Process` только к его PID. Терминал exit 1, штатной записи SESSION_STOPPED нет. В 17:40:14 UTC PID отсутствует, mutex свободен, PENDING/SENDING=0; DB/cursor и admission A+B сохранены. Это **принудительная остановка, не graceful restart**. Второго start/resume не было. Fixture S13 на старте ещё укладывался в час: retrievedAt 16:30:17.317 UTC, SHA-256 `d82e42c18401d797ff82bc4a5548fa43558deb5da1df0390887442f05cc0e62a`; он не регенерирован, `.env.polling` не изменён.

**Передача без назначения нового окна:** последняя точка B/MOBILE — `results`, запрос 25.09.2026 / 12–18 / 500 ₽ / театр, закладок B пока 0. Первый незавершённый переход — **B/MOBILE: «Подробнее 1» → театральная экспозиция**, с наблюдением F04.M.conditions и дальнейшим сохранением для F09. Исполнение возможно только при отдельно разрешённом продолжении, после проверки фактической даты, свежести fixture, допустимости кнопки и READY; при истечении нужна только необходимая обычная навигация к актуальному списку. Сейчас runner остановлен, действий в MAX не запрашивать. Допуск A/B уже готов; старый `NOT_RUN` не превращать в ошибку меню.

## Передача оператору: отсутствующие условия

1. A выполнен: replacement file прочитан внутри приложения, ротация подтверждена оператором, /me и subscriptions успешны, pin/ссылка сохранены. Повторно запрашивать credential в чате не нужно.
2. A и B допущены; текущие наблюдения и точный остаток — только в [ledger](#c-текущий-assertion-ledger-и-ограниченная-delta), результат процесса — в [14](pivot/14_DELTA_CLIENT_VERIFICATION.md). Одно окно delta явно разрешено пользователем; автоматического следующего окна нет.
3. Одобренный host/endpoint/период доступности нужны будущему deployment/webhook, не блокируют test-only polling. Публичная доставка provider-карточек остаётся запрещённой.

Независимые исправления и пакет DRAFT завершены в 10 / [SUBMISSION_READINESS](SUBMISSION_READINESS.md). Recovery не переизобретался, исторический preflight не объявлен новой live-проверкой. Даже successful synthetic smoke не разрешает provider publication и не доказывает спрос/качество афиши. Напоминания, новое получение данных и публичный выпуск не начинаются.
