# G1: техническая реализация и свидетельства

Дата начала: **2026-09-22**. Текущая авторизация пользователя: только технический G1 для оценки «Игра состоится». Продукт, принятие риска спроса и G2 не одобрены. Историческая квитанция 04 сохраняется без изменения наблюдений G0.1.

**MAXBOT_G1_TECHNICAL_PARTIAL.** Независимый локальный технический объём реализован и проверен. Итоговая чистая Docker-сборка — **23,719 с**, 50 автоматических тестов проходят. Реальные mobile/web, организаторский бот/условия и согласованный public endpoint не предоставлены; технический PASS не объявляется.

## Первые наблюдения

- Проверенный корень: `C:/Users/BastaPC/Desktop/MaxBotHack`; существующий `.git`, unborn `master`, пустой index, без HEAD/upstream. Пользовательские файлы сохранены.
- `git remote add` в обычном пользовательском контексте сначала завершился exit 128 (dubious ownership). Повтор с единственным командным `safe.directory` для этого корня завершился exit 0. Origin: `https://github.com/AiratBastanov/HackMaxBot2026.git`. Отдельного таймера ранней неуспешной попытки не сохранялось; итоговые измеренные Git-операции приведены ниже.
- `git ... ls-remote --symref origin`: exit 0, 2,115 с, **все refs пусты**, а не ошибка доступа и не tags-only. `git ... fetch --no-tags origin`: выполнен успешно. На пустом remote нет README/AGENTS/ignore и реализации для сверки; remote HEAD/default branch не объявлены. Ahead/behind = NOT_APPLICABLE.
- Docker в sandbox: отказ доступа к config/named pipe. В разрешённом обычном контексте: exit 0, 0,183 с; Docker Desktop 4.90.0, Engine/CLI 29.7.2, Linux amd64, kernel `6.6.87.2-microsoft-standard-WSL2`. Это отдельные результаты, daemon доступен.
- Системный Node 22.20.0/npm 10.9.3 — только наблюдение, не выбор версии. Официальный `https://nodejs.org/dist/index.json` дал актуальный Node 22 **22.23.2**, security release от 2026-07-28.
- Предварительно загружен `node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9`. Это НЕ измеренная сборка приложения.

## Границы

Нет Event, Enrollment, мест, очереди, платежей, AI, mini-app или UI-фреймворка. Не выполняются stage/commit/push/публикация. Реальный запуск потребует подтверждённого организаторского бота, прав на сообщения, согласованного существующего HTTPS-host и согласившихся тестировщиков. Секреты не передаются в чат.

`REAL_APPLICATION_SMOKE = REQUIRED`; mobile/web пока `NOT_VERIFIED`.

## Источники текущих контрактов

