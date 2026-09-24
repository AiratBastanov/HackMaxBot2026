# Культурный план: первый технический smoke MAX mobile/web

**BOT_API_INSPECTION = PASS; REAL_APPLICATION_SMOKE = REQUIRED; REAL_MAX_MOBILE = PARTIAL; REAL_MAX_WEB = PARTIAL; WEBHOOK_INGRESS = NOT_VERIFIED; PUBLIC_DEPLOYMENT = NOT_VERIFIED (не развёрнуто).** /me подтвердил «Хакатон МАХ 432», ID `426717762`, [@t432_hakaton_max_bot](https://max.ru/t432_hakaton_max_bot); subscriptions=0. Ротация и единственный consumer подтверждены оператором. Прежнее отсутствие токена относится к истории [10](pivot/10_USER_READINESS_AND_FIRST_MAX_CHECK.md); текущие факты — [11](pivot/11_FIRST_AUTHENTICATED_MAX_SESSION.md). PUBLIC_DISPLAY = NOT_CLEARED, DATA_SUITABILITY = EXPLORATORY_ONLY.

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

## C. Человеческое наблюдение: выбранное ограниченное окно

Записать UTC-время, code SHA, image ID, bot ID (приватно), mobile OS/app version и web browser/MAX web version. Если версия недоступна, записать ограничение. Для каждого F01–F10: expected / actual, PASS/FAIL/NOT_VERIFIED и обезличенное evidence. Повторить в обоих клиентах; cross-client — один аккаунт A, изоляция — другой consenting B. HTTP 200/ACKNOWLEDGED не доказывают видимость человеку.

| Проверка | Ожидаемое наблюдение на stage4 synthetic fixture | Mobile | Web |
|---|---|---|---|
| F01 | /start: маркировка вымышленных данных, Подобрать / Мои события / О данных | NOT_VERIFIED | Меню подтверждено A; маркировка отдельно не подтверждена |
| F02 | Подобрать → Другая дата → Назад → Завтра: следующий шаг Время. Другое время → Назад → 12–18: Бюджет. Другая сумма → Назад → до 500: Интерес | Клиент последнего прохода не уточнён | PARTIAL: обычный путь пройден; A также подтвердил возвраты и итоговый интерес, клиент не назван |
| F03 | Театр → результаты: театральная экспозиция раньше выставки света в «Совпадает по известным условиям». Дорогого зала нет. Отдельный opt-in добавляет мастерскую в «Варианты, где нужно уточнение»; Подробнее 3 открывает именно её. Время 12–18 известно, взрослый тариф неизвестен | PARTIAL: группа/мастерская/известное время/неизвестный тариф подтверждены A | PARTIAL: strict-группа видна; весь порядок отдельно не подтверждён |
| F04 | Подробнее strict: Вымышленная улица 17, часы 10–18, пересечение 12–18, последний вход 17:30, 200 ₽ взрослый, обязательная регистрация. Дата читаема, Москва/UTC+3 указан; нет повторов оговорок. Все условия/назад и группировка происхождения работают. Отдельно проверить открытие example.org в браузере и фактическую доступность иллюстративной страницы: HTTP 200 по вымышленному пути не обещается, это не страница площадки/организатора | PARTIAL: карточка видна | PARTIAL: перечисленные существенные условия подтверждены, внешняя ссылка не проверена |
| F05 | Сохранить strict и uncertain → Мои события → открыть: условия/неопределённость остаются; второй клиент A видит тот же список | PARTIAL: strict из web открыт; candidate сохранён | PARTIAL: strict save/open; candidate из mobile открыт с неопределённостью |
| F06 | С результатов редактировать дату/время/бюджет через custom → Назад → значение: сводка. Бюджет 0 сбрасывает opt-in. Старая кнопка не меняет новый запрос | NOT_VERIFIED | NOT_VERIFIED |
| F07 | Ошибочная дата с актуальным кодом отвергается; реальная завтрашняя дата принимается. После Назад/повторного входа прежний код отвергается; аналогично время/сумма | NOT_VERIFIED | NOT_VERIFIED |
| F08 | Удалить закладку, сохранить снова: старое подтверждение не удаляет новую. /delete_data → Да: нейтральный callback ответ и пустой список; старое save/erase не возвращает/стирает новое состояние | PARTIAL: удаление подтверждено A и БД; re-save/старые подтверждения открыты | PARTIAL: /delete_data выполнен по заданию; пустой /saved подтверждён точным текстом, клиент ответа ещё уточняется |
| F09 | B имеет собственную закладку; стирание A её не затрагивает. Если клиент не позволяет воспроизвести чужой callback, записать ограничение без искусственного human PASS | NOT_VERIFIED | NOT_VERIFIED |
| F10 | Сохранить → операторский restart только test app → список/полные условия сохраняются → удалить. /probe отдельный, /start возвращает flow | PARTIAL: карточка после restart видна; удаление подтверждено уже в отдельном сеансе | PARTIAL: сохранено до restart, DB/campaign сохранились |

Если экран не приходит, проверить обезличенные statuses: SUPPRESSED_DISPLAY/CONTACT, STALE, FAILED_SEMANTIC, UNKNOWN_RESULT. Не повторять неоднозначную отправку. После сеанса остановить только согласованный test process, сохранить volumes. Результаты записывать отдельно от локального transcript: дата/клиент/версия/code/route, шаг, expected/actual, ограничение и обезличенное evidence. Первые человеческие наблюдения приведены выше и в 11; версии клиентов неизвестны. Первая кампания завершилась автоматически через 15 минут: 46 запросов, cursor/DB сохранены, фонового процесса нет. Немедленное удаление истории MAX/прежних backups не обещается.

Пустой `/saved` содержит «Закладок пока нет» и обычные кнопки «Удалить мои данные» / «Главная». Подтверждение удаления — отдельный экран с кнопкой «Да, удалить мои данные». Кнопка доступна и при пустом списке, поскольку удаляет также параметры подбора; сама ничего не выполняет. Сообщение A о повторном подтверждении разрешено после сверки точного видимого текста, SQLite, локального E2E и двух собственных сообщений через read-only MAX API; исправление runtime не потребовалось. A подтвердил Back/custom-переходы F02 и выбор интереса, но не указал клиент; это не двойной mobile/web PASS.

Последний явно продлённый по просьбе A сеанс завершился автоматически 24.09.2026 в 17:44:38 МСК: 81 попытка /updates, 80 успешных ответов/commit, 34 FLOW_ACCEPTED, 57 успешных исходящих API-операций. Exit 0, mutex освобождён, 0 незавершённых отправок, БД/cursor сохранены. Все task-owned процессы остановлены. Полные результаты трёх кампаний — в 11.

## Передача оператору: отсутствующие условия

1. A выполнен: replacement file прочитан внутри приложения, ротация подтверждена оператором, /me и subscriptions успешны, pin/ссылка сохранены. Повторно запрашивать credential в чате не нужно.
2. A сопряжён и допущен; для C остаются непроверенные пункты матрицы выше. Для следующего отдельно начатого сеанса — свежий snapshot при необходимости, `start` с сохранённой БД, действия только после READY. B отдельно нужен для F09, чужое согласие не предполагается.
3. Одобренный host/endpoint/период доступности нужны будущему deployment/webhook, не блокируют test-only polling. Публичная доставка provider-карточек остаётся запрещённой.

Независимые исправления и пакет DRAFT завершены в 10 / [SUBMISSION_READINESS](SUBMISSION_READINESS.md). Recovery не переизобретался, исторический preflight не объявлен новой live-проверкой. Даже successful synthetic smoke не разрешает provider publication и не доказывает спрос/качество афиши. Напоминания, новое получение данных и публичный выпуск не начинаются.
