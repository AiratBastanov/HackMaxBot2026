# Культурный план — реальный каталог в MAX

Пользователь выбрал реальные события. Бот подбирает культурное посещение в Казани или Екатеринбурге по дате, времени, составу и общему бюджету, показывает условия и источник, сохраняет личную закладку. Synthetic используется в тестах.

**MAXBOT_REAL_MAX_AND_WEBHOOK_PREPARATION_PARTIAL · 25.09.2026.** [Квитанция 19](docs/pivot/19_REAL_MAX_AND_WEBHOOK_PREPARATION.md): реальная карточка и edit наблюдены в MAX mobile/web; точный остаток U16 сохранён. Существующий Compose переведён в live/webhook/real и прошёл закрытый контейнерный путь с simulated MAX, persistent SQLite/journal, атомарной сменой pointer и restart. **REAL_WEBHOOK_PROFILE_LOCAL=PASS; REAL_APPLICATION_SMOKE=REQUIRED; DEPLOYMENT=NOT_RUN.** Каталог R18 сохранён: 26 событий / 32 посещения, два города. Functional refresh и тарифный PASS перенесены; исторические 1999 мс остаются отклонением, исправление темпа имеет только локальное evidence.

## Реальные данные и ограничения

[Активный указатель](catalog/real/active.json) связывает неизменяемые snapshot и source review. В карточке есть настоящий источник и «сведения получены…». Разрешён узкий показ минимальных фактов **ADMITTED_TESTERS_FACTS** ранее допущенным согласившимся тестировщикам: source/hash/поля/атрибуция/срок проверяются в catalog, renderer, worker и MAX transport, включая edit, очередь и сохранённое. `PUBLIC_DISPLAY=NOT_CLEARED` остаётся общим ограничением; глобального `CLEARED` нет. KudaGo adapter сохранён как необязательный исследовательский канал, его показ не разрешён.

Сбор и разбор автоматизированы командой оператора, фонового обновления нет. Активная версия `536829346bd0a60d3b35`: сведения получены 25.09.2026, review истекает **28.09 в 12:11 МСК**. Свежесть по умолчанию 72 часа, повторное чтение её не продлевает. Одно используемое сопоставление площадки `PREPARED_REAL` заново подтверждено по свежей странице; остальные поля событий извлечены DOM-парсерами. Публично сохранены только минимальные факты/метаданные, без фото, статей и raw HTML.

Для одного взрослого 26.09, 12–18, до 500 ₽ есть два strict в Казани («Казанское Поволжье…», бесплатно; «Гелий Коржев…», 400 ₽) и один в Екатеринбурге («Азины. Магия имени», бесплатно). Для двух взрослых и ребёнка семи лет, до 1500 ₽ на всех, strict нет: кандидаты явно отделены. Диапазон 150–300 ₽ у «Каменного города» не превращён в взрослый или детский тариф. Семья не приравнивается к организованной группе. Касса и последний вход различаются; расписание июня не применяется к осени.

Каталог ограничен обследованными учреждениями. Наличие билетов, полнота афиши, отмены, дорога и длительность свободного осмотра не гарантированы. Сохранение не означает регистрацию. Спорные записи, включая прежнюю 58328, остаются в карантине.

## Локальный запуск и проверки

Закреплены Node **22.23.2** и зависимости из `package-lock.json`. Если зависимости ещё не установлены, однократно `npm.cmd ci --no-audit --no-fund` под закреплённой Node. Рабочие команды PowerShell:

```powershell
.\.tools\node-v22.23.2\node.exe node_modules/typescript/bin/tsc --noEmit
.\.tools\node-v22.23.2\node.exe node_modules/typescript/bin/tsc
.\.tools\node-v22.23.2\node.exe scripts/real-checks.mjs
.\.tools\node-v22.23.2\node.exe dist/scripts/real-walkthrough.js catalog/real/active.json .review/real-catalog/current-smoke
```

Последняя команда использует реальные факты, локальный HTTP и simulated MAX; одноразовая SQLite создаётся в ignored `.review/real-catalog/`. Существующие личные базы не затрагиваются. Свидетельства R18: [текущий подбор](docs/evidence/real-refresh/selection/walkthrough.json), [смена снимка и закладка](docs/evidence/real-refresh/bookmark-walkthrough.json), [карточки](docs/evidence/real-refresh/bookmark-cards.md). С просроченным снимком сначала требуется настоящее обновление, часы не подменяются.

Актуальные исходные suites: **245/245 PASS**, typecheck/build PASS. Затронутые Docker build/runtime PASS. Исторические 219 PASS из 16 и 233 PASS из 17 сохранены как история. Финальный clean submission benchmark ещё не выполнен.

## Контролируемое обновление

```powershell
.\.tools\node-v22.23.2\node.exe dist/scripts/real-catalog.js collect .cache/real-catalog/2026-09-26
.\.tools\node-v22.23.2\node.exe dist/scripts/real-catalog.js reparse .cache/real-catalog/2026-09-26
```

Имя кампании выбирать новым для нового получения, не для сброса бюджета продолжающейся кампании. Повтор того же каталога использует кеш с исходным `fetchedAt`, не обновляет факты. CLI печатает candidate, SHA, изменения и очередь сомнений. После их рассмотрения выполнить `activate <путь-candidate> <его-SHA256> catalog/real` тем же CLI. При несовпавшем source hash ручное сопоставление площадки нужно подтвердить заново либо исключить. Snapshot/review записываются до атомарной смены указателя. **До истечения review выполнить refresh и контролируемый restart**: приложение читает новый указатель при запуске. Сбой/неполный refresh не стирает полезный снимок; исчезновение не объявляется отменой.

