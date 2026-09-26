> **Текущая область 26.09.2026 — квитанция 21.** Пользователь разрешил PUBLIC-допуск обычных пользователей, новые keyless источники, source-specific публичные факты, автоматические проверки, локальный Docker-комплект и task-specific commit/push. Новые human/mobile/web проверки **DEFERRED_BY_USER / NOT_RUN**; не запрашивать READY, pairing, скриншоты или ручную сессию. Старые tester-only ограничения ниже относятся к истории и не блокируют эту область. Исторические receipts/ledger не переписаны.
>
> Реализованы 62 события / 93 посещений, пять источников в Казани и Екатеринбурге. Текущие команды/ограничения: [README](../README.md), [квитанция 21](pivot/21_PUBLIC_ACCESS_CATALOG_AND_HANDOFF.md). Пять этапов сохранены: (1) данные/селектор — расширены; (2) диалог — PUBLIC; (3) закладки — личные; (4) надёжность/автотесты — локально проверены; (5) материалы — подготовлены, hosting/закрытая передача остаются внешними полями. Напоминания, рассылки, deployment, регистрация webhook и автоматическая подача не разрешены. KudaGo не включён в PUBLIC; Камала исключён по условиям.

# Культурный план: smoke MAX и текущий assertion-ledger

**25.09.2026: checkpoint 19, REAL_APPLICATION_SMOKE=REQUIRED.** Локальная симуляция — отдельный `LOCAL_INTEGRATION_SMOKE`; она никогда не HUMAN_PASS. Текущие реальные наблюдения U16 и локальный real-webhook профиль — [19](pivot/19_REAL_MAX_AND_WEBHOOK_PREPARATION.md). [16](pivot/16_COMPACT_UX_CITY_AND_PARTY.md) сохранена как историческое evidence. Следующий абзац — исторический статус до 16.

