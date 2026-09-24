# Культурный план: локальный исследовательский прототип MAX

**2026-09-23. «Игра состоится» — REJECTED_BY_USER / SUPERSEDED.** Встречи, набор участников, вместимость и очередь больше не являются активной спецификацией.

**24.09.2026: KEYLESS_SOURCES — выбранная пользователем стратегия локального этапа «Культурного плана».** Реализованы адаптер публичного API KudaGo, нормализация, отдельный файловый кеш, детерминированный подбор и CLI. Область данных — культурные события всей Казани на следующие 30 московских дат; надёжной карты узких зон пока нет. Timepad проверен анонимно: HTTP 403, источник пропущен без запроса ключа.

**Коррекция 24.09.2026: MAXBOT_KEYLESS_DATA_CORRECTION_PARTIAL / EXPLORATORY_ONLY.** Контракт v2 сохраняет отдельные наблюдения; до трёх непроверенных вариантов доступны только по `--include-uncertain`. После точечного обогащения строгие результаты четырёх контрольных запросов — **1/0/0/0**, отдельные кандидаты — **3/3/3/0**. Это не подтверждает устойчивую строгую подборку основного сценария. Причины, парное сравнение и решение — в [квитанции коррекции](docs/pivot/07_KEYLESS_DATA_CORRECTION_RECEIPT.md); [06](docs/pivot/06_DATA_MODULE_RECEIPT.md) сохраняет исторический baseline.

**Текущее решение 24.09.2026: исследовательский локальный путь и минимальные закладки разрешены и реализованы.** Вход → дата/время → взрослый бюджет → интерес → условия → строгие результаты → отдельный запрос вариантов для проверки → детали/источник → сохранить → список → удалить. Один сервер, webhook, worker и SQLite; `/probe` остался отдельной технической командой. [Квитанция 08](docs/pivot/08_EXPLORATORY_BOT_RECEIPT.md) фиксирует новые проверки; прежний результат 07 остаётся историческим.

**DATA_SUITABILITY = EXPLORATORY_ONLY; PUBLIC_DISPLAY = NOT_CLEARED; mobile/web MAX = NOT_VERIFIED.** Спорная идентичность единственного строгого примера помещена в отдельный реестр карантина: затронутый исторический запрос теперь даёт **0 strict / 3 кандидата**, без замены исходной цены или адреса. Отправка provider-карточек в live MAX блокируется в renderer, worker и транспорте. Напоминания, deployment и проверка спроса не выполнены и не разрешены этим этапом.

## Полный локальный путь без ключей

```powershell
npm.cmd run build
npm.cmd run test:flow
npm.cmd run flow:demo
```

`flow:demo` явно выбирает синтетический каталог и часы 2030 года, поднимает настоящий HTTP webhook на свободном loopback-порту, использует SQLite, worker и реальный renderer с симулированным MAX. Каждому прогону выделяется новая ignored БД. В `.review/exploratory/synthetic-transcript.txt` записывается разговор, включая opt-in, save/list/delete/restart и восстановление. [Публикуемый синтетический транскрипт](docs/evidence/exploratory/synthetic-transcript.md). Пример не является афишей; ссылки ведут на `example.org`.

При наличии старого кеша `npm.cmd run flow:replay` проходит приложение на исходных фактах с историческими часами 24.09.2026. Карточки сохраняются только в `.review/exploratory/private-real-replay.txt`. Это не новая загрузка/проверка источника. Отсутствие кеша — явная ошибка, без synthetic fallback.

Для отдельного контейнерного теста (синтетический secret безопасен только в этом локальном режиме):

```powershell
docker compose -f compose.flow-test.yaml up --build -d --wait
docker compose -f compose.flow-test.yaml exec -T app node dist/scripts/flow-container-smoke.js
docker compose -f compose.flow-test.yaml restart app
docker compose -f compose.flow-test.yaml exec -T app node dist/scripts/flow-container-smoke.js --verify-restart
docker compose -f compose.flow-test.yaml stop
```

Порт — `127.0.0.1:3008`; том `maxbot-cultural-flow-test_flow-test-data` отделён от G1. Первый smoke оставляет синтетическую закладку, второй проверяет её после restart и удаляет. Существующие тома не удаляются. В задаче использован отдельный project `maxbot-flow-review-20260924`. Образ собирается из закреплённых inputs, без глобальной установки Node/SQLite.

