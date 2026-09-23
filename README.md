# MAX: техническая основа G1 и продуктовый pivot

**2026-09-23. «Игра состоится» — REJECTED_BY_USER / SUPERSEDED.** Встречи, набор участников, вместимость и очередь больше не являются активной спецификацией.

Рекомендация — **«Культурный план»**, бот для взрослого жителя, выбирающего одно опубликованное культурное событие или посещение выставки по времени, бюджету и зоне. Предлагаемый пилот — Казань, музеи Кремля и Национальная библиотека РТ. Бот должен объяснять условия и сохранять личную закладку; фактическая регистрация или покупка — на внешнем сайте. **Продукт, город и объём: PENDING_USER_APPROVAL. Реализация замены: NOT_STARTED.**

Активные документы:

- [Продуктовое решение и три альтернативы](docs/pivot/01_PRODUCT_DECISION.md).
- [Доступность данных: источники, 15 реальных записей и ограничения](docs/pivot/02_DATA_FEASIBILITY.md).
- [Использование основы, план, оценки и покрытие требований](docs/pivot/03_IMPLEMENTATION_PLAN.md).
- [Culture.ru: открытый набор, фактический доступ и решение об источнике](docs/pivot/04_CULTURE_SOURCE_REVIEW.md).
- [Черновики запросов о доступе, не отправлены](docs/pivot/05_DATA_ACCESS_REQUESTS.md).

Уточнение источника 23.09.2026: приоритет — официальный открытый набор Минкультуры через документированный API с выданным ключом либо малый экспорт владельца. Условия повторного использования подтверждены; актуальная выборка Казани ещё не получена. Подготовленные сведения двух учреждений остаются временным demo fallback. Расширение пилота новыми площадками пока не подтверждено и не утверждено. [Исследовательские инструменты](research/culture/README.md) отделены от приложения; 10 synthetic tests проходят.

