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

Из чистой копии:
- Создайте `secrets`; сохраните токен своего бота в `secrets/max_bot_token` (UTF-8, одна строка, без кавычек).
- Выполните команду получения CA из README. Она собирает образ без использования токена.
- Задайте `NODE_EXTRA_CA_CERTS_CONTAINER` в текущем PowerShell и выполните `docker compose -f compose.setup.yaml run --rm setup`.
- Новый `.env.public` создаётся из распределяемого примера. Только `GET /me` и `GET /subscriptions`; пользовательские сообщения и `/updates` на этом шаге не запрашиваются.
- Для уже настроенной копии используйте существующий `.env.public`. При необходимости добавьте строку `NODE_EXTRA_CA_CERTS_CONTAINER=/run/secrets/max-official-root.pem`. Не заменяйте конфигурацию примером.

`compose.setup.yaml` даёт процессу запись в корень выбранной копии только для нового файла конфигурации. Результат проверяет ID токена; при последующих запусках `/me` обязан вернуть этот же ID. При наличии подписки конфиг может быть создан, но polling откажется запускаться. Подписки автоматически не удаляются.

| Хост | Контейнер |
|---|---|
| `secrets/max_bot_token` | `/run/secrets/max_bot_token`, только чтение |
| `secrets/max-official-root.pem` | `/run/secrets/max-official-root.pem`, только чтение |
| Именованный том `public-data` | `/app/runtime`: БД, cursor, каталог, кеш обновления |
| `.env.public` | Compose читает файл и явно задаёт контейнерные пути |

`--env-file` выполняет интерполяцию Compose; `env_file` сервиса и `environment` формируют окружение контейнера. `polling-check.js` вызывает `loadConfig(process.env)` и проверяет сертификат через `tls.getCACertificates('extra')`: файл действительно прочитан Node при старте. Рабочий локальный `compose.ca.override.yaml`, если он уже есть, можно сохранить; путь CA покрыт основным профилем.

## Обычный polling

Команда из README — foreground, без лимита тестовой кампании. Порт identity вычисляется из ID и резервируется на localhost; SQLite дополнительно проверяет принадлежность режиму и боту. Между разными компьютерами единственность потребителя обеспечивает оператор.

`MAX_REQUEST_TIMEOUT_MS=5000` ограничивает обычные запросы; диапазон 100–10000 мс. Значение 45000 недопустимо. `MAX_POLL_TIMEOUT_SECONDS=30` задаёт отдельное ожидание `/updates`; deadline клиента = ожидание × 1000 + 5000 мс. Первое получение cursor использует серверное ожидание 0, сохраняя отдельный polling deadline. Медленный стартовый `/me` не является долгим polling.

`polling_started` подтверждает проверку identity, отсутствие webhook и запуск consumer. `polling_stopped` завершает работу. `SIGINT/SIGTERM` отменяет сетевое ожидание; намеренная остановка не считается timeout. Три последовательные ошибки останавливают consumer. Не запускайте отдельный `/updates` для диагностики работающего бота.

После текста применяется новый POST, затем принятие подтверждённого mid и очистка ровно его предшественника. Callback обычно редактирует текущий экран. Если удаление запрещено, бот пытается снять старую клавиатуру; сервер отвергает устаревшие действия. Неопределённый результат POST не вызывает автоматического повтора или удаления прежнего экрана; восстановление — новый пользовательский ввод, например `/start`. API не предоставляет гарантии exactly-once создания сообщения.

Контракты: [POST messages](https://dev.max.ru/docs-api/methods/POST/messages), [PUT messages](https://dev.max.ru/docs-api/methods/PUT/messages), [DELETE messages](https://dev.max.ru/docs-api/methods/DELETE/messages), [GET updates](https://dev.max.ru/docs-api/methods/GET/updates). PUT/DELETE проверяют `success`, а не только HTTP 200. Общая очередь с интервалом 1,1 с сохраняет методные ограничения; обычная навигация использует `notify: false`.

## Постоянный webhook

Для постоянной службы нужны подготовленные оператором хост, DNS, доверенный HTTPS:443, MAX webhook secret и действующий каталог. [deploy/compose.public.yaml](../deploy/compose.public.yaml) объединяет приложение и Caddy. В `.env.webhook` задаются `PUBLIC_HOST`, `PUBLIC_BASE_URL`, `ACME_EMAIL`, ID/порт бота, `SOURCE_VERSION`, подтверждения области запуска и единственного consumer; секреты — файлы в `secrets`. Подробные поля — в самом профиле и [OpenAPI](../openapi.json).

Рекомендуемая команда после подготовки инфраструктуры:

```powershell
docker compose --env-file .env.webhook -f deploy/compose.public.yaml up --build -d
```

Это запускает службу, но не регистрирует webhook. Регистрация — отдельная согласованная операция по [контракту MAX](https://dev.max.ru/docs-api/methods/POST/subscriptions). В этой поставке hosting/deployment не выполнялись.

## Проверки разработчика и комплект

На Node 22.23.2: `npm ci`, `npm run typecheck`, `npm run build`. Проверки затронутого поведения: `npm run test:flow`, `npm run test:polling`; PUBLIC и конфигурация — соответствующие файлы в `tests`.

`scripts/polling-setup-check.ts` — изолированный симулятор с синтетическим секретом и identity 777. Он запускает фактические `identity-init.js`, `polling-check.js` и `start-polling.js` через явный test preload; production-конфигурация не принимает произвольные API-host. Режим `--initialize` проверяет создание `.env.public` из примера и отказ перезаписи. Обычный режим проверяет ответы на текст/кнопки, ошибку формы, дедупликацию, остановку и cursor после перезапуска. Эти тесты не являются проверкой мобильного или веб-клиента MAX.

Для единого обезличенного комплекта нужен Python 3.12, без сторонних библиотек:

```powershell
python scripts/organizer-package.py --stage .review/organizer-ready-final --zip
```

Каталог должен быть новым. Архив включает текущие инструкции, приложение, примеры и обе PPTX; `VERSION.json`, `MANIFEST.sha256` и SHA-256 архива фиксируют версию. Секреты, runtime/БД, шрифты и заполненный закрытый лист исключены. Фактические команды и результаты текущей проверки — [короткая запись](verification/ORGANIZER_SETUP_AND_EDITABLE_PPTX.md); исторические квитанции сохранены отдельно.