Для частного реального снимка: `FLOW_DATA_MODE=real`, `DATA_SNAPSHOT_PATH=<локальный snapshot.json>`, `APP_MODE=local`. Снимок валидируется и замораживается на startup; после контролируемого CLI refresh нужен restart приложения. Чтение не обновляет timestamps. `FLOW_TEST_CLOCK` допустим только с явно выбранным `synthetic-test`; live real отклоняет внедрённые часы и synthetic snapshot. Нет сети провайдера в webhook/worker.

Кнопки действуют 15 минут и связаны с actor/revision. Изменение фильтра сбрасывает opt-in; старая карточка не меняет событие. Свободный ввод имеет формат с одноразовым кодом формы: дата `КОД ГГГГ-ММ-ДД`, время `КОД ЧЧ:ММ-ЧЧ:ММ`, сумма `КОД 500`. Произвольный текст не архивируется. До 50 закладок, страницы по пять; `/delete_data` с подтверждением удаляет закладки и параметры. Сохранение не бронирует билет и не записывает на событие.

Активные документы:

- [Продуктовое решение и три альтернативы](docs/pivot/01_PRODUCT_DECISION.md).
- [Доступность данных: источники, 15 реальных записей и ограничения](docs/pivot/02_DATA_FEASIBILITY.md).
- [Использование основы, план, оценки и покрытие требований](docs/pivot/03_IMPLEMENTATION_PLAN.md).
- [Culture.ru: открытый набор, фактический доступ и решение об источнике](docs/pivot/04_CULTURE_SOURCE_REVIEW.md).
- [Исторические запросы о доступе: DEFERRED_BY_USER, не отправлены](docs/pivot/05_DATA_ACCESS_REQUESTS.md).
- [Локальный модуль данных: запуск и результаты](docs/pivot/06_DATA_MODULE_RECEIPT.md).
- [Коррекция отбора, кандидаты и ограниченное обогащение](docs/pivot/07_KEYLESS_DATA_CORRECTION_RECEIPT.md).
- [Интегрированный диалог, закладки и текущая локальная проверка](docs/pivot/08_EXPLORATORY_BOT_RECEIPT.md).

Минкультуры/PRO и процесс ключа/экспорта — **DEFERRED_BY_USER**, не предпосылка MVP. Письма не отправляются, портал Culture.ru не скрапится, архивы больше не скачиваются. [Исследование 23.09](docs/pivot/04_CULTURE_SOURCE_REVIEW.md), его 10 synthetic tests и подготовленные сведения двух учреждений сохранены как история; автоматической подстановки этих сведений в живой каталог нет.

## Локальные данные без MAX и ключей

Используйте закреплённый Node 22.23.2 и зависимости из существующего lockfile. На Windows — `npm.cmd`; в этой workspace portable Node лежит в `.tools/node-v22.23.2/node.exe`. Для выбора его в текущем PowerShell: `$env:PATH = (Resolve-Path .tools/node-v22.23.2).Path + ';' + $env:PATH`.

```powershell
npm.cmd run build
npm.cmd run data -- validate
npm.cmd run data -- examples --clock 2026-09-24T07:57:13.820Z
npm.cmd run data -- examples --clock 2026-09-24T07:57:13.820Z --include-uncertain
npm.cmd run data -- demo --synthetic
npm.cmd run test:data
```

Указанные часы предназначены для исторического replay исходного кеша; для актуального запроса передавайте фактическое время. Новый обогащённый кеш этой проверки — `.cache/keyless-correction/snapshot.json`; его чтение и воспроизведение описаны в [07](docs/pivot/07_KEYLESS_DATA_CORRECTION_RECEIPT.md). Новая загрузка не запускается при подборе. `fetch` остаётся отдельной сетевой командой; завершённая кампания коррекции автоматически не повторяется. Синтетическое demo имеет фиксированные часы 2030 года и не заменяет реальные данные.

`recommend` и `examples` по умолчанию возвращают только строгие карточки, до трёх разных событий. `--include-uncertain` дополнительно открывает до трёх кандидатов с установленными фактами, неизвестными условиями и перечнем проверки у источника. Известное нарушение бюджета, дат, города, закрытие или отмена исключает запись из обеих секций. `uncertainTotal` — число возможных кандидатов до ограничения вывода, не число строгих совпадений. Кеш, журналы и реальные карточки ignored; SQLite MAX не используется. Команда `enrich` теперь требует `--resume` и целевой `--plan`; сохраняет общий журнал, deadline и каждый успешный ответ. Сетевая частичность обозначается кодом 2, ошибки аргументов/схемы — кодом 1.

