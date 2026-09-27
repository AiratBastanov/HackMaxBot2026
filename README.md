# Культурный план — бот MAX

Бот подбирает культурные события Казани и Екатеринбурга по дате, времени, бюджету и составу посетителей. Показывает источник и неизвестные условия; сохраняет личные закладки. Закладка не покупает билет и не регистрирует посетителя.

**Быстрый запуск без MAX:** нужен Docker с Compose, свободный порт 3000. Конфигурация демо уже в `compose.yaml`; токены, `.env`, Node на хосте и частные файлы не нужны.

```sh
docker compose up --build -d
docker compose ps
docker compose exec app node dist/scripts/organizer-check.js
```

Ожидаются `healthy` и `PASS`, `transport: SIMULATED_MAX`. Проверка проходит HTTP webhook → worker → SQLite → симулятор MAX, подбор и закладки. Это исполняемая офлайн-демонстрация на **синтетических событиях и часах 05.04.2030**, не наблюдение настоящего клиента. Сеть нужна для первой загрузки образов/npm; работа демо не обращается к MAX или поставщикам афиши.

```sh
docker compose restart
docker compose exec app node dist/scripts/organizer-check.js --restart
docker compose down
```

`down` останавливает компоненты, сохраняя именованный том SQLite. Для повторного запуска — первая команда. `down -v` удаляет демо-данные и для обычной остановки не нужен. Доступность: `http://127.0.0.1:3000/healthz`, ответ `{"status":"ok","mode":"local"}`. Если порт занят, задайте `DEMO_PORT=33021` в `.env`; другая копия останется нетронутой. Подробная [самопроверка](docs/ORGANIZER_CHECK.md).

## Настоящий бот: foreground polling для разработки и оценки

Обычный профиль — `ADMISSION_MODE=PUBLIC`: любой новый пользователь, которого MAX допускает к личному диалогу, начинает через Start, `/start` или личное сообщение. Путь: город → дата/время → посетители → бюджет/тема → результаты → условия → сохранить → «Мои события» → открыть/удалить. Параметры и закладки другого пользователя недоступны. Удаление своих данных: `/delete_data` с подтверждением. `/qa`, pairing, probe и административные команды в PUBLIC недоступны.

Скопируйте `.env.public.example` в `.env.public`. Положите действующий токен **своего** бота в `secrets/max_bot_token` (одна строка, без кавычек). В этом workspace используется уже закреплённый бот **426717762 / t432_hakaton_max_bot** и существующий секрет; повторная выдача токена не нужна. MAX-токен обязателен для связи с MAX, даже когда источники событий не требуют ключей. В Git попадают только примеры.

Убедитесь, что webhook отсутствует и другая копия нигде не потребляет этого бота. `GET /me` проверяет закреплённую identity; `GET /subscriptions` при наличии webhook останавливает polling. Подписки автоматически не создаются и не удаляются.

Если на машине нужен дополнительный доверенный CA, положите проверенный сертификат в `secrets/max-official-root.pem` и добавьте в `.env.public` строку `NODE_EXTRA_CA_CERTS_CONTAINER=/run/secrets/max-official-root.pem`. Compose передаёт её в `NODE_EXTRA_CA_CERTS` контейнера; существующий read-only mount `./secrets:/run/secrets` включает этот файл. Отдельный override не нужен. Для native-запуска задайте `NODE_EXTRA_CA_CERTS=secrets/max-official-root.pem`. CA необязателен для окружений, где цепочка уже доверенная; сертификат и `.env.public` в Git не добавляются.

```sh
docker compose --env-file .env.public -f compose.polling.yaml up --build
```

