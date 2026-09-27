# Культурный план — события и личные закладки в MAX

«Культурный план» помогает выбрать культурное событие в Казани или Екатеринбурге по дате, времени, составу посетителей и общему бюджету на вход. Карточка показывает известные условия, источник и дату получения сведений. События с недостающими условиями открываются по отдельному выбору пользователя.

Основной путь: **город → дата и время → посетители → бюджет и тема → результаты → условия → сохранить → «Мои события»**. Закладку можно открыть или удалить; она не оформляет билет или регистрацию. Команда `/delete_data` с подтверждением удаляет личные параметры и закладки. После текстового ввода ответ появляется новым сообщением ниже него, а кнопки обновляют текущий экран.

## Что понадобится

- Windows PowerShell и работающий Docker Desktop с Compose v2, Linux-контейнеры. Команды ниже выполняются из корня скачанного репозитория.
- Интернет для первой сборки образов и зависимостей. Node и Python на компьютере для запуска бота не нужны.
- Для настоящего MAX: действующий токен своего бота, HTTPS-доступ к MAX и единственный запущенный потребитель обновлений этой identity. Для демо токен не нужен.

## Быстрый запуск: демо без MAX

Одна команда запускает все локальные компоненты:

```powershell
docker compose up --build -d --wait
```

Демо работает на вымышленных событиях с тестовой датой 05.04.2030 и локальным симулятором MAX. После сборки оно не обращается к MAX или сайтам учреждений. Отдельного веб-интерфейса у демо нет.

Проверка подбора, карточки и сохранения закладки:

```powershell
docker compose ps
docker compose exec app node dist/scripts/organizer-check.js
```

