# Культурный план: локальный исследовательский прототип MAX

**25.09.2026: MAXBOT_COMPACT_UX_LOCAL_PASS.** По новому разрешению реализованы короткие карточки/отдельные условия, обновление активного экрана, город кнопкой или простым текстом, взрослые/дети и бюджет на вход для всех. Подтверждение удаления содержит ровно «Да, удалить» / «Отмена». Query v2 и SQLite v3 сохраняют прежние закладки. [Квитанция 16](docs/pivot/16_COMPACT_UX_CITY_AND_PARTY.md), [before/after из renderer](docs/evidence/compact-ux/walkthrough.md), [219/219 tests и HTTP/polling smoke](docs/evidence/compact-ux/validation.json).

Реестр городов не обещает афишу: новый demo bundle содержит только вымышленную Казань (UTC+3) и Екатеринбург (UTC+5). Реальные сохранённые данные — историческая Казань; новых каталогов не загружали. Москва/остальные города без снимка дают явный отказ с возможностью выбрать другой город. Детская цена и допуск не выводятся из взрослого тарифа или маркировки; неизвестный итог остаётся неизвестным. До 8 посетителей, минимум один взрослый; возраст детей 0–17 либо не указан.

Локальная проверка новой версии: npm.cmd run typecheck, npm.cmd run build, npm.cmd run test:flow, npm.cmd run test:data, затем node dist/scripts/compact-walkthrough.js. Walkthrough использует настоящий HTTP admission/worker/SQLite и симулированный MAX с edit/delete. Для отдельно разрешённого будущего клиентского окна node dist/scripts/prepare-flow-fixture.js --synthetic-current (новый ignored JSON) создаёт новый вымышленный bundle; существующие файлы не заменяет.

