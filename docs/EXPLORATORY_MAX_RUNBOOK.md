# Культурный план: технический smoke MAX mobile/web, этап 4

**REAL_APPLICATION_SMOKE = REQUIRED; REAL_MAX_MOBILE = NOT_VERIFIED; REAL_MAX_WEB = NOT_VERIFIED.** Пользователь подтвердил отсутствие live-предпосылок. Локальные проверки — в [09](pivot/09_STAGE4_CORRECTIONS_AND_SMOKE.md); это не наблюдения MAX. PUBLIC_DISPLAY = NOT_CLEARED, DATA_SUITABILITY = EXPLORATORY_ONLY.

Задача разрешает техническую настройку уже конкретно одобренного test environment, synthetic-каталог и consenting testers. Старый запрет phase 2/3 на deployment/subscription не запрещает этот узкий этап. Разрешение не определяет отсутствующего владельца host или бота. Новые hosting/accounts, DNS/firewall, desktop tunnels, provider-карточки и публичный выпуск не входят в работу.

## A. Только чтение identity и subscriptions

Нужны назначенный проектный бот, установленная область доступа и безопасный локальный credential file. Рабочий HTTPS endpoint, БД и тестировщики для GET не нужны. `.env.inspect.example` — безопасный шаблон; `.env.inspect` и `secrets/` ignored. Секреты не вводятся в чат, argv, Git или журналы.

1. Оператор размещает токен назначенного бота в защищённом файле и задаёт MAX_BOT_TOKEN_FILE в .env.inspect. MAX_INSPECTION_SCOPE_CONFIRMED=true отражает уже имеющееся разрешение, не создаёт его.
2. Из корня после build: `npm.cmd run live:inspect` (Linux: `npm run live:inspect`). Только GET /me и GET /subscriptions; SQLite не открывается. Отчёт содержит bot ID и число подписок, без пользовательских имён, токена и чужих URL.
3. Сверить bot ID с назначенным проектным ботом и закрепить MAX_EXPECTED_BOT_ID в .env.inspect и .env.live. Повторная проверка с expected ID отвергает другого бота. Identity не доказывает право менять чужой consumer.

Если TLS требует дополнительного CA, использовать только проверенный официальный файл через NODE_EXTRA_CA_CERTS в окружении процесса. Не отключать TLS и не менять системное хранилище. Контракт MAX указывает platform-api2.max.ru, заголовок Authorization и доверенную цепочку.

## B. Одобренные test host/endpoint и регистрация

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

## C. Человеческое наблюдение: до 15 минут активного сеанса

Записать UTC-время, code SHA, image ID, bot ID (приватно), mobile OS/app version и web browser/MAX web version. Если версия недоступна, записать ограничение. Для каждого F01–F10: expected / actual, PASS/FAIL/NOT_VERIFIED и обезличенное evidence. Повторить в обоих клиентах; cross-client — один аккаунт A, изоляция — другой consenting B. HTTP 200/ACKNOWLEDGED не доказывают видимость человеку.

| Проверка | Ожидаемое наблюдение на stage4 synthetic fixture | Mobile | Web |
|---|---|---|---|
| F01 | /start: маркировка вымышленных данных, Подобрать / Мои события / О данных | NOT_VERIFIED | NOT_VERIFIED |
| F02 | Подобрать → Другая дата → Назад → Завтра: следующий шаг Время. Другое время → Назад → 12–18: Бюджет. Другая сумма → Назад → до 500: Интерес | NOT_VERIFIED | NOT_VERIFIED |
| F03 | Театр → результаты: театральная экспозиция раньше выставки света; обе strict. Дорогого зала нет. Отдельный opt-in добавляет мастерскую цвета как вариант для проверки | NOT_VERIFIED | NOT_VERIFIED |
| F04 | Подробнее strict: Вымышленная улица 17, часы 10–18, пересечение 12–18, последний вход 17:30, 200 ₽ взрослый, обязательная регистрация. Все условия/назад работают; source ведёт на точный example.org без preview | NOT_VERIFIED | NOT_VERIFIED |
| F05 | Сохранить strict и uncertain → Мои события → открыть: условия/неопределённость остаются; второй клиент A видит тот же список | NOT_VERIFIED | NOT_VERIFIED |
| F06 | С результатов редактировать дату/время/бюджет через custom → Назад → значение: сводка. Бюджет 0 сбрасывает opt-in. Старая кнопка не меняет новый запрос | NOT_VERIFIED | NOT_VERIFIED |
| F07 | Ошибочная дата с актуальным кодом отвергается; реальная завтрашняя дата принимается. После Назад/повторного входа прежний код отвергается; аналогично время/сумма | NOT_VERIFIED | NOT_VERIFIED |
| F08 | Удалить закладку, сохранить снова: старое подтверждение не удаляет новую. /delete_data → Да: нейтральный callback ответ и пустой список; старое save/erase не возвращает/стирает новое состояние | NOT_VERIFIED | NOT_VERIFIED |
| F09 | B имеет собственную закладку; стирание A её не затрагивает. Если клиент не позволяет воспроизвести чужой callback, записать ограничение без искусственного human PASS | NOT_VERIFIED | NOT_VERIFIED |
| F10 | Сохранить → операторский restart только test app → список/полные условия сохраняются → удалить. /probe отдельный, /start возвращает flow | NOT_VERIFIED | NOT_VERIFIED |

Если экран не приходит, проверить обезличенные statuses: SUPPRESSED_DISPLAY/CONTACT, STALE, FAILED_SEMANTIC, UNKNOWN_RESULT. Не повторять неоднозначную отправку. После сеанса остановить только согласованный test process, сохранить volumes. Результаты записать в 09 или следующую датированную квитанцию. Немедленное удаление истории MAX/прежних backups не обещается.

## Передача оператору: отсутствующие условия

1. Назначенный бот и безопасный credential file с областью доступа отсутствуют: блокируют A (GET identity/subscriptions) и зависимые B/C.
2. Конкретный одобренный host/endpoint и доступ оператора отсутствуют: блокируют deployment, live mount/TLS/health validation и регистрацию B; не блокируют A.
3. Consenting mobile/web тестировщики и их действия отсутствуют: блокируют C и все human PASS F01–F10.

Локальные исправления/recovery/offline preflight выполняются отдельно. Даже successful synthetic smoke не разрешает provider publication и не доказывает спрос/качество афиши. Напоминания, новое получение данных и публичный выпуск не начинаются.