Штатный live collect в 18 действительно выполнен: 56 HTTP / 8,4 МБ / одна кампания; два запрещённых robots пути МИЕ пропущены. Повторный разбор после исправлений — по этим же ответам, без HTTP. Единственное отклонение темпа и его исправление отражены в [refresh evidence](docs/evidence/real-refresh/refresh.json). При следующем необходимом refresh проверить интервалы начал по журналу.

Прежняя закладка хранит исходные дату/сеанс, состав, бюджет, generation и исторические факты. При совпавшей идентичности она открывает текущие сведения под новым review, показывает изменение условий и заново оценивает запрос. Истёкший выбор не переносится вперёд. При конфликте/отсутствии/истёкшем review остаются нейтральная запись и удаление.

Не более 80 content requests / 40 MiB / 15 минут, запрос ≤20 с, по одному на host с интервалом начал ≥2 с. HTTPS origins и redirect allowlist, robots, размер/тип ответа проверяются. 401/403/429 останавливают маршрут. Повторов автоматически нет. Никаких cookies, ключей, пользовательских предпочтений или MAX token провайдерам не передаётся. Подробности и ручные ограничения — в [18](docs/pivot/18_REAL_REFRESH_AND_CLIENT_DELTA.md#исполняемые-команды-и-эксплуатация).

## Ограниченный тест в настоящем MAX

Установленные identity, token, TLS/CA, A/B admission и cursor сохраняются. Read-only локальный preflight существующей конфигурации (без MAX-запросов):

```powershell
.\.tools\node-v22.23.2\node.exe --env-file=.env.polling dist/scripts/real-preflight.js
```

Окно 19 завершено; нового READY/разрешения на второе окно нет. Ниже шаблон для отдельно разрешённой будущей кампании, после проверки свежести и готовности допущенного тестировщика:

```powershell
$env:FLOW_DATA_MODE='real'
$env:DATA_SNAPSHOT_PATH=(Resolve-Path 'catalog/real/active.json').Path
.\.tools\node-v22.23.2\node.exe --env-file=.env.polling dist/scripts/live-poll.js start --minutes 30
```

Сеанс ограничен 30 минутами / 120 polling requests; последние пять минут — завершение и остановка. `resume` не продлевает срок. Один consumer, сохранённые DB/cursor и отсутствие webhook проверяются прежним runner; FLOW_TEST_CLOCK запрещён. Точный остаток — [U16-A/B/C](docs/EXPLORATORY_MAX_RUNBOOK.md#c-текущий-assertion-ledger-и-ограниченная-delta), без повторов historical PASS/A/B isolation. В 19 один A прошёл часть mobile/web пути; после 65 запросов runner остановлен, PID отсутствует, lock свободен. Замечания к заметности сохранения и повтору зоны исправлены после окна и пока проверены только локально.

## Устройство, история и выпуск

Одна архитектура: TypeScript/Fastify, durable inbox/outbox, worker, SQLite WAL, MAX adapter, Docker. Внешний ingress `/webhooks/max`, диагностика `/healthz`; [OpenAPI](openapi.json). Действия связаны с actor/revision, закладки сохраняют исходный состав и выбранное посещение. `/delete_data` с подтверждением очищает персонализацию. Нет встреч/набора участников/очереди, reminders, mini-app или AI.

[Продукт](docs/pivot/01_PRODUCT_DECISION.md), [пять этапов](docs/pivot/03_IMPLEMENTATION_PLAN.md), [готовность сдачи](docs/SUBMISSION_READINESS.md), [требования и источники](docs/00_REQUIREMENTS_AND_EVIDENCE.md), [notices](THIRD_PARTY_NOTICES.md), [recovery](docs/RECOVERY_RUNBOOK.md). История: [данные 06](docs/pivot/06_DATA_MODULE_RECEIPT.md), [локальный flow 08](docs/pivot/08_EXPLORATORY_BOT_RECEIPT.md), [MAX 11](docs/pivot/11_FIRST_AUTHENTICATED_MAX_SESSION.md), [клиенты 12](docs/pivot/12_REAL_CLIENT_SMOKE_COMPLETION.md), [решение 13](docs/pivot/13_RELEASE_DECISION_AND_REMAINING_SMOKE.md), [UX/city/party 16](docs/pivot/16_COMPACT_UX_CITY_AND_PARTY.md). Старые решения и manifests не переписываются.

Публикация кода и минимальных фактов не является deployment. `deploy/compose.public.yaml` использует real webhook, отдельный `webhook-data`, read-only directory mount каталога и secrets; обычный startup не меняет подписки. Закрытая проверка: `node scripts/webhook-profile-check.mjs` (fake credentials, network none, без Caddy/портов; нужны ещё действующие reviews). [Операторские команды](docs/EXPLORATORY_MAX_RUNBOOK.md#b-одобренные-test-hostendpoint-и-регистрация). Следующий выпуск требует одобренных host/HTTPS hostname/оператора/периода/доступа проверяющих и ответственного за refresh, оставшихся U16, финальных API/PDF и clean benchmark. Имя провайдера допустимо; платный домен не предполагается. Ключи Минкультуры/PRO отложены. Secrets, actual env, raw payloads, tester data, DB и backups игнорируются.
