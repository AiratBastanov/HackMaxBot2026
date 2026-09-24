# Представление карточек и готовность к первой проверке MAX

**24.09.2026 · MAXBOT_USER_READINESS_LOCAL_PASS.** Основа: `ab38e1855bfddf8678aaa645ac63d043c4502f95`, `main`, origin `https://github.com/AiratBastanov/HackMaxBot2026.git`. В начале worktree/index чистые; remote main совпал с указанным HEAD. Позднейших пользовательских изменений не обнаружено. Эта квитанция не закрывает этап 4 целиком и не является сдачей.

| Граница | Фактический статус |
|---|---|
| LOCAL_USER_READINESS | PASS |
| DOCKER | PASS: новый образ, HTTP/worker/SQLite, restart и удаление |
| BACKUP_RESTORE | Существующая реализация не изменена; четыре recovery regression в новой integration-группе PASS |
| REAL_MAX_INSPECTION | NOT_VERIFIED: authenticated запросов 0 |
| REAL_MAX_MOBILE / REAL_MAX_WEB | NOT_VERIFIED / NOT_VERIFIED |
| WEBHOOK_INGRESS | NOT_VERIFIED: только локальный HTTP; доставки из MAX нет |
| PUBLIC_DEPLOYMENT | NOT_VERIFIED, не развёрнуто |
| SUBMISSION_PACKAGE | DRAFT / NOT_SUBMITTED |
| REAL_APPLICATION_SMOKE | REQUIRED |
| DATA_SUITABILITY / PUBLIC_DISPLAY | EXPLORATORY_ONLY / NOT_CLEARED |

## Находки и исправления

Перед исправлениями добавлены шесть регрессий: **5 FAIL / 1 PASS**. Неизвестное время уже корректно оставалось неизвестным; это сохранённое поведение, не новый дефект. После исправлений focused 16/16, затем весь соответствующий набор на окончательном runtime-коде прошёл один раз. Лог исходного воспроизведения остаётся приватным `.review/user-readiness/red-flow.log`, его SHA-256 записан в [validation.json](../evidence/user-readiness/validation.json).

| ID | Воспроизведённая причина | Исправление и граница |
|---|---|---|
| R10-A | `flow.ts` выбирал один заголовок по наличию strict и выводил под ним все карточки, включая opt-in кандидатов | Отдельные «Совпадает по известным условиям» / «Варианты, где нужно уточнение». Нумерация общая, action связан с прежней event/occurrence identity. Фильтры/selector classification не менялись; relevant edit сбрасывает opt-in |
| R10-B | Последний вход повторялся в hours и отдельной строке; те же предупреждения добавлялись из selector и renderer; provenance печатался для каждого наблюдения без группировки | Именованные существенные поля и одно предупреждение на известный смысл. Только точные известные эквиваленты заменяются уже показанным фактом; произвольные разные условия не объединяются. В «Все условия» остаются текст цены, допуск, все неизвестные, дополнительные факты и полное расписание |
| R10-B/provenance | Одинаковая дата площадки повторялась шесть раз; различающиеся поля/конфликты не объяснялись | Группировка по **сущности + точному timestamp + request URL + набору конфликтов**, объединяется только список полей. Разные времена (включая миллисекунды/unknown), конфликты, URL и событие/площадка сохраняют отдельные записи. Не выбирается newest timestamp для всего объекта |
| R10-C | `flowFixture` заменял event URLs, но оставлял вымышленный URL площадки на kudago.com | Пользовательские fixed/current fixtures получают example.org и явную подпись «Пример ссылки площадки». Нормализатор настоящих provider URL не ослаблен: regression отвергает example.org как KudaGo source. Provider-format входы unit-нормализатора остаются отдельными тестовыми данными |
| R10-D | Для мастерской evaluator давал `time=MATCH`, `price=UNKNOWN`, from/until были вычислены, но Candidate не передавал их проекции. Renderer брал null start/end свободного посещения | `Candidate.time` переносит результат **того же evaluator**, включая assessment/from/until/lastEntry. Карточка и сохранённая закладка показывают известное пересечение. Статус остаётся UNCERTAIN; неизвестные период/расписание называются отдельно. Второго selector в renderer нет |

Пример R10-D: query `2030-04-06T09:00:00.000Z`–`2030-04-06T15:00:00.000Z`, до 500 ₽; часы мастерской 10–20 Москва. Пересечение 12–18 известно, цена «от 300» не устанавливает взрослый тариф. Last entry неизвестен. До/после исправления всего **2 strict / 1 candidate**; изменено объяснение, не допуск к строгой группе. Полный синтетический trace predicates/точных timestamps — в validation.json. Гипотеза потери времени подтвердилась; оснований для несогласия с ней нет.

