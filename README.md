# Культурный план — реальный каталог в MAX

Пользователь выбрал реальные события. Бот подбирает культурное посещение в Казани или Екатеринбурге по дате, времени, составу и общему бюджету, показывает условия и источник, сохраняет личную закладку. Synthetic используется в тестах.

**MAXBOT_REAL_CATALOG_LOCAL_PASS · 25.09.2026.** [Квитанция 17](docs/pivot/17_REAL_CATALOG_AND_SOURCE_INTEGRATION.md): 24 события, 30 посещений (12 периодов выставок и 18 сеансов), два города. Прямой HTTPS-сбор с сайтов Казанского Кремля и Музея истории Екатеринбурга, DOM-парсеры, нормализованный снимок и полный путь HTTP → worker → SQLite → карточка → save → restart → reopen проверены локально. MAX в этой проверке симулирован; новые mobile/web наблюдения **NOT_RUN**, **REAL_APPLICATION_SMOKE=REQUIRED**. Публичное размещение не выполнялось.

## Реальные данные и ограничения

[Активный указатель](catalog/real/active.json) связывает неизменяемые snapshot и source review. В карточке есть настоящий источник и «сведения получены…». Разрешён узкий показ минимальных фактов **ADMITTED_TESTERS_FACTS** ранее допущенным согласившимся тестировщикам: source/hash/поля/атрибуция/срок проверяются в catalog, renderer, worker и MAX transport, включая edit, очередь и сохранённое. `PUBLIC_DISPLAY=NOT_CLEARED` остаётся общим ограничением; глобального `CLEARED` нет. KudaGo adapter сохранён как необязательный исследовательский канал, его показ не разрешён.

Сбор и разбор автоматизированы командой оператора, фонового обновления нет. Сведения получены 25.09.2026; текущий review истекает 28.09 около 10:40 МСК. Свежесть по умолчанию 72 часа, повторное чтение её не продлевает. Одно используемое сопоставление площадки подготовлено вручную и помечено `PREPARED_REAL`; остальные поля событий извлечены DOM-парсерами. Публично сохранены только минимальные факты/метаданные, без фото, статей и raw HTML.

Для одного взрослого 26.09, 12–18, до 500 ₽ есть два strict в Казани («Казанское Поволжье…», бесплатно; «Гелий Коржев…», 400 ₽) и один в Екатеринбурге («Азины. Магия имени», бесплатно). Для двух взрослых и ребёнка семи лет, до 1500 ₽ на всех, strict нет: кандидаты явно отделены. Диапазон 150–300 ₽ у «Каменного города» не превращён в взрослый или детский тариф. Семья не приравнивается к организованной группе. Касса и последний вход различаются; расписание июня не применяется к осени.

Каталог ограничен обследованными учреждениями. Наличие билетов, полнота афиши, отмены, дорога и длительность свободного осмотра не гарантированы. Сохранение не означает регистрацию. Спорные записи, включая прежнюю 58328, остаются в карантине.

## Локальный запуск и проверки

Закреплены Node **22.23.2** и зависимости из `package-lock.json`. Если зависимости ещё не установлены, однократно `npm.cmd ci --no-audit --no-fund` под закреплённой Node. Рабочие команды PowerShell:

```powershell
.\.tools\node-v22.23.2\node.exe node_modules/typescript/bin/tsc --noEmit
.\.tools\node-v22.23.2\node.exe node_modules/typescript/bin/tsc
.\.tools\node-v22.23.2\node.exe scripts/real-checks.mjs
.\.tools\node-v22.23.2\node.exe dist/scripts/real-walkthrough.js
```

Последняя команда использует реальные факты, локальный HTTP и simulated MAX; одноразовая SQLite создаётся в ignored `.review/real-catalog/`. Существующие личные базы не затрагиваются. Safe outputs: [walkthrough](docs/evidence/real-catalog/walkthrough.json), [карточки](docs/evidence/real-catalog/cards.md). С просроченным снимком сначала требуется настоящее обновление, часы не подменяются.

Актуальные исходные suites: **233/233 PASS**, typecheck/build PASS. Затронутые Docker build/runtime PASS. Исторические 219 PASS из 16 сохранены как история. Финальный clean submission benchmark ещё не выполнен.

## Контролируемое обновление

```powershell
.\.tools\node-v22.23.2\node.exe dist/scripts/real-catalog.js collect .cache/real-catalog/2026-09-26
.\.tools\node-v22.23.2\node.exe dist/scripts/real-catalog.js reparse .cache/real-catalog/2026-09-26
```

