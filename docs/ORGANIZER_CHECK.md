# Запуск и самопроверка организатора

Порядок запуска находится в [README](../README.md). Здесь — подробности R07/R11 и диагностика. Проверки выполняются автоматически, без действий в клиентах MAX.

## Локальное демо

1. `docker compose up --build -d --wait` собирает приложение и создаёт отдельный именованный том SQLite.
2. `docker compose ps` показывает `healthy`; `docker compose logs --tail 20 app` — запуск без токенов и тел входящих событий.
3. `docker compose exec app node dist/scripts/organizer-check.js` проверяет HTTP webhook, отказ неверному secret, дедупликацию, нового PUBLIC-пользователя, подбор, условия, сохранение и открытие закладки.
4. `docker compose restart`, затем `docker compose exec app node dist/scripts/organizer-check.js --restart` проверяют сохранность созданной закладки.
5. `docker compose down` сохраняет том. `up --build -d --wait` запускает ту же копию снова.

Ожидаются `PASS` и `SIMULATED_MAX`. Данные и identity вымышлены, дата — 05.04.2030. Для занятого порта задайте `DEMO_PORT`, для отдельной копии — уникальные `COMPOSE_PROJECT_NAME` и `CULTURAL_PLAN_IMAGE` до всех команд (пример в README). Не останавливайте чужую копию ради проверки.

## TLS и первая настройка