Даты в интерфейсе: например, «6 апреля 2030 г. 12:00 — 18:00 (Москва, UTC+3)». Machine timestamps в selector, Card, SQLite и техническом evidence остаются точными. Получение нами и изменение у источника подписаны отдельно; последнее не выдумывается. Обзор ограничивает отдельные поля, полные значения разбиваются на страницы; слепого конечного среза сообщения нет. Сохранены регрессии длинных допустимых полей, отсутствующего адреса и старых закладок. Старые bookmarks не обогащаются полями задним числом. Исправление fixture URL может дать честное предупреждение об изменившемся снимке в прежней тестовой закладке.

## Новые измерения

Среда: Windows, имеющийся portable Node **22.23.2**, pinned dependencies без изменений/установки. Структурированные команды/время/exit codes — [validation.json](../evidence/user-readiness/validation.json). Логи — `.review/user-readiness/`. Нативные SQLite tests не выполнялись одновременно с установкой пакетов.

| Проверка | Команда | Новый результат |
|---|---|---|
| Typecheck | `node node_modules/typescript/bin/tsc --noEmit` | PASS, 0,479 с |
| Build | `node node_modules/typescript/bin/tsc` | PASS, 0,497 с |
| Unit/contract | `node scripts/readiness-checks.mjs`, группа unit | 32/32, 0,428 с |
| Integration/recovery | тот же runner, группа integration | 25/25, 2,524 с |
| Flow | тот же runner, группа flow | **40/40**, 6,278 с |
| Data | тот же runner, группа data | 82/82, 1,129 с |
| Полный HTTP journey | `node dist/scripts/readiness-walkthrough.js` | PASS: **120 операций / 62 экрана**, 2 restart |
| Docker rebuild | `node scripts/readiness-docker-check.mjs` | PASS, **24,143 с**, cache разрешён |
| Docker HTTP journey | тот же runner → `flow-container-smoke.js` | PASS, 55,944 с |
| Docker restart / ожидание health | тот же runner | PASS, 0,686 / 5,182 с |
| Docker чтение/удаление после restart | `flow-container-smoke.js --verify-restart` | PASS, 9,622 с |

Всего **179 уникальных тестов = 40 flow + 82 data + 32 unit/contract + 25 integration/recovery**. Исторические 173 = 34/82/32/25 из 09 относятся к baseline; прирост — шесть flow-regressions. Focused/повтор в Docker не считаются дополнительными тестами. После успешного набора менялись только документация, её упаковка и перенос сгенерированного evidence; runtime повторно не изменялся.

HTTP journey использует настоящий Fastify → inbox → worker → SQLite → renderer → LocalMax. Проверены strict-only, opt-in, известное время кандидата, Back и summary editing, все страницы условий, save/list/delete/re-save **той же identity с новой generation**, отклонение старого удаления, restart, unavailable source и data erasure. Транскрипт [сгенерирован renderer](../evidence/user-readiness/synthetic-transcript.md), не отредактирован вручную. Только случайные коды формы обезличиваются генератором. Часы `2030-04-05T06:00:00.000Z` предназначены исключительно для этого локального прогона. Наблюдений реального клиента и проверки открытия browser links здесь нет.

Docker daemon **29.7.2**, отдельный project `maxbot-readiness-1790250410513`, новый том; существующие БД/тома и `maxbot-g1-local-app-1` не затронуты. Свой контейнер остановлен, том сохранён. Image ID `sha256:fa4f81b6008e8ac4bc4f9b7a6d658e26347cf4cc62a8b8afbd21d4bbe04e8340`; runtime inputs SHA-256 `2053fcdd856d6768c7a50a93420043d0c052dc674bbee3531581ab4eb59e8df6` (методика в runner, это не Git SHA). Образ non-root `node`. Это проверка изменённого image path и поведения, **не финальный clean submission benchmark**.

Не переобъявлены новыми: bounded online backup/restore и offline public Compose/Caddy mount/env checks из [09](09_STAGE4_CORRECTIONS_AND_SMOKE.md). Recovery-код не менялся; четыре существующих regression снова вошли в 25 тестов. Политика карантина/операторского discard сохраняется по [runbook](../RECOVERY_RUNBOOK.md). Live mount/TLS/host не проверены.

## MAX и точная передача оператору