Имя кампании выбирать новым для нового получения. Повтор того же каталога использует кеш с исходным `fetchedAt`, не обновляет факты. CLI печатает путь candidate, SHA и очередь сомнений. После рассмотрения конкретного candidate выполнить `activate <путь-candidate> <его-SHA256> catalog/real` тем же CLI. Это единственная граница активации; snapshot/review записываются до атомарной смены указателя. Приложение читает его при следующем контролируемом запуске. Сбой/неполный refresh не стирает последний полезный снимок; исчезновение не объявляется отменой. Закладки не переносятся на новый сеанс или состав.

Не более 80 content requests / 40 MiB / 15 минут, запрос ≤20 с, по одному на host с интервалом начал ≥2 с. HTTPS origins и redirect allowlist, robots, размер/тип ответа проверяются. 401/403/429 останавливают маршрут. Повторов автоматически нет. Никаких cookies, ключей, пользовательских предпочтений или MAX token провайдерам не передаётся. Подробности и ручные ограничения — в [17](docs/pivot/17_REAL_CATALOG_AND_SOURCE_INTEGRATION.md#команды).

## Ограниченный тест в настоящем MAX

Установленные identity, token, TLS/CA, A/B admission и cursor сохраняются. Read-only локальный preflight существующей конфигурации (без MAX-запросов):

```powershell
.\.tools\node-v22.23.2\node.exe --env-file=.env.polling dist/scripts/real-preflight.js
```

Только после READY допущенных людей и при свежем review — одно разрешённое окно:

```powershell
$env:FLOW_DATA_MODE='real'
$env:DATA_SNAPSHOT_PATH=(Resolve-Path 'catalog/real/active.json').Path
.\.tools\node-v22.23.2\node.exe --env-file=.env.polling dist/scripts/live-poll.js start --minutes 30
```

Сеанс ограничен 30 минутами / 120 polling requests; Ctrl+C останавливает его. `resume` внутри того же окна не продлевает срок. Единственный consumer, сохранённые DB/cursor и отсутствие webhook-подписки проверяются прежним runner. `FLOW_TEST_CLOCK` в live запрещён. Людям давать по одному действию из [текущего ledger U16-A/B/C](docs/EXPLORATORY_MAX_RUNBOOK.md#c-текущий-assertion-ledger-и-ограниченная-delta), совмещая новую UI delta с реальной карточкой/источником/save/reopen. Исторические PASS и A/B isolation не переоткрываются. В 17 READY не получен, polling не запускался.

## Устройство, история и выпуск

Одна архитектура: TypeScript/Fastify, durable inbox/outbox, worker, SQLite WAL, MAX adapter, Docker. Внешний ingress `/webhooks/max`, диагностика `/healthz`; [OpenAPI](openapi.json). Действия связаны с actor/revision, закладки сохраняют исходный состав и выбранное посещение. `/delete_data` с подтверждением очищает персонализацию. Нет встреч/набора участников/очереди, reminders, mini-app или AI.

[Продукт](docs/pivot/01_PRODUCT_DECISION.md), [пять этапов](docs/pivot/03_IMPLEMENTATION_PLAN.md), [готовность сдачи](docs/SUBMISSION_READINESS.md), [требования и источники](docs/00_REQUIREMENTS_AND_EVIDENCE.md), [notices](THIRD_PARTY_NOTICES.md), [recovery](docs/RECOVERY_RUNBOOK.md). История: [данные 06](docs/pivot/06_DATA_MODULE_RECEIPT.md), [локальный flow 08](docs/pivot/08_EXPLORATORY_BOT_RECEIPT.md), [MAX 11](docs/pivot/11_FIRST_AUTHENTICATED_MAX_SESSION.md), [клиенты 12](docs/pivot/12_REAL_CLIENT_SMOKE_COMPLETION.md), [решение 13](docs/pivot/13_RELEASE_DECISION_AND_REMAINING_SMOKE.md), [UX/city/party 16](docs/pivot/16_COMPACT_UX_CITY_AND_PARTY.md). Старые решения и manifests не переписываются.

Публикация кода и минимальных фактов не является deployment. `deploy/compose.public.yaml` остаётся исторической подготовкой synthetic-конфигурации. Следующий выпуск требует отдельного согласованного host/оператора/периода/доступа проверяющих, свежего real review, наблюдений U16 mobile/web, финальных API/PDF и clean benchmark. Ключи Минкультуры/PRO отложены и для текущего пути не нужны. Secrets, actual env, raw payloads, частные наблюдения, tester data, DB и backups игнорируются.