Репозиторий проекта: [AiratBastanov/HackMaxBot2026](https://github.com/AiratBastanov/HackMaxBot2026). Этот checkpoint сохраняет техническую основу и исследование; это не готовый культурный сервис и не финальная сдача.

## Что работает сейчас

Реализован только технический probe G1: TypeScript/Fastify, `POST /webhooks/max`, `GET /healthz`, SQLite inbox/outbox, worker, отдельные local/live транспорты MAX, проверка конфигурации/секретов и Docker. Есть сохранение int64 как строк, дедупликация, actor-bound callback, exact reply к вопросу, сроки и подавление недоступной связи. При неоднозначном результате отправки нет слепого повторения POST.

Probe проходит путь `?start=g1` или `/probe` → кнопка → вопрос → штатный «Ответить» на вопрос с текстом «готово». Устаревшие/чужие команды отвергаются. Тексты и схемы probe сохранены, включая прежние упоминания встреч; они не являются сценарием нового продукта. Принимаются только `PROBE_TESTER_IDS`; культурный подбор, сохранённые события, адаптеры афиш и напоминания отсутствуют.

**MAXBOT_G1_TECHNICAL_PARTIAL.** Исторические локальный HTTP/SQLite, restart и Docker описаны в неизменённой [квитанции G1](docs/05_G1_TECHNICAL_RECEIPT.md). 23.09.2026 повторно прошли typecheck/build и **50/50** существующих unit/contract/integration tests. Это проверка основы на синтетике; новый домен и реальные MAX-клиенты ею не проверены. Готовый outbox не является планировщиком напоминаний: текущий срок задания ограничен 60 секундами.

## Локальный запуск технического probe

Нужны существующий Docker с Linux daemon/Compose, Node.js для подготовки окружения и свободный `127.0.0.1:3000`. В корне проекта:

```powershell
node scripts/prepare-local.mjs
docker compose up --build -d
```

Первая команда создаёт `.env.local` со случайным локальным secret и синтетическими ID, не перезаписывая существующий файл. Вторая запускает все локальные компоненты. Приложение работает как UID 1000 с read-only root filesystem; SQLite — на постоянном томе `maxbot-g1-local_probe-data`. Local-транспорт не вызывает MAX и отклоняет live token.

```powershell
curl.exe --fail --max-time 5 http://127.0.0.1:3000/healthz
docker compose exec -T app node dist/scripts/local-smoke.js
docker compose restart app
docker compose exec -T app node dist/scripts/local-smoke.js --verify-restart
docker compose stop
```

Ожидаются `status:ok`, `mode:local`, два smoke PASS и `realMax:false`. Повторный `docker compose up -d` сохраняет том. `down -v` для проверки restart не нужен. Эти команды — инструкция, повторный Docker benchmark в задаче pivot не выполнялся.

## Проверки без Docker

Закреплены Node **22.23.2**, TypeScript **7.0.2**, Fastify **5.12.5**, better-sqlite3 **13.0.3**, lossless-json **4.3.1**, zod **4.6.5**; полный граф — `package-lock.json`. На Windows используйте `npm.cmd`, не меняя execution policy.

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
npm.cmd run prepare:local
npm.cmd start
```

В другой консоли: `npm.cmd run smoke`; после restart — `node --env-file=.env.local dist/scripts/local-smoke.js --verify-restart`. Остановка — Ctrl+C. Host-БД `runtime/probe.sqlite` отделена от Docker volume; не занимайте один порт двумя запусками.

Установка `--ignore-scripts` на Windows x64 была проверена с опубликованным prebuilt better-sqlite3. Если для платформы prebuilt отсутствует, используйте предусмотренный Linux-контейнер; глобальные compiler tools не требуются инструкцией. Portable runtime в `.tools` — локальный инструмент, в Git не публикуется.

Unit/contract проверяют конфигурацию, parsing и ответы MAX; integration — реальную SQLite, HTTP, durable acceptance, restart, actor/expiry и ошибки отправки. Сеть тестов ограничена loopback, credentials MAX не нужны. `scripts/check.mjs` и `npm run manifest` — исторические утилиты G1: они записывают в `docs/evidence/g1/`, поэтому их не следует использовать для новой квитанции с перезаписью истории.

## Конфигурация и реальные внешние предпосылки

Шаблон — [.env.example](.env.example). Обязательны `APP_MODE`, `DATABASE_PATH`, `MAX_WEBHOOK_SECRET` (либо `_FILE`) и `PROBE_TESTER_IDS` (до 20 строковых ID). Значения по умолчанию: HOST=127.0.0.1, PORT=3000, PROBE_TTL_SECONDS=600, MAX_REQUEST_TIMEOUT_MS=5000. `.npmrc` задаёт локальный cache и ограниченные сетевые повторы, не содержит credentials.

В текущем G1 внешний сервис — только `https://platform-api2.max.ru`, Authorization в заголовке, TLS включён. Live требует `MAX_BOT_TOKEN`/`_FILE`, `MAX_EXPECTED_BOT_ID`, согласованный `PUBLIC_BASE_URL` и `LIVE_SCOPE_CONFIRMED=true` после фактической проверки оснований. Флаг не заменяет организаторское происхождение бота, применимые договорные условия и согласие тестировщиков. Live не переключается незаметно на simulation. Рабочие секреты не передаются в чат или Git.

[Public Compose](deploy/compose.public.yaml) и Caddy подготовлены, но не развёрнуты. Host/domain/оператор не подтверждены. [G1 runbook](docs/G1_LIVE_RUNBOOK.md) сохраняет исторические требования к `/me`, владению endpoint, одному consumer и обоим MAX-клиентам. Startup не регистрирует подписку. Эта задача не разрешает deployment, сообщения и изменение subscriptions.

Текущий контракт сервера — [OpenAPI 3.1](openapi.json). Полного пакета сдачи и работающей публичной ссылки на бота нет; `DATA-API.yaml` по неизвестной схеме не выдуман. Требования, ID и веса организатора — [00](docs/00_REQUIREMENTS_AND_EVIDENCE.md), новое предлагаемое покрытие — план pivot.

## Данные, доказательства и история

Inbox содержит только нужные нормализованные ID/тип/время и признаки probe, без имён, свободного текста и raw events. Payload завершённого inbox/outbox очищается через сутки; технические записи/контакты — через 7 дней; probe — через сутки после expiry. Это политика технического теста, а не утверждённая политика будущего продукта. Резервное восстановление старой БД не реализовано; restart целого тома не доказывает backup/restore.

Материалы исследования событий — **PREPARED_REAL_DATA**, не production import. Публичный запрос KudaGo дал HTTP 200, но обнаружены повторы/старые периоды; доступ к источникам нестабилен, неизвестные цены и окончания показаны отдельно. Реализация живой афиши и право на все варианты импорта не подтверждены. Источник учреждения не служит юридической сертификацией события. Сохранение в предлагаемом продукте не будет означать регистрацию или резерв.

Исходные [G0.1](docs/04_G0_1_REVIEW_RECEIPT.md), [G1](docs/05_G1_TECHNICAL_RECEIPT.md), их evidence и `docs/evidence/g1/source.sha256` сохранены без изменения. Manifest относится к прежнему состоянию документов и не переименован в свидетельство текущего дерева. Старые документы 01–03 помечены SUPERSEDED. PDF организатора, DOCX-пример, копии prompting guides, secrets, DB/sidecars, backups, private/raw, `.tools`, зависимости, `dist`, `.tmp` и `.review` исключены из публикации. Пользовательские оригиналы остаются локально. [Notices](THIRD_PARTY_NOTICES.md) не назначают лицензию этому проекту.

**REAL_APPLICATION_SMOKE = NOT_APPLICABLE_WITH_REASON** для задачи pivot: исследование, документы и Git. Исходный долг G1 не снят: **live MAX / mobile / web = NOT_VERIFIED**. Для будущей пользовательской функциональности реальные проверки обоих клиентов обязательны.

Следующее решение — утвердить или скорректировать ограниченный «Культурный план», Казань и подготовленный режим данных. **PRODUCT_APPROVAL: PENDING. REPLACEMENT_IMPLEMENTATION: NOT_STARTED.**