Ожидаются `healthy`, затем `PASS` и `transport: SIMULATED_MAX`. Проверка создаёт нового синтетического пользователя без сопряжения тестировщика. Доступность: [localhost:3000/healthz](http://127.0.0.1:3000/healthz), ответ `{"status":"ok","mode":"local"}`.

Для отдельной копии или занятого порта перед запуском задайте параметры в этом PowerShell; используйте их до остановки копии:

```powershell
$env:COMPOSE_PROJECT_NAME = 'cultural-plan-review'
$env:DEMO_PORT = '33027'
$env:CULTURAL_PLAN_IMAGE = 'cultural-plan:review'
```

## Подключение к настоящему MAX

[Бот проекта в MAX](https://max.ru/t432_hakaton_max_bot) доступен, пока оператор держит его запущенным и платформа допускает пользователя к диалогу. Обычный режим — `PUBLIC`: начать можно через Start, `/start` или личное сообщение; pairing не требуется.

**Первая настройка своей копии.** Создайте папку `secrets` и сохраните действующий токен одной строкой без кавычек в `secrets/max_bot_token`. Существующие секреты и `.env.public` сохраняйте.

```powershell
New-Item -ItemType Directory -Force secrets | Out-Null
```

MAX использует `platform-api2.max.ru` и сертификат Минцифры. Следующая команда получает официальный корневой CA с Госуслуг, проверяет закреплённый отпечаток и срок, сохраняет его только в этой копии. Хранилище сертификатов Windows не меняется. Если файл уже есть, команда проверяет его без перезаписи.

```powershell
docker compose -f compose.setup.yaml run --build --rm setup node /app/dist/scripts/setup-max-ca.js
$env:NODE_EXTRA_CA_CERTS_CONTAINER = '/run/secrets/max-official-root.pem'
```

Если `.env.public` ещё нет, создайте его из поставляемого [.env.public.example](.env.public.example):

```powershell
docker compose -f compose.setup.yaml run --rm setup
```

Инициализация делает только `GET /me` и `GET /subscriptions`, записывает ID бота, вычисленный порт блокировки и путь CA. Она отказывается перезаписывать существующий файл. Ожидается `webhookExists: false`; при `true` используйте согласованный webhook-профиль или отдельно решите конфликт с оператором подписки.

**Запуск под наблюдением оператора:**

```powershell
docker compose --env-file .env.public -f compose.polling.yaml run --rm --no-deps app node dist/scripts/polling-check.js
docker compose --env-file .env.public -f compose.polling.yaml up --build
```

Первая команда проверяет конфигурацию **настоящим загрузчиком внутри контейнера**, включая CA, уже загруженный Node. Ожидаются `polling_configuration_ready`, `extraCA: LOADED_BY_NODE`. Вторая запускает foreground polling; сигнал готовности — `polling_started`, `admission: PUBLIC`. Ограничений длительности тестовой кампании у этого запуска нет. TLS, identity, отсутствие webhook и блокировка второго потребителя проверяются при старте.

| Настройка | Значение и назначение |
|---|---|
| `ADMISSION_MODE` / `APP_INGRESS` | `PUBLIC` / `polling`; задаются профилем |
| `MAX_EXPECTED_BOT_ID` / `MAX_CONSUMER_PORT` | Получаются при инициализации; один бот — один потребитель |
| `MAX_BOT_TOKEN_FILE` | На хосте `secrets/max_bot_token`, в контейнере `/run/secrets/max_bot_token` |
| `NODE_EXTRA_CA_CERTS_CONTAINER` | `/run/secrets/max-official-root.pem`; Compose передаёт в `NODE_EXTRA_CA_CERTS` **до запуска Node** |
| `MAX_REQUEST_TIMEOUT_MS` | Обычные запросы: 5000 мс, допустимо 100–10000 |
| `MAX_POLL_TIMEOUT_SECONDS` | Ожидание MAX: 30 с; отдельный клиентский deadline — 35000 мс |
| `LIVE_SCOPE_CONFIRMED` / `LIVE_EXCLUSIVE_CONSUMER_CONFIRMED` | `true` после проверки токена своей identity и отсутствия другого потребителя |

`./secrets` монтируется только для чтения. Host-путь сертификата внутри контейнера не работает; `--env-file` сам по себе не передаёт произвольные переменные процессу. Рабочая передача CA уже включена в `compose.polling.yaml`; дополнительный локальный override не требуется. Подробности и официальный источник: [операторская инструкция](docs/ORGANIZER_CHECK.md#tls-и-первая-настройка).

## Самопроверка и сигналы

| Сигнал | Значение / действие |
|---|---|
| `healthy`, `PASS / SIMULATED_MAX` | Демо и автоматический сценарий работают |
| `polling_started` | Identity и подписки проверены, consumer запущен |
| `polling_configuration_failed` | Исправьте названное поле или доступность файла |
| `EXISTING_WEBHOOK_PRESERVED` | Найден webhook; polling остановлен, подписка сохранена |
| `SECOND_LOCAL_CONSUMER_OR_PORT_BUSY` | Уже есть потребитель или занят порт identity |
| `polling_failure.request` | Путь запроса, deadline и длительность; стартовые `/me` и `/subscriptions` отличаются от long polling |
| «Данные устарели» / «данных нет» | Обновите каталог или выберите другие параметры |

Ожидаемое поведение: «Казань» под вопросом о городе даёт новый экран выбора даты; ошибочная дата — новый ответ с подсказкой и действующей формой; «Сохранить» добавляет запись в «Мои события». Подробная [самопроверка](docs/ORGANIZER_CHECK.md), [запись автоматической проверки этой версии](docs/verification/ORGANIZER_SETUP_AND_EDITABLE_PPTX.md).

## Остановка, перезапуск и данные

Демо: проверить сохранённую закладку после перезапуска и остановить сервис:

```powershell
docker compose restart
docker compose exec app node dist/scripts/organizer-check.js --restart
docker compose down
```

Повторный запуск — та же команда `docker compose up --build -d --wait`. Именованный том `demo-data` сохраняется при `restart` и `down`.

Настоящий бот: Ctrl+C в его терминале. Для применения обновления выполните в той же копии и с тем же Compose project:

```powershell
docker compose --env-file .env.public -f compose.polling.yaml stop
docker compose --env-file .env.public -f compose.polling.yaml up --build
```

Том `public-data` хранит SQLite, cursor и активный каталог в `/app/runtime`. Не меняйте имя проекта при обычном перезапуске. `down` сохраняет тома, `down -v` удаляет данные. Параметры пользователя хранятся до 30 дней без активности, до 50 закладок — до удаления; [приватность и резервное восстановление](docs/PRIVACY.md).

## Афиша и обновление

В комплекте — наблюдения пяти учреждений от 26.09.2026: **62 события, 93 варианта посещения** (75 сеансов и 18 выставочных периодов), Казань и Екатеринбург. Это часть афиши. Выставочный период не означает непрерывный сеанс; неизвестная цена не означает бесплатный вход.

Обновление выполняет оператор. Остановите polling, задайте новое имя каталога съёмки и после успешного обновления запустите бота:

```powershell
docker compose --env-file .env.public -f compose.polling.yaml run --rm --no-deps app node dist/scripts/real-catalog.js refresh runtime/source-cache/refresh-01
```

Следующая съёмка — `refresh-02`; повтор имени использует кеш. Обновление проверяет источники, снимок и hash, затем атомарно меняет указатель. Срок свежести — 72 часа от исходных наблюдений; установка его не продлевает. Ошибка обновления сохраняет прежний снимок; просроченные карточки блокируются. Расписания автоматического обновления нет. [Источники, публичные факты и сроки проверки условий](docs/SOURCE_INVENTORY.md).

## Устройство и материалы

| Тема | Состав / документ |
|---|---|
| Архитектура | MAX → общий admission → durable inbox → worker → подбор и SQLite → durable outbox → MAX; webhook использует Fastify |
| Зависимости | Node 22.23.2, TypeScript, Fastify, better-sqlite3, Zod; [версии](package.json), [lockfile](package-lock.json), Docker-образы закреплены digest |
| Порты | Демо: localhost 3000 (настраивается); приложение внутри контейнера 3000; polling: localhost-порт identity; постоянный webhook: 80/443 |
| Внешние сервисы | MAX — сообщения; сайты пяти учреждений — операторское обновление; ACME — TLS постоянного webhook |
| API и данные | [OpenAPI 3.1](openapi.json), [DATA-API.yaml](DATA-API.yaml), [контракт данных](src/data/contract.ts), [тестовые данные](src/culture/stage4-fixture.ts) |
| Постоянная служба | [Webhook-профиль](deploy/compose.public.yaml) и [операторская инструкция](docs/ORGANIZER_CHECK.md#постоянный-webhook); требует отдельно подготовленных хоста, DNS и HTTPS |
| Презентация | [PDF: 13 слайдов](presentation/cultural-plan.pdf) · [предпросмотр сдачи: 14](presentation/cultural-plan-submission-preview.pdf) · [PPTX: 13](presentation/cultural-plan.pptx) · [PPTX: 14](presentation/cultural-plan-submission-preview.pptx) · [как редактировать](presentation/README.md) |
| Сдача | [Состав комплекта](docs/SUBMISSION_CHECKLIST.md), [требования R07/R11 и остальные ID](docs/00_REQUIREMENTS_AND_EVIDENCE.md), [сторонние компоненты](THIRD_PARTY_NOTICES.md) |

Условия оценки: локальный polling работает, пока запущен оператором; размещённая непрерывная служба в комплект не входит. Доставка и внешний вид текущей версии в мобильном и веб-клиенте MAX отдельно не проверены. Билеты и допуск подтверждает источник. Секреты и заполненный закрытый лист передаются отдельно уполномоченным получателям; в репозиторий и публичный комплект они не входят.