Это **foreground**: остановка Ctrl+C, затем `docker compose --env-file .env.public -f compose.polling.yaml down`. Тот же `up` возобновляет работу с сохранённым cursor и SQLite. Лимита кампании 30 минут/120 запросов здесь нет; deadlines, pacing, три последовательные ошибки и SIGINT/SIGTERM остаются. Служба для production использует webhook, как требует [MAX](https://dev.max.ru/docs-api/methods/GET/updates).

Один consumer на бота: локальный mutex и зарезервированный host-порт 45658 защищают эту identity. Для другого бота создайте новый конфиг через `scripts/identity-init.ts` (ниже), включая вычисленный `MAX_CONSUMER_PORT`. Между разными хостами эксклюзивность обеспечивает оператор. Ни один профиль не отменяет ограничения платформы MAX, доступность бота или правила его обнаружения. В рамках этой поставки работающий размещённый сервис не запускался.

## Каталог и обновление

В поставке **62 события / 93 варианта посещения: 75 сеансов и 18 выставочных периодов**, Казань 25, Екатеринбург 37; пять учреждений. Наблюдения 26.09.2026, окно местных дат 26.09–25.10.2026. Срок фактической свежести — 72 часа от самого раннего использованного наблюдения, точные границы в review. Установка не продлевает срок. Истёкшие реальные карточки блокируются; синтетика вместо них не подставляется.

Операторская команда собирает публичные страницы, валидирует нормализованные данные, source policy и hash, затем атомарно активирует снимок. **Расписания автообновления нет.** Остановите polling; после refresh снова запустите foreground-команду. При каждой новой съёмке задайте новое имя каталога; повтор того же имени переиспользует успешный кеш и продолжает счётчики, не делает страницы свежими.

```sh
docker compose --env-file .env.public -f compose.polling.yaml run --rm --no-deps app node dist/scripts/real-catalog.js refresh runtime/source-cache/refresh-01
```

Для следующего обновления используйте `refresh-02`. Ошибка парсера/источника не должна стереть ранее полезные записи: активация останавливается при необъяснённой потере, указатель остаётся прежним. Все запуски приложения перечитывают указатель; работающий процесс сам не подменяет каталог. Действующая проверка оснований публичного показа действует до 26.10.2026; затем требуется повторный просмотр условий источников и изменение проверяемой политики, а не ручная правка дат/hash снимка. [Инвентаризация, ограничения и измеренные запросы](docs/SOURCE_INVENTORY.md).

## Production webhook и конфигурация

Нужны отдельно подготовленные постоянный хост, DNS, HTTPS:443 с доверенным сертификатом, оператор и MAX webhook secret. Они не предоставлены этой задачей. [Профиль](deploy/compose.public.yaml) содержит Fastify/worker/SQLite и Caddy; порты 80/443 для Caddy, приложение 3000 внутри сети, mutex на loopback. Файлы `secrets/max_bot_token`, `secrets/max_webhook_secret` монтируются read-only; секреты не передаются через build args. Укажите реальные `PUBLIC_HOST`, `PUBLIC_BASE_URL`, `ACME_EMAIL`, `MAX_EXPECTED_BOT_ID`, `MAX_CONSUMER_PORT`, `SOURCE_VERSION`, `LIVE_SCOPE_CONFIRMED`, `LIVE_EXCLUSIVE_CONSUMER_CONFIRMED`. Не используйте фиктивный домен. Только после подготовки инфраструктуры применяется `docker compose --env-file .env.webhook -f deploy/compose.public.yaml up --build -d`; это не регистрирует webhook. Регистрация — отдельное действие оператора по [контракту MAX](https://dev.max.ru/docs-api/methods/POST/subscriptions).

`MAX_REQUEST_TIMEOUT_MS` ограничивает обычные запросы (по умолчанию 5000 мс, допустимо 100–10000; 45000 отклоняется). `MAX_POLL_TIMEOUT_SECONDS` задаёт ожидание `/updates` (по умолчанию 30 с, допустимо 0–90 по [контракту MAX](https://dev.max.ru/docs-api/methods/GET/updates)); клиентский deadline вычисляется как ожидание × 1000 + 5000 мс, обычно 35000 мс. Первый запрос без сохранённого cursor использует ожидание 0 с с тем же polling deadline. SIGINT/SIGTERM немедленно отменяют текущий запрос, включая стартовые проверки; намеренная отмена не считается timeout. При сетевом сбое `polling_failure.request` указывает фиксированный путь, deadline и прошедшее время без секретов и marker. Проверку TLS не отключать. `RESTRICTED` и исторический `live:poll` оставлены для отдельных тестовых кампаний; обычный запуск их не использует.

## Архитектура, проверка и другой бот

TypeScript/Fastify → проверка webhook secret и lossless MAX ID → общий admission → durable inbox → один worker → диалог/селектор/закладки SQLite → durable outbox → MAX adapter. Source-specific review проверяется в каталоге, карточках, сохранённом и отложенных отправках/редактировании. Один actor ограничен 8 ожидающими входящими событиями, 30 входами/минуту, 16 ожидающими исходящими операциями и 50 закладками. Общий inbox — 1000; обычная отправка — не чаще одной за 1,1 с. Превышение actor-лимита подтверждается как `rate_limited` и не ставится в очередь. Отправка на произвольный ID без сохранённого разрешённого контакта невозможна.

Внешние сервисы: MAX для настоящего бота, пять сайтов учреждений только при ручном refresh, ACME для production TLS. Все npm-версии закреплены lockfile; Docker/Node-образы закреплены digest. HTTP-поверхность ограничена [OpenAPI 3.1](openapi.json): health и authenticated webhook; бизнес-API/фиктивных ролей нет. [DATA-API](DATA-API.yaml) содержит девять групп организатора, неизвестные поля оставлены `null`.

Опциональный native-путь: **Node 22.23.2**, npm из этой версии; для better-sqlite3 при отсутствии подходящего prebuilt нужен штатный C++ toolchain. Команды из корня:

```sh
npm ci
npm run typecheck
npm run build
node dist/scripts/prepare-demo.js
node --env-file=.env.demo dist/src/index.js
```

Во втором терминале: `node --env-file=.env.demo dist/scripts/organizer-check.js`; остановка Ctrl+C. Реальный native polling: `npm run public:poll`. Тесты: `npm test`, `npm run test:data`, `npm run test:flow`, `npm run test:polling`, `npm run test:public`.

Для нового организаторского бота безопасная инициализация делает только `GET /me` и `GET /subscriptions`, не меняет существующие конфиги. После native build задайте переменную `MAX_BOT_TOKEN_FILE=secrets/max_bot_token` в своём shell и выполните `node dist/scripts/identity-init.js .env.organizer`. Возвращаются публичный ID и наличие webhook; токен не выводится. Проверьте identity, используйте созданный файл как `.env.public`. Проверка mismatch остаётся обязательной при каждом live startup.

[Продуктовая презентация PDF](presentation/cultural-plan.pdf) · [предпросмотр с техническим первым листом](presentation/cultural-plan-submission-preview.pdf) · [редактируемые слайды](presentation/slides.json) · [сборка и закрытая версия](presentation/README.md) · [комплект сдачи](docs/SUBMISSION_CHECKLIST.md) · [приватность](docs/PRIVACY.md) · [сторонние компоненты](THIRD_PARTY_NOTICES.md) · [квитанция 21](docs/pivot/21_PUBLIC_ACCESS_CATALOG_AND_HANDOFF.md).

Эффект продукта ещё не измерен. Новые mobile/web наблюдения `DEFERRED_BY_USER / NOT_RUN`; сохранённые исторические наблюдения не превращены в новые PASS. Хостинг и отправка материалов организаторам не выполнялись. Сборка пакета: `python scripts/organizer-package.py --stage .review/organizer-package --zip`; Python 3.12, без дополнительных библиотек. Каталог назначения должен быть новым. Проверяйте `VERSION.json` и `MANIFEST.sha256`; исторические подробности находятся по ссылкам из квитанций.