**MAXBOT_REAL_CLIENT_SMOKE_PARTIAL; BOT_API_INSPECTION = PASS; REAL_APPLICATION_SMOKE = REQUIRED; REAL_MAX_MOBILE = PARTIAL; REAL_MAX_WEB = PARTIAL; CROSS_CLIENT_CONTINUITY = PASS в описанном объёме; CROSS_USER_ISOLATION = PASS для сохранности закладки B после стирания A; WEBHOOK_INGRESS = NOT_VERIFIED; PUBLIC_DEPLOYMENT = NOT_VERIFIED (не развёрнуто).** /me подтвердил «Хакатон МАХ 432», ID `426717762`, [@t432_hakaton_max_bot](https://max.ru/t432_hakaton_max_bot); subscriptions=0. Ротация и единственный consumer подтверждены оператором. Прежнее отсутствие токена относится к истории [10](pivot/10_USER_READINESS_AND_FIRST_MAX_CHECK.md); первое подключение — [11](pivot/11_FIRST_AUTHENTICATED_MAX_SESSION.md), базовые реальные наблюдения — [12](pivot/12_REAL_CLIENT_SMOKE_COMPLETION.md), историческое окно/решение выпуска — [13](pivot/13_RELEASE_DECISION_AND_REMAINING_SMOKE.md), исправление workflow — [14](pivot/14_DELTA_CLIENT_VERIFICATION.md); продолжение — [15](pivot/15_DELTA_CLIENT_CONTINUATION.md) и [ledger](#c-текущий-assertion-ledger-и-ограниченная-delta). PUBLIC_DISPLAY = NOT_CLEARED, DATA_SUITABILITY = EXPLORATORY_ONLY.

Текущая задача 19 разрешает локальную подготовку real webhook и одно ограниченное polling-окно с прежними consenting testers; это окно завершено. Реальный deployment, hosting/accounts, DNS/firewall, сертификаты, публичные порты и subscription mutations не разрешены. Квитанция 17 разрешает reviewed фактические карточки Кремля/МИЕ ранее допущенным согласившимся A/B; прочие provider-карточки запрещены. Разделы A/B описывают операторские команды, а не новое разрешение их выполнить.

## Проверенные первичные контракты, 25.09.2026

| Метод | Значение для этого сеанса |
|---|---|
| [GET /me](https://dev.max.ru/docs-api/methods/GET/me) | Возвращает BotInfo назначенного токеном бота, включая int64 user_id; внешний host для GET не нужен |
| [GET /subscriptions](https://dev.max.ru/docs-api/methods/GET/subscriptions) | Возвращает subscriptions; сначала проверить владельца текущего consumer |
| [GET /updates](https://dev.max.ru/docs-api/methods/GET/updates) | Допустим при разработке/тестировании без webhook. Без marker/null приходит последнее обновление; следующий marker подтверждает предшествующие события. int64 нельзя округлять |
| [POST /subscriptions](https://dev.max.ru/docs-api/methods/POST/subscriptions) | Webhook использует доверенный HTTPS на 443 и X-Max-Bot-Api-Secret. При активной подписке polling не работает; это основной production ingress |
| [POST /messages](https://dev.max.ru/docs-api/methods/POST/messages) | Текст до 4000 символов, inline keyboard; предел два сообщения в секунду на диалог. Текущая очередь отправляет последовательно с интервалом |
| [POST /answers](https://dev.max.ru/docs-api/methods/POST/answers) | Ответ на callback: сообщение и/или одноразовое уведомление; не более двух ответов в секунду в диалог. Успех транспорта не равен наблюдению человеком |
| [PUT /messages](https://dev.max.ru/docs-api/methods/PUT/messages) | Свои сообщения с inline keyboard редактируются независимо от возраста; ≤2/с в диалог. Пустой attachments удаляет вложения, null не меняет их |
| [DELETE /messages](https://dev.max.ru/docs-api/methods/DELETE/messages) | В диалоге только свои сообщения; возможность удаления проверяется отдельно. Refusal сохраняется, bounded retirement не требует расширения прав |

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

Public Compose переведён в `APP_MODE=live`, `APP_INGRESS=webhook`, `FLOW_DATA_MODE=real`. Отдельный `webhook-data` хранит `/app/runtime/webhook.sqlite` и subscription journal; polling DB/cursor туда не копируются. Весь `REAL_CATALOG_DIR` монтируется read-only в `/app/catalog/real`: active.json и указанные им versioned snapshot/review разрешаются относительно этой директории. Каталог нельзя заменять одиночным bind указателя: после атомарной активации нужен контролируемый restart app. Caddy принимает только /healthz и /webhooks/max; HTTPS — 443. Наличие файлов не разрешает занять 80/443 или выпустить сертификат.

Из корня на разрешённом host:

```sh
# Оператор заполняет .env.live по .env.live.example; SOURCE_VERSION — reviewed SHA.
docker compose --env-file .env.live -f deploy/compose.public.yaml config --quiet
docker compose --env-file .env.live -f deploy/compose.public.yaml build app
docker compose --env-file .env.live -f deploy/compose.public.yaml run --rm --no-deps app node dist/scripts/live-preflight.js
docker compose --env-file .env.live -f deploy/compose.public.yaml up -d --no-build --wait
```

Перед preflight оператор проверяет действующий real review и нужные даты. При необходимости — существующий collect → review изменений/PREPARED_REAL → activate → restart; старые версии сохраняются. Нельзя продлевать review или менять реальные даты ради старта. FLOW_TEST_CLOCK в live запрещён; synthetic fallback отсутствует. Текущий review истекает 28.09.2026 в 12:11 МСК; до этой границы отвечает назначенный оператор данных (конкретный человек пока не указан).

Пути: --env-file .env.live разрешается от cwd; относительные `../secrets` и `../catalog/real` — от deploy/compose.public.yaml; внутри app — `/run/secrets` и `/app/catalog/real`. .env.live участвует в interpolation, целиком не импортируется. `PUBLIC_BASE_URL` обязателен и должен совпадать по hostname с `PUBLIC_HOST`; фиктивный origin для live не подставляется. Host admin CLI использует собственные пути от cwd. Не выводить resolved live `compose config`; допустим --quiet.

live-preflight.js без сети/открытия БД проверяет live webhook/real config, действующие source/hash reviews, чтение файлов secrets/CA, writable runtime/journal, non-root и bind address. Образ работает как node (UID 1000), read-only root; оператор обеспечивает чтение mounts без root/изменения ACL. Optional NODE_EXTRA_CA_CERTS_CONTAINER=/run/secrets/verified-official-ca.pem передаёт CA только процессу. Startup делает GET /me до БД/порта и не регистрирует, не удаляет и не заменяет подписки. Пропавший/повреждённый/истёкший каталог блокирует preflight публикации; уже запущенное приложение сохраняет нейтральную навигацию/недоступную закладку и её удаление, не выдаёт старые факты.

Закрытая локальная проверка: `node scripts/webhook-profile-check.mjs`. Она создаёт только disposable `.env`, fake secrets, копии ранее рассмотренных версий и отдельный volume; применяет временный override к этому же app (`network_mode: none`, `restart: no`, без Caddy/портов). Настоящие index/HTTP/worker/SQLite/renderer/LiveMax проходят реальную карточку и restart того же контейнера после атомарной замены указателя. API fetch подменяется только явным test preload; обычный live API host/TLS не изменены. Это LOCAL_INTEGRATION_SMOKE, не проверка HTTPS MAX ingress. Harness требует ещё действующих исторического и текущего reviews; после expiry он честно отказывает, timestamps не обновляет.

После проверки HTTPS /healthz, ownership и отсутствия другого consumer:

```sh
# В .env.live: LIVE_EXCLUSIVE_CONSUMER_CONFIRMED=true после фактической проверки.
docker compose --env-file .env.live -f deploy/compose.public.yaml up -d --no-build app
docker compose --env-file .env.live -f deploy/compose.public.yaml exec -T app node dist/scripts/live-admin.js subscribe
```

Команда повторяет GET /me и GET /subscriptions; при любой существующей подписке ничего не меняет. Правильный существующий endpoint повторно не регистрируют: оператор отдельно подтверждает типы событий/секрет и доставку. При неоднозначном POST выполняется GET reconciliation без повторного POST. Журнал в /app/runtime/subscription-journal/ переживает restart и запрещает слепой повтор, даже если GET пока пуст. ATTEMPTED/RECONCILIATION_REQUIRED требуют приватной сверки с владельцем consumer; отсутствие записи само по себе не доказывает, что POST не был принят. Нельзя удалять журнал или менять его путь для обхода блокировки. Новая попытка — только после документированного разрешения неопределённости; автоматического retry нет.

## B2. Тестовый polling без host

MAX допускает test-only Long Polling без webhook. Entry point **реализован**: `APP_MODE=live`, `APP_INGRESS=test-polling`, отдельный [.env.polling.example](../.env.polling.example). Сначала A, пустые subscriptions и отдельное подтверждение оператора об отсутствии других consumers; на этой машине они уже получены. Нельзя снимать существующий webhook ради polling или автоматически выбирать ingress.

Runner повторно использует decoder/admission/worker/renderer/SQLite/MAX adapter. DB только `runtime/max-test/<bot-id>.sqlite`, identity test-polling отделена от local/webhook/recovery. Для выбранного REAL_CATALOG нужны действующие active snapshot/review и подходящие даты; credentials/CA/allowlist A/B уже сохранены. Повторный pairing, ротация и новый admission без реальной причины не выполняются. Историческая процедура первого подключения — [11](pivot/11_FIRST_AUTHENTICATED_MAX_SESSION.md#исполняемый-путь). Одного A достаточно для U16; прежний F09 A/B isolation остаётся PASS.

В 19 разрешённый `start --minutes 30` завершён после 65 запросов, без resume; команды в [README](../README.md) — шаблон для отдельно разрешённого следующего окна. Контролируемый restart внутри кампании нужен только для конкретного непроверенного интеграционного вопроса; F10 заново не назначается. Limit=10, timeout=30 с, отдельный deadline=35 с; POST остаётся 5 с. По умолчанию ≤15 минут/120 polling requests; явный `start --minutes 30` сохраняет предел 120 запросов. `resume` не продлевает deadline. ≥1 с между запросами, Retry-After, максимум три повторные ошибки. Счётчик/deadline/cursor переживают restart; БД не чистить. Worker не блокируется ожидающим GET. ОС mutex на loopback запрещает второй cooperating consumer на workstation; удалённые/сторонние процессы не обнаруживает. Подписки повторно проверяются в каждом цикле.

Marker хранится lossless; весь batch валидируется до атомарного inbox/cursor commit. Ошибка не продвигает marker. Без marker/null API отдаёт только latest, не историю; bootstrap предшествует **READY_FOR_TESTER_ACTION**, после которого A отправляет /start. Непустой ответ без next marker или сброс cursor в null прекращает polling. Prepared/API/processed/send/human результаты различаются. Новый путь прошёл offline HTTP E2E и 21 focused тест; это не real-client PASS. WEBHOOK_INGRESS и PUBLIC_DEPLOYMENT остаются NOT_VERIFIED; production использует webhook.

## C. Текущий assertion-ledger и ограниченная delta

Единственный текущий реестр — таблица ниже и её impact mapping 16; [11](pivot/11_FIRST_AUTHENTICATED_MAX_SESSION.md), [12](pivot/12_REAL_CLIENT_SMOKE_COMPLETION.md), [13](pivot/13_RELEASE_DECISION_AND_REMAINING_SMOKE.md) и [14](pivot/14_DELTA_CLIENT_VERIFICATION.md) неизменны и служат evidence, а не очередями исполнения. Итог продолжения — [15](pivot/15_DELTA_CLIENT_CONTINUATION.md). `C = 7c8fab121ba8ac01be10b77b92232fe00d358720`, исходный опубликованный baseline — `b98d9df524224d9d3a2aeb58fb82e6399490f754`, checkpoint перед продолжением — `99cbf22e21656808b3f90d37980423eac24cd3e9`; C — исторический runtime, изменённый реализацией 16. `S11/S12/S13/S15` — synthetic fixtures соответствующих квитанций; новый fixture сам по себе не отменяет проверку поведения.

`HUMAN_PASS` сохраняется в указанном клиенте; `NOT_RUN` — точное отсутствующее наблюдение, не FAIL. `AUTOMATED_PASS` — уже исполненная автоматическая проверка, не новый HUMAN PASS. PARTIAL группы не делает её выполненные assertions ожидающими. Перед повтором PASS сюда записываются конкретное релевантное изменение, противоречащий результат либо доказанный дефект evidence и затронутый scope; без причины повтор запрещён. Документ, квитанция, кампания или новая synthetic-дата не являются такой причиной. Незавершённый MOBILE не понижает WEB. **В окне 15 причин инвалидировать PASS не было. Для нового кода 16 точное влияние указано ниже; история не аннулирована.**

Автоматическое evidence `V11` — [записанный passing run](evidence/first-max-session/validation.json) и [область проверки 11](pivot/11_FIRST_AUTHENTICATED_MAX_SESSION.md#проверки-и-реальные-наблюдения): Node 22.23.2, 40 flow tests в составе 118 уникальных host tests; отдельное уточнение polling E2E в 14:31:59 UTC. Поле `baseline` в JSON обозначает исходную версию до работы 11, а итоговый код привязан квитанцией 11 к C. Проверены тела перечисленных ниже assertions и их passing записи в ignored `.review/first-max-session/flow.log`; набор заново не запускался.

| Assertion ID / проверяемое утверждение | Scope | Статус | Evidence | Код / вход | Точное оставшееся действие |
|---|---|---|---|---|---|
| F01.M.menu — маркировка и меню | MOBILE A | HUMAN_PASS | 12 C12-06 | C / S12 | Нет |
| F01.W.menu — маркировка и меню | WEB A | HUMAN_PASS | 11; 12 C12-01 | C / S11–12 | Нет |
| F02.W.custom-date — Back/повторный вход, custom-дата | WEB A | HUMAN_PASS | 12 C12-01 | C / S12 | Нет |
| F02.W.custom-time — Back/повторный вход, custom-время | WEB A | HUMAN_PASS | 12 C12-02 | C / S12 | Нет |
| F02.W.custom-budget — Back/повторный вход, custom-сумма | WEB A | HUMAN_PASS | 12 C12-03 | C / S12 | Нет |
| F02.M.back-date — custom → Назад → preset | MOBILE B | HUMAN_PASS | 15 C15-04 | C / S15 | Нет |
| F02.M.back-time — custom → Назад → preset | MOBILE B | HUMAN_PASS | 15 C15-05 | C / S15 | Нет |
| F02.M.back-budget — custom → Назад → preset | MOBILE B | HUMAN_PASS | 15 C15-06 | C / S15 | Нет |
| F02.W.back-date — custom → Назад → preset | WEB | SUPERSEDED → U16-A (ранее NOT_RUN) | 13: точный остаток F02 | C | Только Back → «Завтра»; сводку/reset F06 не перепроверять |
| F02.W.back-time — custom → Назад → preset | WEB | SUPERSEDED → U16-A (ранее NOT_RUN) | 13: точный остаток F02 | C | Только Back → «12:00–18:00» |
| F02.W.back-budget — custom → Назад → preset | WEB | SUPERSEDED → U16-A (ранее NOT_RUN) | 13: точный остаток F02 | C | Только Back → «До 500 ₽» |
| F03.M.candidate — отдельная мастерская, время известно, тариф неизвестен | MOBILE A | HUMAN_PASS | 11 F03 | C / S11 | Нет |
| F03.W.order — театр раньше света | WEB A | HUMAN_PASS | 12 C12-03–04 | C / S12 | Нет |
| F03.W.optin — кандидаты по отдельному действию | WEB A | HUMAN_PASS | 12 C12-03–04 | C / S12 | Нет |
| F03.W.exclusion — дорогого зала нет | WEB A | HUMAN_PASS | 12 C12-03–04 | C / S12 | Нет |
| F03.M.results — порядок и исключение дорогого зала | MOBILE B | HUMAN_PASS | 14 C14-02 | C / S13, запрос 25.09.2026 12–18 / 500 ₽ / театр | Нет |
| F03.W.detail-candidate — «Подробнее 3» открывает мастерскую | WEB | SUPERSEDED → U16-B (ранее NOT_RUN) | 13 остаток F03 | C | После opt-in открыть именно «Подробнее 3» |
| F04.M.card — карточка открывается | MOBILE A | HUMAN_PASS | 11 F04 | C / S11 | Нет |
| F04.W.conditions — существенные условия | WEB A | HUMAN_PASS | 11 F04 | C / S11 | Нет |
| F04.W.date-zone — дата, Москва/UTC+3, давность | WEB A | HUMAN_PASS | 12 C12-04 | C / S12 | Нет |
| F04.W.source — переход по source-link | WEB A | HUMAN_PASS | 12 C12-04 | C / S12 | Нет; HTTP 200 вымышленной страницы не требовался |
| F04.M.conditions — читаемые существенные условия/дата/зона/давность | MOBILE B | HUMAN_PASS | 15 C15-01 | C / S15, 25.09.2026 12–18 / 500 ₽ / театр | Нет |
| F04.M.source — открытие ссылки | MOBILE B | HUMAN_PASS | 15 C15-08: браузер открылся; ответ example.org не сообщён | C / S15 | Нет; HTTP 200 вымышленной страницы не требовался |
| F04.M.full-back — полные условия и возврат | MOBILE B | SUPERSEDED → U16-B (исторический HUMAN_PARTIAL сохранён) | 15 C15-09: «Все условия · 1/1» → «К карточке» подтверждено | C / S15 | Только «К результатам» из detail; полные условия и возврат к карточке не повторять |
| F04.W.full-back — полные условия и возврат | WEB | SUPERSEDED → U16-B (ранее NOT_RUN) | 13 остаток F04 | C | Только ещё не наблюдённый возврат «К карточке» → «К результатам» |
| F05.W.strict — save/open strict | WEB A | HUMAN_PASS | 11 F05 | C / S11 | Нет |
| F05.M.strict-open — strict из WEB открыт | MOBILE A | HUMAN_PASS | 11 F05 | C / S11 | Нет |
| F05.M.candidate-save — candidate сохранён | MOBILE A | HUMAN_PASS | 11 F05 | C / S11 | Нет |
| F05.W.candidate-open — candidate из MOBILE с неопределённостью | WEB A | HUMAN_PASS | 11 F05 | C / S11 | Нет |
| F05.X.continuity — strict WEB→MOBILE и candidate MOBILE→WEB | Один A / оба клиента | HUMAN_PASS | 11 F05 | C / S11 | Нет; A WEB + B MOBILE эту проверку не заменяет |
| F06.W.budget — preset/edit/summary/reset | WEB A | HUMAN_PASS | 13 C13-11–14 | C / S13 | Нет |
| F06.W.date — preset/edit/summary/reset | WEB A | HUMAN_PASS | 13 C13-15–18 | C / S13 | Нет |
| F06.W.time — preset/edit/summary/reset | WEB A | HUMAN_PASS | 13 C13-19–22 | C / S13 | Нет |
| F06.W.stale-budget — старое действие не вернуло запрос | WEB A | HUMAN_PASS | 13 C13-11–14 | C / S13 | Нет; краткое notification не критерий целостности |
| F06.M.date — edit/сводка/reset | MOBILE | SUPERSEDED → U16-A (ранее NOT_RUN) | 13: новых действий A не было | C | Из включённых вариантов изменить дату, увидеть сводку и отдельный opt-in |
| F06.M.time — edit/сводка/reset | MOBILE | SUPERSEDED → U16-A (ранее NOT_RUN) | 13: новых действий A не было | C | Из включённых вариантов изменить время, увидеть сводку и отдельный opt-in |
| F06.M.budget — edit/сводка/reset | MOBILE | SUPERSEDED → U16-A (ранее NOT_RUN) | 12 C12-05: только технический результат | C | Из включённых вариантов изменить сумму, увидеть сводку и отдельный opt-in |
| F07.W.date — invalid/current/old-code | WEB A | HUMAN_PASS | 12 C12-01 | C / S12 | Нет |
| F07.W.time — invalid/current/old-code | WEB A | HUMAN_PASS | 12 C12-02 | C / S12 | Нет |
| F07.W.budget — invalid/current/old-code | WEB A | HUMAN_PASS | 12 C12-03 | C / S12 | Нет |
| F07.M.date — доставка текущего custom-ввода | MOBILE | SUPERSEDED → U16-A (ранее NOT_RUN) | 13 остаток F07 | C | Фактический код + допустимая дата, увидеть её принятие |
| F07.M.time — доставка текущего custom-ввода | MOBILE | SUPERSEDED → U16-A (ранее NOT_RUN) | 13 остаток F07 | C | Фактический код + 12:00-18:00, увидеть принятие |
| F07.M.budget — доставка текущего custom-ввода | MOBILE | SUPERSEDED → U16-A (ранее NOT_RUN) | 13 остаток F07 | C | Фактический код + сумма, увидеть принятие |
| F07.M.rejection — видимый отказ ввода | MOBILE | SUPERSEDED → U16-A (ранее NOT_RUN) | 13 остаток F07 | C | Один пример неверной суммы, затем прежнего кода; исправление текущим кодом совместить с F07.M.budget |
| F08.M.delete — обычное удаление | MOBILE A | HUMAN_PASS | 11 follow-up | C / S11 | Нет |
| F08.W.delete — обычное удаление | WEB A | HUMAN_PASS | 13 C13-35–36 | C / S13 | Нет |
| F08.W.erase — явное стирание и нейтральный ответ | WEB A | HUMAN_PASS | 12 C12-06 | C / S12 | Нет; действие в F09 только setup изоляции |
| F08.W.empty — пустой список после erasure | WEB A | HUMAN_PASS | 12 C12-06 | C / S12 | Нет |
| F08.M.empty — пустой список после erasure | MOBILE A | HUMAN_PASS | 12 C12-06 | C / S12 | Нет |
| F08.W.after-old-save — текущий список после C13-37 | WEB A | HUMAN_PASS | 15 C15-02: свежий пустой список до новых изменений A | C / состояние после S13, runtime S15 | Нет; полный исторический old-save HUMAN NOT_RUN не переименован |
| F08.C.generation — реальная старая кнопка против новой закладки | MOBILE B | HUMAN_PASS | 15 C15-07: ответ с оговоркой сохранён дословно; старый callback и новое поколение сопоставлены отдельно | C / S15 | Нет; не повторять в WEB |
| F09.X.isolation — независимая закладка B переживает стирание A | A WEB / B MOBILE | HUMAN_PASS | 15 C15-03: B подтвердил сохранность и открытие после erasure A | C / S15 | Нет; передача чужого callback через UI не заявлена |
| F10.M.restart-card — карточка после restart | MOBILE A | HUMAN_PASS | 11 F10 | C / S11 | Нет |
| F10.W.restart-conditions — условия после restart | WEB A | HUMAN_PASS | 12 C12-06 | C / S12 | Нет |
| F10.W.probe-start — `/probe` → `/start` | WEB A | HUMAN_PASS | 12 C12-06 | C / S12 | Нет |
| F10.M.probe-start — возврат из probe | MOBILE B | HUMAN_PASS | 15 C15-10: меню вернулось | C / S15 | Нет; restart не выполнялся |
| F08.S.generation — delete/re-save и stale delete | Общий сервер | AUTOMATED_PASS; HUMAN NOT_RUN для дублирующих клиентов | V11; [flow-runtime](../tests/flow-runtime.test.ts), «Delete → save again» | C / synthetic test | Нет повторов по обоим клиентам; реальный путь F08.C.generation подтверждён в C15-07 |
| F08.S.erase-ack — текущее стирание/один ACK/очистка payload | Общий сервер | AUTOMATED_PASS; собственный MOBILE erasure HUMAN NOT_RUN | V11; [flow-stage4](../tests/flow-stage4.test.ts), R08-04 current erasure | C / synthetic test | Нет отдельного MOBILE erasure ради серверного ACK; WEB-наблюдение сохранено |
| F08.S.old-save — прежнее save после стирания не восстанавливает запись | Общий сервер | AUTOMATED_PASS; полный исторический HUMAN NOT_RUN | V11; flow-stage4 R08-04 current erasure, oldSave/count=0 | C / synthetic test | Нет новой ручной перестановки; поздний список C13 отдельно наблюдён в C15-02 |
| F08.S.old-erase — прежнее erase не удаляет новую запись | Общий сервер | AUTOMATED_PASS; HUMAN NOT_RUN | V11; flow-stage4 R08-04 current erasure, re-save/confirm/count=1 | C / synthetic test | Нет дублирующих client mutations |
| F09.S.foreign — чужие open/save/delete и сохранность другого actor | Общий сервер | AUTOMATED_PASS; передача чужого callback через UI HUMAN NOT_RUN | V11; flow-runtime «Пользователь B…»; flow-stage4 R08-04 | C / synthetic test | Серверные комбинации закрыты; возможность переслать actionable callback не заявлена; реальная изоляция F09.X.isolation подтверждена в C15-03 |
| F07.S.validation — invalid/old-code комбинации трёх форм | Общий сервер | AUTOMATED_PASS; непроведённые MOBILE комбинации HUMAN NOT_RUN | V11; flow-runtime «Ввод ограничен…»; flow-stage4 R08-02 edit/back/binding | C / synthetic test | Только доставка трёх текущих вводов и один видимый отказ в MOBILE; WEB не повторять |
| F06.S.stale — прежний callback не возвращает старый запрос | Общий сервер | AUTOMATED_PASS; отдельный MOBILE old-editor HUMAN NOT_RUN | V11; flow-runtime «Опциональные варианты…», «Из двух клиентов принимается один переход…»; WEB C13-11–14 отдельно HUMAN | C / synthetic test | Нет ещё одной MOBILE перестановки старого редактора; реальное старое действие F08.C.generation подтверждено в C15-07 |
| F04.S.projection — отсутствие повторов и группировка происхождения | Общий renderer | AUTOMATED_PASS; отдельные HUMAN assertions NOT_RUN | V11; [flow-readiness](../tests/flow-readiness.test.ts), два R10-B | C / synthetic projection | Нет ручного подсчёта всех повторов; чтение MOBILE подтверждено, точный остаток full/back — в клиентских строках |
| F10.S.restart-delete — restart → list/open → обычное удаление | Общий сервер | AUTOMATED_PASS; единая HUMAN последовательность NOT_RUN | V11; flow-runtime «HTTP: секрет…»; flow-stage4 R08-01 projection/restart | C / synthetic test | Нет нового restart: реальные card/full-conditions и обычные удаления уже наблюдались отдельно |

### Impact mapping 16 — действующая ограниченная delta

Изменения кода, обосновывающие targeted recheck: **PUT/GET/DELETE вместо нового POST на каждый переход; новый renderer/conditions; canonical city/timezone; party/общая цена; отдельные подтверждения; миграция UI references**. Это конкретные изменения scope, а не повтор из-за нового HEAD/fixture. Старые 43 HUMAN_PASS и 9 AUTOMATED_PASS сохраняются как evidence к C, новый код ими не удостоверяется.

| Старое свидетельство / scope | Влияние 16 |
|---|---|
| F09.X.isolation, F05.X.continuity, F08.C.generation | CARRIED_FORWARD в ранее наблюдённом объёме. Не повторять A/B erasure или old delete/re-save ради нового HUMAN PASS. Новые поля/миграция проверены автоматизированно. |
| F05 save/open, F10 restart, F07.S.validation, F06.S.stale, F08.S erasure/generation | Сохраняются исторические факты. Серверные проверки адаптированы и PASS; новый renderer/транспорт проверяется только U16, без дублирования всех комбинаций на обоих клиентах. |
| F01/F03/F04 presentation, F08 delete/erase UI | AFFECTED: новые тексты/клавиатуры/редактирование требуют U16-B/C. Старая source-link возможность сохранена, открытие всех ссылок заново не требуется. |
| F02/F06/F07 client-ввод и budget summary | AFFECTED: общий бюджет/city/party, in-place переходы. Новый scope U16-A; прежние HUMAN_PASS остаются привязаны к C. |
| 13 прежних незавершённых assertions | SUPERSEDED именованными U16 ниже, не PASS. Таблица C сохраняет исходный статус в скобках. Историческая очередь 15 больше не назначает действий. |

| Новый assertion / совмещённое наблюдение | Scope | Automated evidence | Human статус / точный остаток |
|---|---|---|---|
| U16-A — город, состав, ввод и сводка | Фактически A MOBILE / A WEB | C16 + R20 action/query, обе зоны/полночь/месяц/год, preference clear и HTTP validation PASS | PARTIAL по 20: R19 city button/взрослый запрос сохранён. MOBILE — город текстом, понятная дата/зона, семейная сводка с общим бюджетом/темой и принятие текущей custom-суммы подтверждены (C20-03–12). Остаток MOBILE: custom date/time, старый код, edit date/time/budget с новой сводкой/opt-in; исправленная ошибка R20-UX01 HUMAN_NOT_RUN. WEB: прежние Back → preset из custom date/time/budget и новая подача даты/зоны. Екатеринбург HUMAN_NOT_RUN. Старые WEB F06/F07 PASS не переоткрывать. |
| U16-B — компактная карточка и навигация на месте | A MOBILE / A WEB | C16 renderer/party/HTTP + R20 47 пар полных сообщений, применимые условия/конфликты/лимиты PASS | PARTIAL по 20: R19 real strict/edit обоих клиентов и source-link MOBILE сохранены. Новый family candidate открыт после явного opt-in, неизвестный итог понятен MOBILE; условия → карточка → результаты MOBILE и правильный source-link WEB подтверждены (C20-14–21). WEB family detail открыт, его читаемость отдельно не оценена. Остаток: читаемость финальных условий после R20-UX02 в обоих клиентах, WEB возврат к результатам. Замечание «много текста» не закрыто одним открытием. |
| U16-C — два действия удаления/cancel и уборка UI | A WEB / A MOBILE; private-chat API отдельно | C16 ownership/edit/failure/cleanup/generation/erasure + R20 current-change notices, сохранность исходной записи и две кнопки PASS | PARTIAL по 20: R19 WEB save/open/две кнопки/cancel и MOBILE saved list сохранены. Теперь WEB заметность «✅ СОХРАНЕНО» и смысл закладки, MOBILE open/ровно две кнопки/cancel/сохранность записи подтверждены (C20-22–27). Остаток: понятность saved context положительно не подтверждена; видимое исчезновение конкретного tracked экрана не наблюдено. DELETE API отдельно, без HUMAN_PASS уборки. A/B erasure не нужен. |

Основание SUPERSEDED: F02.W.back-date/time/budget → **U16-A.W**; F06.M.date/time/budget и F07.M.date/time/budget/rejection → **U16-A.M**; F03.W.detail-candidate и F04.W.full-back → **U16-B.W**; остаток F04.M.full-back → **U16-B.M**. U16-C — новый изменённый UI scope, не открытие прежнего серверного PASS.

Единственное разрешённое окно 19 **завершено**: 12:42:25–13:09:39 UTC, 65/120 запросов, исходный deadline 13:12:25 UTC. После 13:07 завершали текущий U16-C; нового маршрута не начинали. Один A использовал mobile/web, B не требовался. Сохранены credentials/CA/admission/DB/cursor; pairing, новый сбор и restart poller не выполнялись. REAL_CATALOG и ADMITTED_TESTERS_FACTS сохранены. Автоматического второго окна/продления нет; новый start этим документом не разрешается. При будущем отказе DELETE остаётся прежний bounded retirement без расширения прав.

### Impact mapping 17 — реальные факты в той же delta

[Квитанция 17](pivot/17_REAL_CATALOG_AND_SOURCE_INTEGRATION.md): U16-A/B/C остаются единственной новой клиентской очередью. Source policy, compact provenance, source link, saved и pending/edit затронуты реальным каталогом. 233/233 локальных теста и HTTP→worker→SQLite→simulated MAX PASS; это AUTOMATED, не HUMAN.

- U16-A: создать один запрос с городом/составом/общим бюджетом. Город предлагается только при пригодном снимке.
- U16-B: в том же запросе увидеть реальную карточку с «сведения получены…», открыть условия и настоящий источник, вернуться на месте. Сохранить, после контролируемого restart открыть ту же закладку с прежним составом. Один семейный candidate совмещается с прежним остатком, все серверные варианты не повторяются.
- U16-C: на этой закладке увидеть «Да, удалить» / «Отмена», отменить; наблюдение edit/delete API записать отдельно. Cleanup касается только отслеживаемых UI сообщений бота, включая reviewed real.

Статус на момент 17 был **NOT_RUN** обоих клиентов; текущий PARTIAL и точный остаток — в таблице U16 выше. Исторические PASS, включая F09 A/B isolation, сохраняются.

### Дополнение 18 — refresh и текущие условия закладки

[Квитанция 18](pivot/18_REAL_REFRESH_AND_CLIENT_DELTA.md): 26 событий / 32 посещения, активный pointer `536829346bd0a60d3b35`, review до **28.09.2026 12:11 МСК**. Штатный collect действительно выполнил 56 HTTP; один промежуток 1999 мс зафиксирован, ожидание исправлено. Сбор операторский, фонового обновления нет. До expiry нужны refresh → review очереди/ручной площадки → activate → контролируемый restart. [Команды](pivot/18_REAL_REFRESH_AND_CLIENT_DELTA.md#исполняемые-команды-и-эксплуатация).

245/245 локальных тестов и Docker PASS; actual application query → source/details → save → замена Catalog/restart → та же закладка → cancel/delete пройден с simulated MAX. Сохранённые identity, дата, состав, бюджет и generation не менялись; текущая карточка использует текущий displayRef, текущую оценку и показывает изменившиеся условия. Прочие источники и старые review глобально не разрешаются.

Это дополнение к тем же U16, новой очереди нет. A совмещает city button/plain text, посетителей, местное время и party budget; B — strict плюс явно включённый uncertain family, source/условия и видимый edit; C — save/open, две кнопки, cancel и уборку конкретного tracked экрана бота. Семейный strict не требуется при неизвестных данных. Перезапуск внутри MAX-окна делать только для конкретной границы, ещё не покрытой имеющимся evidence; локальная смена каталога уже проверена.

**Пользователь: «Пока недоступен». REAL_MAX_MOBILE=NOT_RUN, REAL_MAX_WEB=NOT_RUN; REAL_APPLICATION_SMOKE=REQUIRED.** Нового polling/API MAX в 18 нет, consumer-lock свободен, персональные DB/cursor сохранены. После доступности тестировщика сначала проверить системную дату, fresh snapshot и реальные примеры через локальный query; не назначать прошедший сеанс/выставку. Одного аккаунта в имеющемся у него клиенте достаточно для начала, это не доказательство cross-client continuity. Сейчас выполнять действия в MAX не нужно.

### Дополнение 19 — фактическое окно и локальный webhook

[19](pivot/19_REAL_MAX_AND_WEBHOOK_PREPARATION.md), [построчные ответы](evidence/real-webhook/human.md), [API/остановка](evidence/real-webhook/session.json). REAL_EDIT=PASS (API + наблюдение обоих клиентов). REAL_DELETE_OR_FALLBACK=PARTIAL: DELETE API PASS, видимое исчезновение HUMAN_NOT_VERIFIED; fallback не потребовался. Ctrl+C дал SESSION_STOPPED; PTY exit 1, PID отсутствует, lock свободен, pending=0. После остановки действий MAX не запрашивали.

R19-UX01/02: WEB отметил незаметность сохранения и повторы часового пояса. После окна добавлены «✅ СОХРАНЕНО»/состояние кнопки и одна зона в сохранённом представлении. Локальные регрессии проверяют идемпотентность/сохранность строки и даты/времени; нового human PASS нет. Изменение затрагивает только эти визуальные assertions, не отменяет серверный save/open, транспортный edit и прочие PASS. Объём развёрнутых условий остаётся UX замечанием.

REAL_WEBHOOK_PROFILE_LOCAL=PASS отдельно от PUBLIC_WEBHOOK_INGRESS=NOT_VERIFIED / DEPLOYMENT=NOT_RUN. Host/hostname/operator/access/period/evaluator procedure/refresh owner пользователь явно подтвердил как UNKNOWN; это не препятствие завершённой локальной подготовке и не новый READY. См. единственную передачу в SUBMISSION_READINESS.

### Impact mapping 20 — даты и сокращённые экраны

[Квитанция 20](pivot/20_CONCISE_COPY_AND_EXPLICIT_DATES.md), [полные сообщения до/после](evidence/concise-copy/screens.md), [новые человеческие наблюдения](evidence/concise-copy/human.md). Это уточнение действующих **U16-A/B/C**, не новая очередь F01–F10.

| Scope | Влияние и доказательство | Только изменённое / оставшееся наблюдение |
|---|---|---|
| REAL_EDIT; A/B isolation; ownership/revision/TTL; generation и erasure; упаковка/startup/webhook | CARRIED_FORWARD из 16–19 в прежнем объёме. Код транспорта, БД, source policy не менялся. AUTOMATED не становится HUMAN. | Не назначать повторов обычных permutations, pairing, сертификации webhook или старых успешных меню. |
| U16-A | AFFECTED: dated labels, экран времени/custom/Back/edit, формулировки состава/бюджета/темы/ошибок. Локально проверены реальные ISO action-аргументы, две зоны, полночь, месяц/год и query. | Связный MOBILE запрос город текстом → dated Tomorrow → семья/сумма/тема/сводка пройден. Ошибка суммы R20-UX01 исправлена после остановки. Точный остаток — в основной строке U16-A, без повторов прежних F06.W/F07.W PASS. |
| U16-B | AFFECTED: короткая карточка и условия, применимость тарифов, одна свежесть, явные unknown/conflict. 47 generated pairs и регрессии полного сообщения. | MOBILE подтвердил неизвестный семейный итог и возвраты; WEB — source-link. R20-UX02: касса и регистрация уточнены, общие фразы убраны после окна. Финальная читаемость условий HUMAN_NOT_RUN; открытие не заменяет оценку текста. |
| U16-C | AFFECTED: сокращённый контекст закладки и уведомления; «✅ СОХРАНЕНО»/кнопка сохранены, ровно две кнопки и прежний cancel route. | MOBILE open/confirm/cancel и WEB заметность save наблюдены. Saved context остаётся HUMAN_PARTIAL; видимое исчезновение tracked экрана HUMAN_NOT_VERIFIED. |

READY для MOBILE/WEB получен после независимой работы. Единственное окно R20: **25.09.2026 18:16:29–18:45:13 UTC / 21:16:29–21:45:13 МСК**, исходный предел **18:46:29 UTC**, **72/120** requests. С 18:41:29 завершали текущий маршрут. Ctrl+C, PTY exit 1; owned PID отсутствует, lock освобождён и проверен, pending/sending 0, DB/cursor сохранены. Прежние credentials, CA, bot pin и admission использованы повторно. Refresh/source requests 0. После остановки клиентских действий не назначали; исправления R20-UX01/02 имеют только локальное evidence. Сеанс завершён, нового start/resume/продления эта задача не разрешает.

### Историческая замороженная очередь delta 15 — окно завершено

Продолжение отдельно разрешено пользователем после остановленного окна 14. До main start сохранены исходный ledger и ограниченная очередь: приоритет F09 → F08.C.generation → недостающие MOBILE → точные WEB-маршруты. WEB=A, MOBILE=B; оба уже допущены. Повторного pairing, запроса токена и переоценки F01/F05/WEB F06–F07 не было. История заморозки и выполненных действий — в [15](pivot/15_DELTA_CLIENT_CONTINUATION.md); она не является активной очередью.

**Исторический остаток окна 15 — 13 assertions: 12 NOT_RUN и 1 HUMAN_PARTIAL; теперь SUPERSEDED → U16-A/B.** Ниже только недостающие действия; после остановки это не инструкции к исполнению:

1. MOBILE B: три текущих custom-ввода F07.M.date/time/budget совместить с тремя F06.M edit/summary/reset. Перед каждым редактированием варианты должны быть включены; после принятого ввода увидеть новый запрос и отдельный opt-in. Один неверный ввод и старый код — только F07.M.rejection на сумме. Читать фактический код формы; Back→preset уже выполнены.
2. MOBILE B: только «К результатам» из detail — остаток F04.M.full-back. «Все условия» → «К карточке», source-link и probe→start завершены; не повторять.
3. WEB A: только F02.W.back-date/time/budget; F03.W.detail-candidate через актуальное «Подробнее 3» после opt-in; оставшийся F04.W.full-back. Изменения фильтров по пути — setup, без повторных WEB F06/F07.

При отдельно разрешённом исполнении: по одному действию, текущие аккаунт/клиент, label/код и ожидаемый результат. Перед каждой инструкцией проверить clock, владельца/active, deadline/остаток requests, текущий запрос и fixture. Одно наблюдение может закрыть несколько явно названных assertions; ответ сразу записать отдельно от API/DB. Не ожидать дневной выдачи на уже закончившейся сегодняшней дате. Setup пройденных меню не требует отдельных подтверждений.

Лимиты завершённого продолжения: один `start --minutes 30`, максимум 120 polling requests, последние 5 минут — завершение текущего assertion и остановка. Счётчик/deadline не продлевались, автоматического следующего окна нет. После shutdown/неопределённой остановки никаких действий MAX. Краткое notification не определяет целостность: реальная старая кнопка уже проверена по свежему списку и открытию.

Сохранять pinned runtime/CA/credentials и штатные startup guards без дублирующих команд. Только истёкший synthetic fixture можно подготовить в новый файл до старта; прежние файлы/DB/cursor сохранять. Не править live DB, callbacks, TTL, реальные даты или subscriptions. Новый restart без конкретного оставшегося integration-вопроса не требуется. Остановка — только проверенного владельца, с фактической проверкой exit/lock.

### Итог окна и одна передача

Перенесены **34 HUMAN_PASS** из 11–14; в продолжении добавлены **9 HUMAN_PASS** и подтверждён один подшаг F04.M.full-back. Итого **43 HUMAN_PASS, 1 HUMAN_PARTIAL, 12 NOT_RUN и 9 существующих AUTOMATED_PASS**. Полные условия/возврат к карточке внутри PARTIAL не становятся ожидающими. Автоматизация не запускалась заново и не переименована в HUMAN PASS. Изоляция закладки B после стирания A — PASS; continuity одного A сохраняется по 11 и не подменяется парой A WEB/B MOBILE.

Main: **18:00:04.023–18:27:48.262 UTC / 21:00:04–21:27:48 МСК**, deadline 18:30:04.023 UTC; 75/120 зарезервированных запросов, 74 успешных ответа/commit, 42 обработанных события. MAX принял 40 messages + 34 answers; это транспортные записи. После последнего человеческого ответа новые действия не запрашивались. Ctrl+C не остановил владельца; адресный `Stop-Process` после сверки PID/пути/start time завершил его, терминал exit 1, SESSION_STOPPED отсутствует. В 18:27:48.873 UTC PID отсутствует, mutex свободен, PENDING/SENDING=0; DB/cursor/admission A+B сохранены, у A 0 закладок, у B 1. **RUNNER=STOPPED, принудительно**, graceful restart не заявлен. Подготовительная неудача resume и замена только истёкшего fixture описаны в 15.

**Историческая передача 15, заменена U16 выше:** текущий B/MOBILE находится в home после `/start`, закладка B сохранена. Для отдельно разрешённого продолжения после проверки fixture и READY первый шаг — «Подобрать» как setup к сводке 25.09.2026 / 12–18 / 500 ₽ / театр, если эта дата ещё допустима по фактическому clock; иначе выбрать подходящую будущую дату synthetic-каталога. Первый недостающий результат — текущий custom-ввод даты вместе с F06.M.date reset. Проверенные меню/Back→preset не подтверждать заново. Сейчас runner остановлен; выполнять действия MAX не нужно.

## Передача оператору: отсутствующие условия

1. A выполнен: replacement file прочитан внутри приложения, ротация подтверждена оператором, /me и subscriptions успешны, pin/ссылка сохранены. Повторно запрашивать credential в чате не нужно.
2. A и B допущены; текущие наблюдения и точный остаток — только в [ledger](#c-текущий-assertion-ledger-и-ограниченная-delta), результат продолжения — в [15](pivot/15_DELTA_CLIENT_CONTINUATION.md). Разрешённое продолжение завершено; автоматического следующего окна нет.
3. Одобренный host/endpoint/период доступности нужны будущему deployment/webhook, не блокируют test-only polling. Публичная доставка остаётся вне разрешения; narrow ADMITTED_TESTERS_FACTS для reviewed Кремля/МИЕ действует по 17.

Независимые исправления и пакет DRAFT завершены в 10 / [SUBMISSION_READINESS](SUBMISSION_READINESS.md). Recovery не переизобретался, исторический preflight не объявлен новой live-проверкой. Даже successful synthetic smoke не разрешает provider publication и не доказывает спрос/качество афиши. Напоминания, новое получение данных и публичный выпуск не начинаются.