Прочитаны 2026-09-22: [API](https://dev.max.ru/docs-api), [changelog](https://dev.max.ru/docs-api/changelog-api), [Update](https://dev.max.ru/docs-api/objects/Update), [Message](https://dev.max.ru/docs-api/objects/Message), [GET me](https://dev.max.ru/docs-api/methods/GET/me), [GET subscriptions](https://dev.max.ru/docs-api/methods/GET/subscriptions), [POST subscriptions](https://dev.max.ru/docs-api/methods/POST/subscriptions), [POST messages](https://dev.max.ru/docs-api/methods/POST/messages), [POST answers](https://dev.max.ru/docs-api/methods/POST/answers). Вложенные поля сверены с [официальной OpenAPI MAX](https://github.com/max-messenger/api-schema/blob/main/schema.yaml), на которую ссылается обзор API. Это схема MAX, не шаблон evaluator DATA-API.yaml.

TXT M-01–M-03 в рабочем дереве отсутствуют; прочитаны официальные ссылки из 00. Применены целевые чтения, завершение независимого разрешённого объёма и соразмерные проверки. Промпты не копируются, настройки модели не меняются.

## Реализованный объём

| Часть | Реализация и граница свидетельства |
|---|---|
| Один сервер | TypeScript/Node/Fastify, `POST /webhooks/max`, `GET /healthz`; тот же процесс и образ для local/live. Реальные интерфейсы описаны в `openapi.json` 3.1; JSON и 27 локальных `$ref` проверены. Это не проверка evaluator-схемы |
| Конфигурация | Обязательный режим, типы/диапазоны, allowlist до 20 тестировщиков, `_FILE` для секретов. Live требует token, ожидаемый bot ID, HTTPS origin и подтверждённую область. Local отклоняет live token и не содержит сетевого MAX-транспорта |
| Приём | Secret до parsing, 64 KiB, проверка структуры/подтипа. Lossless parsing настоящего HTTP тела сохраняет int64; обычный JSON number не используется как промежуточный ID. Из callback payload личность не извлекается |
| Durable acceptance | SQLite WAL, synchronous FULL, транзакция inbox до HTTP 200; duplicate не создаёт второй эффект. Реальные запрет/блокировка записи дают 503, не ложное подтверждение. Корректные нерелевантные типы и неразрешённые тестировщики получают ignored |
| Дедупликация | Callback — `callback_id`; сообщение — `body.mid`; lifecycle — документированные type/actor/chat/timestamp, для start также payload. У lifecycle нет приписанной платформе гарантии уникального update ID или глобального порядка |
| Обработка | До 20 inbox/итерацию, до 3 попыток обработки, одна исходящая операция/итерацию, пауза 1,1 с. Сетевые вызовы вне SQLite-транзакций. Перезапуск сохраняет состояние; прерванное SENDING становится UNKNOWN_RESULT |
| MAX adapter | Фиксированный `https://platform-api2.max.ru`, Authorization header, TLS, redirect:error. /me проверяет ожидаемого бота; /messages проверяет Message и recipient; /answers и POST /subscriptions требуют boolean success:true; GET /subscriptions имеет отдельную схему |
| Ошибки | SEMANTIC, MALFORMED, AUTH, PERMISSION, RATE_LIMIT, SERVER, HTTP, TIMEOUT_AMBIGUOUS, TRANSPORT_AMBIGUOUS различимы. Deadline 5 с по умолчанию охватывает тело ответа ≤256 KiB. Только 429 повторяется до 3 раз с Retry-After и общим expiry ≤60 с; неоднозначный POST не повторяется автоматически. 401 сохраняет блокировку до оператора |
| Probe | Маркированный «Технический тест G1»: start=g1 или /probe → actor-bound кнопка → callback notification и отдельный вопрос → «готово» через `Message.link` именно к question mid. TTL 600 с, настраивается 60–900 с. Чужая/повторная/истёкшая команда отвергается; отсутствие reply-контекста даёт инструкцию |
| Связь | Распознаны bot_started/stopped и dialog_removed/cleared/muted/unmuted. Проверены синтетические перестановки/равные timestamps; участие не моделируется и из доступности связи не выводится |
| Минимизация | Хранятся нормализованные нужные поля/признаки, без имён, raw event и произвольного текста. Обработанные payload очищаются через 24 ч; технические записи/контакты — через 7 дней; probe — сутки после expiry. Это техническая политика G1, не утверждённая политика продукта |
| Эксплуатация | Graceful SIGTERM/SIGINT, постоянный том, non-root UID 1000, read-only root filesystem, HTTP на loopback. /healthz проверяет доступность SQLite, но не гарантирует свободный диск, отправку MAX или просмотр человеком |

Webhook HTTP-ack, сохранённый processing result, MAX request result и human observation — четыре разных свидетельства. В local исходящие имеют статус **SIMULATED**, а не «MAX доставил». Реальный API-успех может дать **ACKNOWLEDGED**, но не доказывает чтение. Exactly-once, callback TTL и recipient-specific коды не заявлены.

Автоподписки при запуске нет. `scripts/live-admin.ts` отдельно проверяет /me и текущие subscriptions, запрещает автоматическую замену любой существующей подписки и требует подтверждения единственного consumer перед созданием новой. Эти live-команды **не выполнялись**. Polling отсутствует.

## Версии и происхождение

| Компонент | Зафиксированная версия / факт |
|---|---|
| Node.js | 22.23.2, ветка 22; host portable и Docker совпадают |
| npm | Host 10.9.3; контейнер 10.9.8 |
| TypeScript | 7.0.2 |
| Fastify | 5.12.5 |
| better-sqlite3 / SQLite | 13.0.3 / фактически 3.53.4 на host и в контейнере |
| lossless-json / zod | 4.3.1 / 4.6.5 |
| @types/node / @types/better-sqlite3 | 22.20.4 / 9.6.0 |
| Lockfile | npm lockfile v3; 77 locked packages с платформенными optional dependencies; Windows ci установил 58 |
| Docker | Desktop 4.90.0 (238679), Engine/CLI 29.7.2, Compose 5.5.1, Linux amd64 |
| Caddy | 2.11.4; конфигурация проверена offline, публичного запуска не было |

Версии зависимостей сверены с опубликованными метаданными [npm registry](https://registry.npmjs.org/); транзитивные версии и integrity сохранены в `package-lock.json`. [Инвентаризация](evidence/g1/dependencies.json) содержит MIT/Apache-2.0/BSD-3-Clause/ISC, неизвестных лицензий нет. `npm audit --json` дал 0 известных advisories на момент проверки; это не гарантия отсутствия уязвимостей. Лицензионные материалы описаны в [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md).

Portable Windows x64 Node получен из [официального dist v22.23.2](https://nodejs.org/dist/v22.23.2/), проверен по официальному SHASUMS256.txt: `node.exe` SHA-256 `0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4`. Находится только в исключённой `.tools/node-v22.23.2/`. Системный Node, compiler tools, execution policy и global configuration не менялись.

Образы закреплены тегом и digest:

```text
node:22.23.2-bookworm@sha256:dd5847a04b0deee391fa145f1f4c6d214196668b6bcc7988ebed67249f226844
node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9
caddy:2.11.4-alpine@sha256:de23def33b17fb5d1290b0f6c2add1d70780e52341896c00a4c8a2a2fe9d355e
```

Официальная MAX schema.yaml, использованная для разрешения вложенных полей и `CallbackAnswer.notification`, имела SHA-256 `7e2fd072a67c6f830a02a55671eec88526f6a958b0c71ea4be96acecc3dd700b`. Webhook реализован как один Update; envelope Long Polling и примеры с устаревшим доменом/token-in-query не перенесены. Дополнительный CA не установлен: его проверка и application-scoped подключение при необходимости входят в live-подготовку.

M-01–M-03: [Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide), [Model guidance](https://developers.openai.com/api/docs/guides/latest-model), [Rethinking skills and prompts](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra). Применён локальный skill `openai-docs`; он не использовался как основание для остановки разрешённой реализации или изменения конфигурации Codex.

## Команды, длительность и тесты

Полный журнал **39 измеренных запусков**, включая промежуточные ошибки: [checks.jsonl](evidence/g1/checks.jsonl). Каждая строка содержит точный argv, UTC начала, elapsedSeconds, exitCode, signal, timedOut и путь sanitized log. Ограничитель — `scripts/check.mjs`; секреты через аргументы не передавались. Ни один измеренный запуск не исчерпал свой бюджет. Простые чтения и первоначальные наблюдения, не прошедшие через ограничитель, не выдаются за измерения этого журнала.

В таблице `node22` — `.\.tools\node-v22.23.2\node.exe`; `npm-cli` — `D:/nodejs/node_modules/npm/bin/npm-cli.js`. Это путь существующего npm, а не установка глобального инструмента. `docker` — `C:/Program Files/Docker/Docker/resources/bin/docker.exe` в разрешённом контексте обычного пользователя.

| Проверка / команда | Exit | Секунды | Результат |
|---|---:|---:|---|
| `node22 npm-cli ci --ignore-scripts --no-audit --no-fund` | 0 | 1,859 | Воспроизводимая Windows-установка из lockfile, опубликованные prebuilt |
| `node22 node_modules/typescript/bin/tsc --noEmit` | 0 | 0,321 | Typecheck |
| `node22 node_modules/typescript/bin/tsc` | 0 | 0,315 | Build |
| `node22 --test --test-timeout=20000 dist/tests/config.test.js dist/tests/contracts.test.js dist/tests/integration.test.js` | 0 | 2,583 | **50/50**, fail/skipped/todo = 0 |
| `node22 npm-cli audit --json` | 0 | 1,382 | 0 известных advisories |
| `git … ls-remote --symref origin` | 0 | 2,085 | Все remote refs пусты |
| `git … fetch --no-tags origin` | 0 | 2,119 | Доступ и запись fetch metadata работают |
| `docker build --no-cache --progress=plain --target runtime --build-arg SOURCE_VERSION=281850c0be6cdd8dc9c4e1f88fbc7f702483798ecfd191d95277f590553d160a -t maxbot-g1:local .` | 0 | **23,719** | Итоговая чистая сборка, npm ci + typecheck/build + **50/50** тестов внутри |
| `docker compose up --build -d --wait --wait-timeout 30` | 0 | 7,472 | Проверка обычного запуска одной командой |
| `curl.exe --fail --silent --show-error --max-time 5 http://127.0.0.1:3000/healthz` | 0 | 0,035 | HTTP 200 с Windows loopback |
| `docker compose exec -T app node dist/scripts/runtime-info.js` | 0 | 0,292 | UID 1000, Node 22.23.2, SQLite 3.53.4, local |
| `docker compose exec -T app node dist/scripts/local-smoke.js` | 0 | 4,937 | 6 проверок HTTP/probe, realMax:false |
| `docker compose restart app` | 0 | 0,763 | Restart без удаления тома |
| `docker compose exec -T app node dist/scripts/local-smoke.js --verify-restart` | 0 | 0,315 | Сохранённое завершённое состояние найдено |
| `docker … caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` | 0 | 0,597 | Offline, network:none, example.invalid; конфигурация валидна |
| `node22 .tmp/hygiene.mjs` | 0 | 1,145 | Git/Docker exclusions и exact-secret scan; failures:[] |

Разбивка 50 тестов: **12 конфигурации + 17 parsing/контрактов + 21 integration с настоящей SQLite**. Полные названия и TAP: [tests-final-host.log](evidence/g1/tests-final-host.log). Покрыты фактический HTTP int64 boundary, границы int64/небезопасный JSON, webhook authentication/size/structure, durable commit и повтор после restart, write lock/query_only → 503, полный synthetic probe, чужой actor, expiry и повтор кнопки, неверный reply, шесть lifecycle типов и перестановки, отсутствие сети в транзакции, 200/success:false, malformed Message/не тот recipient, 401/403/429/5xx, bounded retry, зависшее HTTP body и неоднозначный timeout, crash в SENDING, защита от смены local/live/bot для существующей DB.

Smoke использовал **тот же контейнер и сервер**, реальные HTTP и SQLite: health, durable_acceptance, duplicate, callback, question, linked_reply. Это шесть smoke assertions дополнительно к 50 тестам, а не шесть реальных MAX-проверок. Integration также проверяет restart незавершённого вопроса; внешний smoke после restart проверяет сохранение завершённого probe.

T01–T24 — сценарии будущего продукта. Ни одна группа не объявлена завершённой только на основании узких G1 проверок; полный T14 остаётся NOT_RUN/NOT_VERIFIED.

### Исправленные промежуточные ошибки

- Первый typecheck (exit 1, 0,314 с): `unknown` в Fastify error handler; добавлено безопасное сужение типа.
- Первая integration (exit 1, 2,524 с): 20/21; constructor Storage при отказе identity оставлял открытый handle, cleanup Windows получал EBUSY. Закрытие при неуспехе исправлено; affected integration — 21/21, итоговый набор — 50/50.
- Первая попытка `npm ci` ошибочно пересеклась с SQLite-тестом: native DLL lock/EPERM, exit 4294963248, 0,838 с. Последовательная обычная попытка (exit 1, 2,802 с) дошла до node-gyp/global cache permission; глобальная среда не исправлялась. Проектная Windows установка `--ignore-scripts` использует включённые в опубликованный пакет prebuilt и прошла, как и нормальный `npm ci` в Linux build.
- Изначальная Compose-сеть `internal:true` не публиковала порт через этот Docker Desktop: внутри контейнера health/smoke проходили, Windows получал connection refused. Использована обычная bridge-сеть; контейнер/сеть пересозданы scoped `compose down` **без удаления volume**. Итоговый host loopback 200 проверен. Запрет MAX в local обеспечен кодом/конфигурацией, а не заявлением о сетевой изоляции контейнера.
- Две диагностические inline-команды Docker имели ошибочное PowerShell quoting (exit 1/64). Проверки перенесены в файл/простую format-строку; runtime/image inspect завершены успешно. Первый hygiene-check ошибочно считал `runtime-info.ts` приватным путём; границы сегментов regex исправлены, final failures:[].

Ранние логи сохранены для проверки происхождения результата. BuildKit предупреждает об отсутствии Git commit metadata — это ожидаемо при unborn HEAD; версия явно закреплена manifest/label. Caddy сообщает только замечание форматирования, validation exit 0. Неразрешённых падений реализованных локальных проверок нет.

## Docker: методика и среда

Машина: Windows 11 `10.0.26100`, x64, AMD Ryzen 7 5700X3D, 16 logical CPU, 32 GiB RAM; [host-environment.json](evidence/g1/host-environment.json). Docker Linux kernel `6.6.87.2-microsoft-standard-WSL2`, 16 CPU, RAM `16727072768` bytes; [docker-environment.log](evidence/g1/docker-environment.log). Использовано доступное сетевое соединение машины с npm/Docker registry; пропускная способность отдельно не измерялась.

Все три закреплённых базовых образа предварительно получены отдельными `docker pull <точный image reference выше>`. Начальная загрузка базовых образов исключена из времени приложения. Итоговый запуск использовал `--no-cache`, без cache mounts и без повторного использования слоёв установки зависимостей/приложения. В [docker-build-final.log](evidence/g1/docker-build-final.log) есть новый `npm ci` (~12,43 с), typecheck/build и оба набора тестов. Метаданные `WORKDIR`/базовые слои не являются переиспользованием установки приложения. Чужие кеши, images и volumes не удалялись.

Лимит **300 секунд** применён к процессу сборки целиком; результат **23,719 секунды, PASS**. Первая чистая сборка предыдущего состояния (24,810 с) сохранена отдельно и не подменяет итоговую. Последующий `compose up --build` проверяет обычный startup с кешем и не используется как измерение чистой сборки.

Manifest list измеренного образа: `sha256:bbfbcbcefece30f7c24b0c674b274b3539f7ee262dd449fded3335f4e2c29f2e`. Повторная Compose-сборка того же source добавляет свои image metadata; фактический image ID работающего контейнера: `sha256:0b516655771b8751ff75d1567b8498c316f69a435a5153d3d82c833ad7c6decb`. Оба относятся к source manifest ниже; финальный revision label подтверждён [inspect](evidence/g1/docker-final-state-fixed.log).

Для локального review оставлен `maxbot-g1-local-app-1`: healthy, USER=node, readonly=true, только `127.0.0.1:3000`, постоянный `maxbot-g1-local_probe-data`. Остановка без потери состояния: `docker compose stop`; обычное возобновление: `docker compose up -d`. Public Compose/Caddy подготовлены, но не развёрнуты. Наличие рабочей локальной контейнеризации не доказывает публичный TLS или MAX ingress.

## Git, версия исходников и инвентаризация

[git-state.json](evidence/g1/git-state.json): root проверен; origin равен авторитетному HTTPS URL; remote access/fetch **PASS**; remote HEAD/branches/tags/прочие refs **отсутствуют**. Локально `master` unborn, HEAD отсутствует (ожидаемый exit 128), upstream отсутствует (ожидаемый exit 128), index пуст. Ahead/behind **NOT_APPLICABLE**. Состояние файлов — untracked, включая исходно существовавшие документы, а не staged additions.

Единственное разрешённое изменение настройки — добавление отсутствующего origin; затем fetch --no-tags. Применялся только command-scoped `safe.directory` для проверенного корня. Для read-only status/ignore был command-scoped `core.excludesFile=.gitignore` из-за недоступного пользовательского global ignore; глобальные Git settings/credential helpers не менялись. ACL/ownership, parent repository, история remote не затронуты. В разрешённом normal-user контексте Git с TLS работал; исторический Schannel SEC_E_NO_CREDENTIALS не используется как вывод об аутентификации GitHub. Git handoff сейчас не нужен.

Commit не создавался. Рассмотренный source — **40 файлов** в [source.sha256](evidence/g1/source.sha256), SHA-256 самого manifest:

```text
281850c0be6cdd8dc9c4e1f88fbc7f702483798ecfd191d95277f590553d160a
```

Это hash списка individual SHA-256, а не Git revision. Manifest включает код, тесты, scripts, lock/configuration, README, актуальные планы и AGENTS. Квитанция 05 и evidence исключены для устранения рекурсивного hash; историческая 04 отдельно сохранена с SHA-256 `d1145aa9ab83d255407119fe4518cff77569947a44b81eb9cce5e4dbbc7e7b7b`. Секреты, DB/sidecars, private/raw evidence, исходный PDF, portable runtime, node_modules и dist не входят.

Полный список путей с разделением относительно исходного workspace: [inventory.json](evidence/g1/inventory.json).

| Категория | Изменения |
|---|---|
| 6 существовавших файлов | `.gitignore`, `README.md`, документы `00`, `01`, `02`, `03`; актуальная авторизация/границы/свидетельства и две pending-рекомендации |
| 8 source | `src/config.ts`, `contracts.ts`, `max.ts`, `storage.ts`, `probe.ts`, `worker.ts`, `app.ts`, `index.ts` |
| 4 tests/fixtures | `tests/config.test.ts`, `contracts.test.ts`, `integration.test.ts`, `fixtures.ts` |
| 7 scripts | check, dependency-inventory, live-admin, local-smoke, prepare-local, runtime-info, source-manifest |
| 14 остальных новых source/config/docs | Dockerfile, compose, .dockerignore, .env.example, .npmrc, .node-version, package/lock/tsconfig, deploy/Caddyfile, deploy/compose.public.yaml, openapi.json, THIRD_PARTY_NOTICES, G1_LIVE_RUNBOOK |
| Квитанция и evidence | Этот новый файл 05; journal/logs, версии/лицензии, Git/hygiene, manifest и inventory в `docs/evidence/g1/` |
| Сохранены | AGENTS.md, историческая квитанция 04, пользовательский исходный PDF; исходные наблюдения G0/G0.1 не переписаны |
| Generated/ignored | `.env.local` только для синтетики, `.tools`, `.tmp`, `node_modules`, `dist`, runtime/SQLite и проектный Docker volume |

Гигиена: [hygiene.json](evidence/g1/hygiene.json) — 22 запрещённых для Git примера исключаются, 9 безопасных source/example/evidence примеров сохраняются. Фактический экспорт Docker context содержит только 24 нужных build input; живых secrets, DB/sidecars, backups, private/raw events, temporary/dependency/build directories в нём нет. Exact scan сгенерированного локального secret в 85 source/evidence файлах и Docker context утечек не обнаружил. Проверка не называется универсальным поиском любых возможных секретов. Runtime `/app` содержит только dist, node_modules, package.json и volume runtime.

Финальная сверка артефактов: `node22 .tmp/final-review.mjs`, exit 0, команда 0,102 с (не повторный запуск тестовых suites). [artifact-review.json](evidence/g1/artifact-review.json) подтверждает совпадение всех 40 source hashes, 39 записей журнала, 14 необходимых успешных проверок, TAP 50/50 на host и 29+21 в Docker, 46 существующих локальных ссылок на момент проверки и отсутствие локального secret в 87 проверенных source/evidence файлах. Ошибок нет; receipt/evidence после этого дополняются вне source manifest.

## Раздельные итоги и внешние предпосылки

| Область | Статус | Что подтверждено / чего нет |
|---|---|---|
| Git | PASS отдельно от G1 | Правильный origin, доступ/fetch, пустой remote; local HEAD/upstream отсутствуют |
| Local foundation | PASS в реализованной границе | Install/typecheck/build, 50 автоматических тестов, реальный HTTP/SQLite, smoke/restart |
| Docker | PASS в локальной среде | Чистая сборка 23,719 с, запуск/loopback/non-root/volume/restart |
| Public deployment/TLS | NOT_VERIFIED / BLOCKED_BY_PREREQUISITES | Нет согласованного существующего host/domain/оператора; Caddy проверен только offline |
| Live MAX | NOT_VERIFIED / BLOCKED_BY_PREREQUISITES | Нет подтверждённого организаторского бота/области условий, securely supplied credentials и live endpoint. /me, subscription, реальные сообщения не вызывались |
| Mobile MAX | NOT_VERIFIED | Deep link/repeat, callback, естественный reply, lifecycle и restart не наблюдались |
| Web MAX | NOT_VERIFIED | Те же реальные сценарии не наблюдались |
| Research/product | EVIDENCE_MISSING / PENDING_USER_DECISION | Получено 0 интервью/наблюдений спроса; контактов с людьми не было. Краткий протокол подготовлен в 01; цели исследования не превращены в admission requirements |

`REAL_APPLICATION_SMOKE = REQUIRED`. Точные действия, ограничения сеанса 15 минут и таблица expected/actual для обоих клиентов: [G1_LIVE_RUNBOOK.md](G1_LIVE_RUNBOOK.md). Входящие реальные события проверяются отдельно от успешного POST /subscriptions. Synthetic lifecycle не выдаётся за поведение клиентов. Весь технический G1 пока не принят, несмотря на готовый локальный код.

## Две рекомендации, ожидающие решения

1. **Delivery recovery — PROPOSED_PENDING_USER_APPROVAL, только G3.** В 02.5.3 сравнена текущая ручная зависимость с одним ограниченным автоматическим вариантом. Рекомендация: временный transport/5xx/429 — максимум три контрольные попытки через 15/30/60 с в пределах 120 с; /me и максимум одно маркированное сообщение заранее согласившемуся тестовому получателю. 401/403/config/TLS/semantic, исчерпание бюджета или неоднозначная контрольная отправка требуют оператора. Waiting list не служит контрольной целью, порядок/позиции не расходуются, истёкшие offers/commands не оживают. Основание — проверенные контрактные классы и локальные negative tests; реальная надёжность и обратный webhook остаются непроверенными. Плановые T07/T17/T18/T24 остаются будущими; queue recovery не реализован.
2. **Старый snapshot — PROPOSED_PENDING_USER_APPROVAL, только G4.** В 02.6.1 и T11/T22 добавлена последовательность backup → accept/withdraw → утрата DB → restore. Согласованный snapshot не содержит более поздних изменений. Предложены RPO ≤15 мин и RTO ≤60 мин при операторе; это цели, не измеренные гарантии. Восстановленные активные встречи блокируются до явной сверки, старые commands/outbox недействительны, удаления и сроки применяются до раскрытия/отправки. Реестр удалений не реконструирует утраченное участие; превышение границ требует отдельного решения. Backup/restore механизм не реализован.

Исследование, принятие риска спроса и утверждение продукта остаются решением пользователя. Все шесть этапов и существующие requirement/test IDs сохранены. Эти предложения не разрешают G3/G4 и не меняют продуктовую политику автоматически.

## ACTION REQUIRED FROM USER

1. Указать несекретные сведения об уже выданном **организаторском боте этого проекта**, применимых условиях технических ответов и ответственном. Рабочий token/webhook secret разместить только в защищённых файлах на согласованном host по runbook, **не в чате**. Это блокирует /me и любые live MAX-вызовы; повторные разрешения при уже достаточных условиях не нужны.
2. Указать **существующий согласованный HTTPS-host/domain и оператора**, подтвердить владение designated endpoint/отсутствие второго consumer. Это блокирует deployment и регистрацию test webhook. Не создавать платный host или внешний аккаунт ради обхода этого пробела. При обнаружении существующей подписки сначала требуется конкретное решение о ней; автоматическая замена запрещена.
3. Организовать согласившихся тестировщиков A/B с **реальными mobile и web MAX**, выполнить G1-M01–G1-M09 по runbook и вернуть обезличенные expected/actual, версии клиентов и безопасные свидетельства. Это блокирует REAL_APPLICATION_SMOKE и технический PASS; token/raw personal data не присылать.

Независимая разрешённая работа завершена. Новых ресурсов/аккаунтов, публичного deployment, real сообщений, изменений trust store/TLS/ACL/UAC не было. Stage/commit/push/PR/release не выполнялись. **G2: NOT STARTED. Продукт и риск спроса не приняты.**

**COMMIT/PUSH: NOT PERFORMED.**

**STOP: AWAITING G1 REVIEW AND EXPLICIT G2/PRODUCT APPROVAL.**