CLI сохраняет исходные ссылки и подпись KudaGo. Публичный показ ещё не допущен: индексируемость ссылки в MAX и распознавание рекламы требуют отдельного решения до будущего показа. Фото, редакционные тексты, логотипы и выгрузки каталога не публикуются.

Репозиторий проекта: [AiratBastanov/HackMaxBot2026](https://github.com/AiratBastanov/HackMaxBot2026). Этот checkpoint сохраняет техническую основу и исследование; это не готовый культурный сервис и не финальная сдача.

## Что работает сейчас

Существующий технический probe G1: TypeScript/Fastify, `POST /webhooks/max`, `GET /healthz`, SQLite inbox/outbox, worker, отдельные local/live транспорты MAX, проверка конфигурации/секретов и Docker. Есть сохранение int64 как строк, дедупликация, actor-bound callback, exact reply к вопросу, сроки и подавление недоступной связи. При неоднозначном результате отправки нет слепого повторения POST.

Probe проходит путь `?start=g1` или `/probe` → кнопка → вопрос → штатный «Ответить» на вопрос с текстом «готово». Устаревшие/чужие команды отвергаются. Тексты и схемы probe сохранены, включая прежние упоминания встреч; они не являются сценарием нового продукта. Принимаются только `PROBE_TESTER_IDS`; в MAX культурный подбор, сохранённые события и напоминания отсутствуют. Отдельный локальный модуль данных описан выше.

**MAXBOT_G1_TECHNICAL_PARTIAL.** Исторические локальный HTTP/SQLite, restart и Docker описаны в неизменённой [квитанции G1](docs/05_G1_TECHNICAL_RECEIPT.md). 23.09.2026 повторно прошли typecheck/build и **50/50** существующих unit/contract/integration tests. Это проверка основы на синтетике; новый домен и реальные MAX-клиенты ею не проверены. Готовый outbox не является планировщиком напоминаний: текущий срок задания ограничен 60 секундами.

## Сохранённый технический probe

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

Ожидаются `status:ok`, `mode:local`, два smoke PASS и `realMax:false`. Повторный `docker compose up -d` сохраняет том. `down -v` для проверки restart не нужен. Это G1-прогон; текущий продуктовый Docker-прогон описан выше и в 08.

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

Inbox содержит нормализованные ID/тип/время, признаки probe и ограниченный ввод формы, без имён, произвольного текста и raw events. Payload завершённых очередей очищается через сутки, технические записи — через 7 дней. Состояние подбора удаляется после 30 дней без активности, действия истекают через 15 минут. Закладки хранятся до явного удаления пользователем и не удаляются probe cleanup; контакт suppression сохраняется, пока есть продуктовые записи. Это политика локального прототипа, не утверждённая публичная политика оператора. Restart целого тома не доказывает backup/restore.

Материалы исследования событий — **PREPARED_REAL_DATA**, не production import. Публичный запрос KudaGo дал HTTP 200, но обнаружены повторы/старые периоды; доступ к источникам нестабилен, неизвестные цены и окончания показаны отдельно. Реализация живой афиши и право на все варианты импорта не подтверждены. Источник учреждения не служит юридической сертификацией события. Сохранение в предлагаемом продукте не будет означать регистрацию или резерв.

Исходные [G0.1](docs/04_G0_1_REVIEW_RECEIPT.md), [G1](docs/05_G1_TECHNICAL_RECEIPT.md), их evidence и `docs/evidence/g1/source.sha256` сохранены без изменения. Manifest относится к прежнему состоянию документов и не переименован в свидетельство текущего дерева. Старые документы 01–03 помечены SUPERSEDED. PDF организатора, DOCX-пример, копии prompting guides, secrets, DB/sidecars, backups, private/raw, `.tools`, зависимости, `dist`, `.tmp` и `.review` исключены из публикации. Пользовательские оригиналы остаются локально. [Notices](THIRD_PARTY_NOTICES.md) не назначают лицензию этому проекту.

**REAL_APPLICATION_SMOKE = REQUIRED; REAL_MAX_MOBILE / REAL_MAX_WEB = NOT_VERIFIED.** Локальная реализация не закрывает реальные наблюдения. [Точный runbook](docs/EXPLORATORY_MAX_RUNBOOK.md) ограничен маркированными синтетическими данными и требует уже согласованных бота, endpoint и тестировщиков.

Следующий объём — реальные mobile/web проверки на согласованной инфраструктуре и разрешение условий публичного показа; спрос и устойчивое качество афиши остаются неподтверждёнными. Локальный исследовательский объём утверждён; напоминания и публичный выпуск не начинаются автоматически.