Официальные основания: [MAX API](https://dev.max.ru/docs-api), [изменение домена и CA](https://dev.max.ru/docs-api/changelog-api), [сертификаты Госуслуг](https://www.gosuslugi.ru/tls). Загрузчик [setup-max-ca.ts](../scripts/setup-max-ca.ts) получает [PEM с официального CDN Госуслуг](https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt) по HTTPS с проверкой TLS, без редиректов и с deadline 20 секунд. Проверяются CA, срок и SHA-256 сертификата:

`D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31`

Это Russian Trusted Root CA, действующий до 27.02.2032 21:04:15 UTC. При изменении официального сертификата загрузчик останавливается; новый отпечаток требует сверки с официальным источником. CA не встроен в образ и не добавляется в Windows. Существующий файл не заменяется.

Для своей установки требуется действующий токен управляемого вами бота; репозиторий его не поставляет. Где получить токен и как безопасно создать файл — [README, первая настройка](../README.md#подключение-к-настоящему-max). Пользователь командного бота и локальное демо обходятся без токена.

Из чистой копии:

- Создайте `secrets`; сохраните токен своего бота в `secrets/max_bot_token` (UTF-8, одна строка, без кавычек и расширения `.txt`).
- Выполните команду получения CA из README. Она собирает образ без использования токена.
- Задайте `NODE_EXTRA_CA_CERTS_CONTAINER` в текущем PowerShell и выполните `docker compose -f compose.setup.yaml run --rm setup`.
- Новый `.env.public` создаётся из поставляемого примера. Только `GET /me` и `GET /subscriptions`; пользовательские сообщения и `/updates` на этом шаге не запрашиваются. Результат содержит `botId`, `username`, `botUrl`, `webhookExists` и `composeProject`.
- Откройте `botUrl` своего бота после `polling_started`. ID, ссылка, порт и `COMPOSE_PROJECT_NAME` относятся к ответу `/me`, а не к боту команды.
- Для уже настроенной копии используйте существующий `.env.public` и прежнее имя проекта. Не заменяйте конфигурацию примером или файлом от другой установки.

`compose.setup.yaml` даёт процессу запись в корень выбранной копии только для нового файла конфигурации. Результат проверяет ID токена; при последующих запусках `/me` обязан вернуть этот же ID. При наличии подписки конфиг может быть создан, но polling откажется запускаться. Подписки автоматически не удаляются.

| Хост | Контейнер |
|---|---|
| `secrets/max_bot_token` | `/run/secrets/max_bot_token`, только чтение |
| `secrets/max-official-root.pem` | `/run/secrets/max-official-root.pem`, только чтение |
| Том `<COMPOSE_PROJECT_NAME>_public-data` | `/app/runtime`: БД, cursor, каталог, кеш обновления своего бота |
| `.env.public` | Compose читает файл и явно задаёт контейнерные пути |

`--env-file` выполняет интерполяцию Compose; `env_file` сервиса и `environment` формируют окружение контейнера. Профиль передаёт `NODE_EXTRA_CA_CERTS` до запуска Node. `polling-check.js` проверяет настоящим загрузчиком путь токена, ID/порт, режим и CA, уже загруженный Node. Он не обращается к MAX и не выводит токен.

При `identity_init_failed` читайте безопасное поле `reason`: отсутствие файла (`INSPECTION_TOKEN_FILE`), пустой файл (`INSPECTION_TOKEN_EMPTY`) и пример вместо токена (`INSPECTION_TOKEN_INVALID`) отклоняются до сетевого запроса. `AUTH` означает отказ авторизации или несовпадение закреплённого ID. Проверьте токен выбранного бота в кабинете владельца; ID-проверку отключать не нужно. Инициализатор отказывается заменять существующий `.env.public`.

## Обычный polling

Команда из README — foreground, без лимита тестовой кампании. Порт identity вычисляется из ID и резервируется на localhost; SQLite дополнительно проверяет принадлежность режиму и боту. Между разными компьютерами единственность потребителя обеспечивает оператор.

`MAX_REQUEST_TIMEOUT_MS=5000` ограничивает обычные запросы; диапазон 100–10000 мс. `MAX_POLL_TIMEOUT_SECONDS=30` задаёт отдельное ожидание `/updates`; deadline клиента — 35000 мс. Стартовые проверки `/me` и `/subscriptions` используют обычный лимит.

`polling_started` подтверждает проверку identity, отсутствие webhook и запуск consumer. `polling_stopped` завершает работу. `SIGINT/SIGTERM` отменяет сетевое ожидание; намеренная остановка не считается timeout. Три последовательные ошибки останавливают consumer. Не запускайте отдельный `/updates` для диагностики работающего бота.

После текста ответ появляется новым сообщением; кнопка обычно обновляет текущий экран. Если MAX не разрешает удалить старый экран, бот снимает его клавиатуру, где это возможно, и отклоняет устаревшие действия. После неопределённого результата отправки можно продолжить новым вводом, например `/start`.

Контракты: [GET me](https://dev.max.ru/docs-api/methods/GET/me), [GET subscriptions](https://dev.max.ru/docs-api/methods/GET/subscriptions), [POST messages](https://dev.max.ru/docs-api/methods/POST/messages), [PUT messages](https://dev.max.ru/docs-api/methods/PUT/messages), [DELETE messages](https://dev.max.ru/docs-api/methods/DELETE/messages), [GET updates](https://dev.max.ru/docs-api/methods/GET/updates).

## Постоянный webhook

Для постоянной службы нужны подготовленные оператором хост, DNS, доверенный HTTPS:443, MAX webhook secret и действующий каталог. [deploy/compose.public.yaml](../deploy/compose.public.yaml) объединяет приложение и Caddy. Создайте новый `.env.webhook` по [шаблону](../.env.live.example): задайте `PUBLIC_HOST`, `PUBLIC_BASE_URL`, `ACME_EMAIL`, `SOURCE_VERSION` и подтверждения области запуска; перенесите ID, порт и имя проекта из инициализации своего бота. Секреты — файлы в `secrets`. Polling этой identity должен быть остановлен. Подробные поля — в профиле и [OpenAPI](../openapi.json).

Рекомендуемая команда после подготовки инфраструктуры:

```powershell
docker compose --env-file .env.webhook -f deploy/compose.public.yaml up --build -d
```

Это запускает службу, но не регистрирует webhook. Регистрация — отдельная согласованная операция по [контракту MAX](https://dev.max.ru/docs-api/methods/POST/subscriptions). В этой поставке hosting/deployment не выполнялись.

## Состав полученного комплекта

В архиве `VERSION.json` фиксирует commit, `MANIFEST.sha256` — контрольные суммы файлов; SHA-256 архива находится рядом с ним. Комплект содержит исходники, примеры, инструкции и презентации. Токен, рабочие базы и заполненные закрытые материалы передаются отдельно уполномоченным получателям. [Состав сдачи](SUBMISSION_CHECKLIST.md).