**REAL_APPLICATION_SMOKE = AUTOMATED_PASS; новые MAX edit/delete/mobile/web = NOT_RUN.** Пользователь сообщил, что тестировщики недоступны; реального окна в этой работе не было. Старые человеческие PASS, включая A/B isolation, сохранены; impact mapping и три совмещённых остатка — только в [ledger](docs/EXPLORATORY_MAX_RUNBOOK.md#c-текущий-assertion-ledger-и-ограниченная-delta). Итоговый режим данных, PUBLIC_DISPLAY и deployment остаются отдельными нерешёнными вопросами. Следующие датированные записи сохраняют историю.

**2026-09-23. «Игра состоится» — REJECTED_BY_USER / SUPERSEDED.** Встречи, набор участников, вместимость и очередь больше не являются активной спецификацией.

**24.09.2026: KEYLESS_SOURCES — выбранная пользователем стратегия локального этапа «Культурного плана».** Реализованы адаптер публичного API KudaGo, нормализация, отдельный файловый кеш, детерминированный подбор и CLI. Область данных — культурные события всей Казани на следующие 30 московских дат; надёжной карты узких зон пока нет. Timepad проверен анонимно: HTTP 403, источник пропущен без запроса ключа.

**Коррекция 24.09.2026: MAXBOT_KEYLESS_DATA_CORRECTION_PARTIAL / EXPLORATORY_ONLY.** Контракт v2 сохраняет отдельные наблюдения; до трёх непроверенных вариантов доступны только по `--include-uncertain`. После точечного обогащения строгие результаты четырёх контрольных запросов — **1/0/0/0**, отдельные кандидаты — **3/3/3/0**. Это не подтверждает устойчивую строгую подборку основного сценария. Причины, парное сравнение и решение — в [квитанции коррекции](docs/pivot/07_KEYLESS_DATA_CORRECTION_RECEIPT.md); [06](docs/pivot/06_DATA_MODULE_RECEIPT.md) сохраняет исторический baseline.

**Текущее состояние, 24.09.2026:** LOCAL_USER_READINESS = PASS. Группы «Совпадает по известным условиям» и «Варианты, где нужно уточнение» разделены; кандидаты доступны только после opt-in текущего запроса. Известное время кандидата сохраняется при неизвестной цене. Интерес определяет порядок, обязательные дата/время/бюджет не расширяются. Карточки компактно показывают существенные условия, русскую дату и московский часовой пояс; одинаковые предупреждения/наблюдения сгруппированы, полные отличающиеся факты доступны через «Все условия». Закладки сохраняют контекст после restart. [Квитанция 10](docs/pivot/10_USER_READINESS_AND_FIRST_MAX_CHECK.md) и [черновик комплекта сдачи](docs/SUBMISSION_READINESS.md) содержат новые результаты; [09](docs/pivot/09_STAGE4_CORRECTIONS_AND_SMOKE.md) и [08](docs/pivot/08_EXPLORATORY_BOT_RECEIPT.md) сохраняют историю.

**DATA_SUITABILITY = EXPLORATORY_ONLY; PUBLIC_DISPLAY = NOT_CLEARED.** Спорная идентичность строгого примера остаётся в карантине: исторический запрос даёт **0 strict / 3 кандидата**, исходная цена/адрес не заменены. Provider-карточки блокируются renderer, worker и транспортом. Технический synthetic deployment разрешён только на конкретном уже одобренном test environment; его live-предпосылки пока отсутствуют. Напоминания, новые данные, проверка спроса и публичный выпуск не выполнялись.

**Первое подключение, 24.09.2026:** BOT_API_INSPECTION=PASS: «Хакатон МАХ 432», ID `426717762`, [@t432_hakaton_max_bot](https://max.ru/t432_hakaton_max_bot), subscriptions=0. Ротация и единственный consumer подтверждены оператором. **MAXBOT_FIRST_MAX_SESSION_PARTIAL**: в web человек подтвердил меню, strict/полные условия и save/open; в mobile — ту же карточку после restart и удаление. Кандидат с неизвестной ценой сохранён в mobile и открыт в web с прежней пометкой; пустой /saved после /delete_data подтверждён точным текстом человека. Кнопка «Удалить мои данные» в пустом списке не означает запрос подтверждения. Полный mobile/web smoke остаётся REQUIRED: история сохранена в [11](docs/pivot/11_FIRST_AUTHENTICATED_MAX_SESSION.md), текущий остаток — в [ledger runbook](docs/EXPLORATORY_MAX_RUNBOOK.md#c-текущий-assertion-ledger-и-ограниченная-delta). Сеансы ограничены по времени/запросам, БД/cursor сохранены. 179 тестов в 10 остаются историческим результатом; текущие 118 тестов описаны в 11.

**Дополнение клиентской проверки, 24.09.2026:** [квитанция 12](docs/pivot/12_REAL_CLIENT_SMOKE_COMPLETION.md), **MAXBOT_REAL_CLIENT_SMOKE_PARTIAL**. WEB: подтверждены неверный/верный ввод и старые коды всех трёх форм, порядок/opt-in/исключения, дата/часовой пояс/давность, переход по example-ссылке, полные условия после restart и `/probe → /start`. В обоих клиентах подтверждены маркировка/меню и пустые закладки после явного erasure. CROSS_CLIENT_CONTINUITY=PASS для strict WEB→MOBILE и candidate MOBILE→WEB. В окне 12 B не участвовал. Текущие assertions, методы и остаток ведутся только в [ledger runbook](docs/EXPLORATORY_MAX_RUNBOOK.md#c-текущий-assertion-ledger-и-ограниченная-delta). Код не менялся, исторические 118 тестов повторно не запускались. Production webhook и public deployment остаются NOT_VERIFIED.

**Подготовка решения выпуска, 24.09.2026:** [квитанция 13](docs/pivot/13_RELEASE_DECISION_AND_REMAINING_SMOKE.md). В [SUBMISSION_READINESS](docs/SUBMISSION_READINESS.md) подготовлены два конкретных варианта; рекомендуем **DEMONSTRATION_MVP** с настоящим MAX и явно вымышленными событиями, **RELEASE_DATA_DECISION=PENDING_USER_DECISION**. Текущий synthetic-current предназначен для коротких тестов: для сдачи ещё нужны versioned dataset на весь период, expiry/restart и стабильные закладки. Реальный каталог NOT_READY, PUBLIC_DISPLAY=NOT_CLEARED. Передача host/HTTPS/persistent SQLite/оператору и предварительного доступа проверяющим подготовлена; неизвестные реквизиты не подставлены. Одна новая кампания завершена: WEB F06 (дата/время/бюджет, сводка/reset, старое «Бюджет») и обычное удаление F08 подтверждены по одному действию и ответу. Исторический остаток зафиксирован в 13; тогда PHONE оказался новым B, который согласился, но не был сопряжён. Для окна 13 REAL_MAX_MOBILE/WEB=PARTIAL, CROSS_USER_ISOLATION=NOT_VERIFIED; текущие допуск и результаты — в [ledger](docs/EXPLORATORY_MAX_RUNBOOK.md#c-текущий-assertion-ledger-и-ограниченная-delta). Полная кампания заново не проводится; этапов по-прежнему пять.

## Тест в настоящем MAX без host

После build и `npm.cmd run live:prepare` назначенная ignored конфигурация `.env.inspect`/`.env.polling` использует только `secrets/max_bot_token`, pin бота и synthetic-current snapshot. Новому оператору нужны подтверждения ротации и единственного consumer; неизвестный tester ID определяется одноразовым `pair` с отдельным подтверждением в терминале. Полный порядок — [runbook](docs/EXPLORATORY_MAX_RUNBOOK.md#b2-тестовый-polling-без-host).

```powershell
# На этой машине проверен официальный CA; только текущее окружение процесса.
$env:NODE_EXTRA_CA_CERTS = (Resolve-Path secrets/max-official-root.pem).Path
npm.cmd run live:inspect
npm.cmd run live:poll -- pair
npm.cmd run live:poll -- start
# Для контролируемого restart: Ctrl+C, затем в пределах той же кампании:
npm.cmd run live:poll -- resume
```

Начинать /start только после READY_FOR_TESTER_ACTION. По умолчанию сеанс ≤15 минут / 120 polling requests. По отдельной просьбе пользователя добавлен `npm.cmd run live:poll -- start --minutes 30`: явное новое окно до 30 минут с тем же пределом 120 запросов; `resume` его не продлевает. Dedicated test DB/cursor сохраняются; фоновой установки и публичного порта нет. A уже сопряжён, повторный `pair` для него не нужен. Если снимку больше часа: `node dist/scripts/prepare-flow-fixture.js --synthetic-current runtime/max-test/synthetic-next.json`, затем изменить только DATA_SNAPSHOT_PATH в ignored `.env.polling` на новый файл; существующий файл не перезаписывать. `pair` не запускает продуктовый flow и не пишет пользователям. PUBLIC_DISPLAY остаётся NOT_CLEARED. Для воспроизводимых offline проверок: `node scripts/first-max-checks.mjs` — 21 новый + 97 релевантных прежних тестов; это не real-client PASS.

Разрешённое продолжение delta завершено **24.09.2026 в 21:27:48 МСК**: 75/120 polling requests, owned PID остановлен, lock свободен, незавершённых отправок нет; терминал exit 1 после принудительной остановки. БД/cursor/admission A+B сохранены. [Квитанция 15](docs/pivot/15_DELTA_CLIENT_CONTINUATION.md) фиксирует 9 новых HUMAN_PASS и один выполненный подшаг; 34 прежних PASS перенесены без повторения. Закладка B сохранилась после стирания A и после старой кнопки удаления прежнего поколения. Единственный текущий [ledger](docs/EXPLORATORY_MAX_RUNBOOK.md#c-текущий-assertion-ledger-и-ограниченная-delta) содержит точный остаток из 13 assertions и отдельные методы evidence. Runner остановлен, автоматического нового окна нет; решение данных остаётся PENDING_USER_DECISION.

## Полный локальный путь без ключей

```powershell
npm.cmd run build
npm.cmd run test:flow
node dist/scripts/readiness-walkthrough.js
```

`readiness-walkthrough` поднимает настоящий HTTP webhook на свободном loopback-порту, использует SQLite/worker/renderer и симулированный MAX. Новая ignored БД каждого прогона изолирована. Часы 2030 года и события явно synthetic; адреса вымышленные, ссылки example.org обозначены как примеры. `.review/user-readiness/synthetic-transcript.md` содержит обе группы, Back/edit, детали, save/restart/remove/re-save, недоступный источник и стирание. Исторические walkthrough и evidence этапов 2–4 сохранены. Для полного небольшого набора проверок: `node scripts/readiness-checks.mjs` (179 уникальных тестов; отдельный повтор на другой платформе не добавляет тестов).

При наличии старого кеша `npm.cmd run flow:replay` проходит приложение на исходных фактах с историческими часами 24.09.2026. Карточки сохраняются только в `.review/exploratory/private-real-replay.txt`. Это не новая загрузка/проверка источника. Отсутствие кеша — явная ошибка, без synthetic fallback.

Для отдельного контейнерного теста (синтетический secret безопасен только в этом локальном режиме):

```powershell
docker compose -f compose.flow-test.yaml up --build -d --wait
docker compose -f compose.flow-test.yaml exec -T app node dist/scripts/flow-container-smoke.js
docker compose -f compose.flow-test.yaml restart app
docker compose -f compose.flow-test.yaml up -d --no-build --wait
docker compose -f compose.flow-test.yaml exec -T app node dist/scripts/flow-container-smoke.js --verify-restart
docker compose -f compose.flow-test.yaml stop
```

Порт — `127.0.0.1:3008`; том отделён от G1. Первый smoke оставляет strict synthetic закладку с ценой 200 ₽/регистрацией/последним входом 17:30, второй проверяет условия после restart и удаляет её. Существующие тома не удаляются. Для новой проверки выбирайте одноразовый project: `node scripts/readiness-docker-check.mjs`; ему нужен доступ к уже установленному Docker. Он пересобирает образ, останавливает только свой контейнер и сохраняет том. Текущий rebuild занял 24,143 с; это не clean submission benchmark. Зависимости не менялись; финальный замер остаётся этапом 5. Предыдущий offline public Compose preflight описан в 09; live конфигурация без реквизитов не запускалась.

Для частного реального снимка: `FLOW_DATA_MODE=real`, `DATA_SNAPSHOT_PATH=<локальный snapshot.json>`, `APP_MODE=local`. Снимок валидируется/замораживается на startup; чтение не обновляет timestamps. `FLOW_TEST_CLOCK` допустим только в local synthetic-test; любой live отклоняет внедрённые часы. Нет сети провайдера в webhook/worker.

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
- [Этап 4: исправления, recovery и готовность real-client smoke](docs/pivot/09_STAGE4_CORRECTIONS_AND_SMOKE.md).
- [Представление карточек и текущая готовность к проверке MAX](docs/pivot/10_USER_READINESS_AND_FIRST_MAX_CHECK.md).
- [Первое authenticated подключение и test polling](docs/pivot/11_FIRST_AUTHENTICATED_MAX_SESSION.md).
- [Историческое дополнение mobile/web — квитанция 12](docs/pivot/12_REAL_CLIENT_SMOKE_COMPLETION.md); [исправление workflow — квитанция 14](docs/pivot/14_DELTA_CLIENT_VERIFICATION.md); [продолжение delta — квитанция 15](docs/pivot/15_DELTA_CLIENT_CONTINUATION.md).
- [Комплект сдачи: DRAFT / NOT_SUBMITTED](docs/SUBMISSION_READINESS.md).
- [Операторский backup/restore с карантином](docs/RECOVERY_RUNBOOK.md).

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

Probe проходит путь `?start=g1` или `/probe` → кнопка → вопрос → штатный «Ответить» на вопрос с текстом «готово». Устаревшие/чужие команды отвергаются. Исторические тексты probe не являются новым продуктом. Принимаются только допущенные тестировщики; культурный flow доступен локально, в live допускается только явно выбранный технический synthetic тест. Первые реальные web-наблюдения — в 11, напоминаний нет.

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

Для обычного webhook entry point шаблон — [.env.example](.env.example). Обязательны `APP_MODE`, `DATABASE_PATH`, `MAX_WEBHOOK_SECRET` (либо `_FILE`) и `PROBE_TESTER_IDS` (до 20 строковых ID). Test-only polling использует отдельный [.env.polling.example](.env.polling.example), без webhook secret/public origin, с закреплённой identity и выделенной БД. Значения webhook по умолчанию: HOST=127.0.0.1, PORT=3000, PROBE_TTL_SECONDS=600, MAX_REQUEST_TIMEOUT_MS=5000. `.npmrc` задаёт локальный cache и ограниченные сетевые повторы, не содержит credentials.

Внешний сервис — `https://platform-api2.max.ru`, Authorization в заголовке, TLS включён. Live webhook требует `MAX_BOT_TOKEN`/`_FILE`, `MAX_EXPECTED_BOT_ID`, согласованный `PUBLIC_BASE_URL` и `LIVE_SCOPE_CONFIRMED=true` после фактической проверки оснований. Флаг не заменяет организаторское происхождение бота, применимые договорные условия и согласие тестировщиков. Live не переключается незаметно на simulation. Рабочие секреты не передаются в чат или Git.

[Public Compose](deploy/compose.public.yaml) и Caddy проверяются вместе с `.env.live.example`, snapshot/secret mounts и UID 1000. Live host/endpoint отсутствует. Текущий [runbook этапа 4](docs/EXPLORATORY_MAX_RUNBOOK.md) разделяет A: read-only `/me`/subscriptions без deployment (`.env.inspect.example`), B: конкретный разрешённый test host/регистрацию, C: человеческие mobile/web наблюдения. Startup проверяет закреплённую identity, но не регистрирует подписку. Неоднозначная регистрация требует reconciliation; журнал запрещает слепой повтор. G1 runbook сохраняется как история.

Текущий контракт webhook-сервера — [OpenAPI 3.1](openapi.json). Username/ссылка бота проверены через /me; постоянного публичного runtime и полного пакета сдачи нет. [DATA-API.draft.yaml](docs/examples/DATA-API.draft.yaml) остаётся черновиком. Требования, ID и веса организатора — [00](docs/00_REQUIREMENTS_AND_EVIDENCE.md), покрытие — план pivot.

## Данные, доказательства и история

Inbox содержит нормализованные ID/тип/время и ограниченный ввод формы, без имён/произвольных текстов/raw events. Payload завершённых очередей очищается через сутки, технические записи — через 7 дней. Состояние подбора — 30 дней без активности, действия — 15 минут, закладки — до удаления. `/delete_data` очищает прежние personal payload, сохраняя текущий нейтральный ACK. Удаление истории MAX или старых backups не обещается. [Backup/restore](docs/RECOVERY_RUNBOOK.md) проверяется отдельно: только новый путь, integrity/identity/schema, карантин старой персонализации и очереди, явный discard при потере последующих удалений. Обычный restart целого тома сохраняет данные.

Материалы исследования событий — **PREPARED_REAL_DATA**, не production import. Публичный запрос KudaGo дал HTTP 200, но обнаружены повторы/старые периоды; доступ к источникам нестабилен, неизвестные цены и окончания показаны отдельно. Реализация живой афиши и право на все варианты импорта не подтверждены. Источник учреждения не служит юридической сертификацией события. Сохранение в предлагаемом продукте не будет означать регистрацию или резерв.

Исходные [G0.1](docs/04_G0_1_REVIEW_RECEIPT.md), [G1](docs/05_G1_TECHNICAL_RECEIPT.md), их evidence и `docs/evidence/g1/source.sha256` сохранены без изменения. Manifest относится к прежнему состоянию документов и не переименован в свидетельство текущего дерева. Старые документы 01–03 помечены SUPERSEDED. PDF организатора, DOCX-пример, копии prompting guides, secrets, DB/sidecars, backups, private/raw, `.tools`, зависимости, `dist`, `.tmp` и `.review` исключены из публикации. Пользовательские оригиналы остаются локально. [Notices](THIRD_PARTY_NOTICES.md) не назначают лицензию этому проекту.

**Исторический статус до 16: REAL_APPLICATION_SMOKE = REQUIRED; REAL_MAX_MOBILE = PARTIAL; REAL_MAX_WEB = PARTIAL; CROSS_CLIENT_CONTINUITY = PASS в описанном объёме; CROSS_USER_ISOLATION = PASS для сохранности закладки B после стирания A.** Текущие assertions — в [ledger](docs/EXPLORATORY_MAX_RUNBOOK.md#c-текущий-assertion-ledger-и-ограниченная-delta), итог продолжения — в [15](docs/pivot/15_DELTA_CLIENT_CONTINUATION.md); 11–14 сохраняют историю. [Runbook](docs/EXPLORATORY_MAX_RUNBOOK.md) ограничен маркированными синтетическими данными и согласившимися тестировщиками. Для test polling endpoint не нужен; production webhook проверяется отдельно.

Следующее решение выпуска — допустимый формат данных сдаваемой версии и конкретные одобренные host/domain/operator/период доступности; точные незавершённые клиентские проверки перечислены только в [ledger runbook](docs/EXPLORATORY_MAX_RUNBOOK.md#c-текущий-assertion-ledger-и-ограниченная-delta). Спрос и устойчивое качество афиши остаются неподтверждёнными. Локальный исследовательский объём утверждён; напоминания и публичный выпуск не начинаются автоматически.