Проверены текущие первичные [GET /me](https://dev.max.ru/docs-api/methods/GET/me), [GET /subscriptions](https://dev.max.ru/docs-api/methods/GET/subscriptions), [GET /updates](https://dev.max.ru/docs-api/methods/GET/updates), [POST /subscriptions](https://dev.max.ru/docs-api/methods/POST/subscriptions), [POST /messages](https://dev.max.ru/docs-api/methods/POST/messages), [POST /answers](https://dev.max.ru/docs-api/methods/POST/answers). Применимые правила и F01–F10 обновлены в [MAX runbook](../EXPLORATORY_MAX_RUNBOOK.md). Read-only inspection не зависит от public deployment. GET /updates допустим для теста без webhook; helper сейчас не нужен и не создан. Доступность polling не выдаётся за проверку production webhook.

Пользователь подтвердил отсутствие токена. Единожды проверена назначенная конфигурация проекта, посторонние credential stores не исследовались. Authenticated вызовов, subscription mutations, deployments, отправок реальным пользователям — **0**. Версии mobile/web и human evidence отсутствуют; **все F01–F10 в обоих клиентах NOT_VERIFIED**, включая ссылки и cross-client continuity. Transport ACK не принят за человеческое наблюдение.

Единая передача: после появления назначенного project bot / защищённого token file / scope оператор запускает `npm.cmd run live:inspect`, сверяет и закрепляет bot ID. Это первый заблокированный шаг; токен в чат не нужен. Для webhook затем нужны существующий конкретно одобренный host/HTTPS endpoint и доступ; они пока не предоставлены. Для UI — согласившиеся mobile/web пользователи (A в двух клиентах, B для изоляции), пока недоступны. Если токен и тестировщики будут готовы без host, применим условный B2 runbook после пустого GET subscriptions, подтверждения отсутствия другого consumer и проверки минимального polling entry point. Новые accounts/hosting/tunnels не создаются.

Для любого живого сеанса создать **новый** synthetic-current JSON фактическим временем, отдельную test DB и ограничить сеанс 15 минутами. Не переносить реальные события в будущее, не ставить исторические часы; provider delivery guards и quarantine остаются включёнными. Публичный показ источников и спрос технический smoke не подтверждает.

## Комплект и публикация кода

[SUBMISSION_READINESS](../SUBMISSION_READINESS.md) — **DRAFT / NOT_SUBMITTED**: продукт, инвентарь по A/R/C, сценарий, содержание PDF, эксплуатационные/приватные решения и оставшаяся сертификация. [DATA-API.draft.yaml](../examples/DATA-API.draft.yaml) содержит девять требуемых групп для имеющихся endpoint; неизвестные значения отмечены null. Предоставленные требования не содержат отдельного официального schema-файла; его отсутствие не использовано для остановки независимой подготовки.

Изменённый набор:

- Runtime: `src/culture/card.ts`, `flow.ts`, `fixture.ts`; `src/data/select.ts`.
- Регрессии: `tests/flow-readiness.test.ts`, актуализирован ожидаемый заголовок в `tests/flow-runtime.test.ts` без ослабления проверки.
- Проверка: `scripts/readiness-checks.mjs`, `readiness-walkthrough.ts`, `readiness-docker-check.mjs`, `flow-container-smoke.ts`.
- Упаковка: `scripts/package-stage4-review.py` с отдельным профилем `--user-readiness`; исторический профиль/архив не заменяется.
- Документы: `README.md`, `docs/EXPLORATORY_MAX_RUNBOOK.md`, действующий `docs/pivot/03_IMPLEMENTATION_PLAN.md`; новые `docs/SUBMISSION_READINESS.md`, `docs/examples/DATA-API.draft.yaml`, эта квитанция и `docs/evidence/user-readiness/{validation.json,synthetic-transcript.md}`.

Исторические receipts, stage4 transcript/validation и пятиэтапная структура сохранены. Проверены относительные ссылки текущих документов, разбор YAML существующим PyYAML, совпадение методов/статусов/обязательных полей с OpenAPI, hash transcript и суммы тестов: PASS. `git diff --check` PASS. Явный publish set проверен упаковщиком и просмотром изменений: 95 файлов, приватных файлов/рабочих секретов не выявлено.

Методические M-01–M-03 использованы по [официальному Codex guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide), [Model guidance](https://developers.openai.com/api/docs/guides/latest-model), [guidance о skills/AGENTS](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra): целевые чтения, завершение разрешённого объёма, соразмерные тесты. Локальные копии не обнаружены, поиск всего компьютера не выполнялся.

Единственный итоговый архив этого задания: `.review/user-readiness-source-review.zip`, создаётся из reviewed commit после проверки явного набора. `REVIEW_INVENTORY.json` внутри фиксирует commit и per-file SHA-256; `SHA256SUMS.txt` также покрывает inventory. Пути, уникальность, ZIP CRC и каждый hash проверяются упаковщиком. Секреты/actual env/БД/backups/provider catalogs/raw MAX/dependencies/tools/private evidence исключены. SHA самого ZIP и результат публикации фиксируются отдельно в `.review/user-readiness/archive-receipt.json` / `publication.json` и финальном ответе: самохешируемого архива или заранее выдуманного commit здесь нет.

До сдачи остаются реальные MAX-наблюдения, конкретный hosting/период доступности, достаточные разрешённые данные и условия их показа, решения оператора/retention, финальные API/PDF/закрытые материалы и clean build. Напоминания, новая кампания данных и публичный выпуск не начаты.
