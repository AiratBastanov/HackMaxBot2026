# 19. Реальные клиенты MAX и локальная подготовка webhook

**25.09.2026 · MAXBOT_REAL_MAX_AND_WEBHOOK_PREPARATION_PARTIAL.** REAL_CATALOG выбран; пять этапов сохранены. Baseline `a72b77aabdbf88da97fb154873e82115a2557865`, main, исходные worktree/index чистые; удалённая main совпала при read-only проверке. Квитанции 16–18 и исторические manifests не изменяются.

## Текущий снимок и перенесённые результаты

Использован активный `536829346bd0a60d3b35`: 26 событий / 32 посещения, Казань и Екатеринбург. Clock до старта: 25.09.2026 12:42 UTC. Локальный query на 26.09 12–18 по зоне города дал 2 strict в Казани и 1 в Екатеринбурге для одного взрослого ≤500 ₽. Для семейного состава с неизвестным возрастом strict нет; uncertain доступен только по явному действию. Событие «Кремлёвские грани…», заканчивающееся 25.09, на завтра не назначалось. Карантин, включая 58328, сохранён; запросов к источникам **0**. Refresh не требовался.

Review Кремля истекает **28.09.2026 12:11:03 МСК**, МИЕ — **12:11:49 МСК**. Перед следующим необходимым обновлением оператор соблюдает прежние 80 запросов / 40 MiB / 15 минут, 20 секунд на запрос и ≥2 секунд между началами на host. Затем review реальных изменений/PREPARED_REAL → activate → контролируемый restart, сохраняя прежние версии. Не назначен конкретный ответственный за обновление на срок оценки.

**SHIPPED_REFRESH_FUNCTIONAL=PASS** переносится из 18. **PACING_LIVE_OBSERVATION=PARTIAL**: исторические 1999 мс остаются отклонением; исправление имеет локальную регрессию, нового live evidence нет. Тариф, current bookmark view, A/B isolation и незатронутые human/automated PASS не переоткрывались. Исторические 245 тестов не считаются новой host-кампанией.

## Реальная сессия U16

Пользователь подтвердил готовность mobile/web; один уже допущенный A, без повторного pairing и ротации. Сохранены pinned Node 22.23.2, credential file, process-scoped CA, expected bot `426717762`, admission A/B, SQLite и cursor. Штатные GET /me и subscriptions подтвердили identity и пустые подписки. Единственный start: **12:42:25.477 UTC**, deadline **13:12:25.477 UTC / 16:12:25 МСК**, ≤120 polling requests; с 16:07 только завершение. Очередь заморожена до старта: U16-A город/состав/местная дата/общий бюджет; U16-B strict/uncertain/условия/source/edit; U16-C save/open/две кнопки/cancel/один tracked cleanup. Полная F01–F10 и изоляция не повторяются.

Ответы сразу записаны в [журнал наблюдений](../evidence/real-webhook/human.md). «Много текста» на развёрнутых условиях WEB сохраняется как UX замечание; открытие экрана не означает безоговорочный PASS удобства чтения. SQL/transport и человеческое наблюдение учтены отдельно.

| Scope | Фактически выполнено | Только оставшийся пробел |
|---|---|---|
| U16-A MOBILE | Город кнопкой; сводка Казань, 26.09, 12–18 Москва UTC+3, 1 взрослый, ≤500 ₽ на всех | Город текстом; семейный состав; ввод/изменение параметров с видимым отказом/возвратом и новым opt-in |
| U16-A WEB | Исходные параметры подтверждены в открытой закладке | Сам ввод параметров в web не наблюдён; общие серверные варианты не дублировать |
| U16-B MOBILE | Два real strict; компактная карточка/цена/условия; источник открылся верно; edit на месте | Явно включённый семейный candidate, полные условия/возврат; «К результатам» |
| U16-B WEB | Та же strict-карточка, условия → карточка и edit на месте | Семейный candidate; source-link; «К результатам»; удобство длинных условий остаётся PARTIAL |
| U16-C WEB | Save/open реального события, ровно две кнопки подтверждения, cancel возвращает закладку | Новая заметность save и сокращение повторов зоны после исправления — HUMAN_NOT_RUN |
| U16-C MOBILE | `/saved` показал новый список | Open/confirm/cancel в mobile; человек не подтвердил исчезновение прежнего tracked экрана |

**REAL_MAX_MOBILE=PARTIAL; REAL_MAX_WEB=PARTIAL; REAL_EDIT=PASS** в указанном API+human scope. **REAL_DELETE_OR_FALLBACK=PARTIAL**: MAX принял один DELETE собственного tracked mid (HTTP 200/success); человек подтвердил только новый список. Refusal не было, fallback не потребовался. Фактически [2 POST messages, 17 answers, 16 PUT, 1 DELETE](../evidence/real-webhook/session.json), 19 принятых updates; лишний старый callback корректно отвергнут, без нового ручного server-test.

**Остановка 13:09:39.494 UTC / 16:09:39 МСК**, 65 зарезервированных polling requests / 64 успешных receipt; последний незавершённый GET прерван. Ctrl+C записал SESSION_STOPPED, PTY завершился с exit 1; затем PID 26328 отсутствует, consumer-lock свободен, pending/sending=0. Успешный exit 0 не заявляется. База, cursor, A/B и snapshot сохранены. После остановки новых MAX-действий не запрашивали, второго start/restart poller нет. Поздний ответ на последнее уже выполненное действие не считается дефектом приложения.

### Два уточнения UI по фактическим замечаниям

R19-UX01: WEB сообщил, что подтверждение сохранения теряется в длинной карточке. Теперь сверху отдельная короткая строка **«✅ СОХРАНЕНО»**, а кнопка меняет подпись на **«✅ Сохранено»**. Повторное нажатие идемпотентно; закладка не превращается в регистрацию.

R19-UX02: WEB заметил дублирование часового пояса в сохранённом представлении. Выбранный интервал теперь объединяет дату/время и одну зону; остальной текст того же экрана использует эту зону без повторов. Состав, budget basis, выбранное время, текущие часы/касса/unknowns и source review сохранены; строка закладки не переписывается. Отдельные карточки по-прежнему показывают свою зону. Исправлено после окончания окна, локально проверено; новых человеческих PASS этим подшагам не присваивается. Общий объём развёрнутых условий остаётся замечанием для дальнейшего UX-решения.

## Один real-webhook профиль

Адаптирован существующий `deploy/compose.public.yaml`, новое приложение/система развёртывания не создавались. Явные live/webhook/real, обязательный HTTPS origin, matching PUBLIC_HOST в preflight. Весь каталог с active.json, versioned snapshot и review — read-only directory mount. Это позволяет атомарную операторскую активацию и чтение нового pointer при контролируемом restart без устаревшего single-file bind.

SQLite `/app/runtime/webhook.sqlite` и journal `/app/runtime/subscription-journal` используют отдельный persistent `webhook-data`, не polling DB. UID 1000, read-only root, read-only secrets, cap_drop ALL, no-new-privileges, tmpfs; проверенный CA при необходимости задаётся только окружению Node-процесса. Нормальный MAX API host и TLS не менялись. Startup делает только GET /me перед БД/портом; не создаёт/удаляет/заменяет subscriptions, не переключается на polling. Глобальный PUBLIC_DISPLAY остаётся NOT_CLEARED.

Preflight проверяет live/webhook/real, secrets, non-root, текущий Catalog/source review, доступность runtime/journal/CA. Непригодный каталог блокирует preflight; обычная runtime-политика сохраняет базовую навигацию и нейтральную недоступную закладку без просроченных фактов. Нельзя обновить старые timestamps ради PASS.

`scripts/webhook-profile-check.mjs` применяет временный disposable override только к этому Compose app. Network none, без host-портов и Caddy; fake credential, искусственный account, отдельные volume/каталог. `webhook-smoke-fetch.ts` — только явно подключаемый test preload, недоступный обычной конфигурации API. Проверяются настоящие index, webhook HTTP handler, worker, SQLite, renderer, LiveMax и source policy. Первая фаза использует ещё действующую историческую review-копию R17, вторая — текущую R18 после атомарной замены pointer и запуска **того же** контейнера. Это проверка mount/restart, не новый refresh/review и не доказательство ingress MAX.

При отладке стенда исправлены два дефекта test tooling: строковый user_id симулятора отвергнут настоящим decoder; повторный message ID после restart правильно дедуплицировался SQLite. Live-приложение ради этих случаев не ослаблено. Диагностические попытки не названы PASS.

### Исполненное evidence

[Container](../evidence/real-webhook/container.json), [validation](../evidence/real-webhook/validation.json): **REAL_WEBHOOK_PROFILE_LOCAL=PASS / LOCAL_INTEGRATION_SMOKE=PASS**, текущая версия `c33b315f…` загружена после `91c27c96…` в том же контейнере и mount. Root/secret/catalog попытки записи отвергнуты, UID 1000; SQLite и sentinel subscription journal пережили restart. На реальном HTTP проверены secret=401, неизвестный actor=ignored, strict/source/save/open/cancel. Missing/corrupt/expired copies блокируют preflight, а runtime сохраняет нейтральные saved/open/delete/cancel/home без фактов. Отдельно отвергнуты missing origin/secret, duplicate token, неверный mode/journal path и identity. Настоящих MAX-запросов из harness **0**, subscription mutations **0**; API override только в test preload. `Caddyfile` разобран `caddy adapt` с fake hostname и network none; server/TLS issuance не запускались.

Host: сначала 20 config/source-policy/admin tests; после реальных замечаний и изменения общего renderer — **81/81** конфигурация/admin/все flow, затем **1/1** затронутый recovery-тест. Первые 20 входят в 81: **82 уникальных host tests**, не 102. Typecheck/build PASS. При typecheck исправлен optional timezone legacy-query через реестр города; в recovery изменено лишь ожидание подписи сохранённой кнопки. Штатный Dockerfile при build сам запускает **224 теста** (32 + 25 + 66 + 101); это повторяемая build-проверка, не дополнительные уникальные тесты и не новая полная 245-test host campaign. Host npm ci не запускался, Docker dependency layer был cached. После документов application tests не повторялись. Финальный clean submission benchmark не выполнялся.

Финальный closed smoke завершился 13:17:09 UTC; app/container/volume удалены, Caddy server не запускался. Все retries имели конкретную причину: диагностика stderr, исправление simulator IDs, две UI-правки и устаревшая подпись в recovery-тесте; исторические/неудачные проверки не переименованы PASS.

## Внешняя передача

Не выполнены hosting/provisioning, TLS issuance, public port exposure, DNS/firewall, subscriptions, новый admission и финальная сдача. Пользователь отдельно подтвердил **UNKNOWN**: host/HTTPS hostname; оператор/способ доступа; начало/конец доступности; процедура доступа проверяющих; ответственный за refresh. Выбор, стоимость, ответственность и deployment authorization будут согласованы отдельно. Это не новый tester READY; credentials/admission сохранены, повторных запросов о missing inputs не требуется.

Минимум для будущего host: один постоянный Linux Docker/Compose app (закреплённая Node 22.23.2/native SQLite среда), persistent storage DB/WAL/journal, читаемые UID 1000 read-only secrets/catalog, доверенный HTTPS:443 и исходящий TLS к MAX, отсутствие сна весь согласованный период. Для существующего Caddy нужны предусмотренные 80/443; управляемый TLS провайдера допустим после небольшой согласованной адаптации proxy. Платный собственный домен не обязателен. Ресурсы/RPO/RTO и финальный benchmark не выдумываются.

Узкий review минимальных фактов учреждений — внутреннее решение проекта, не выданная провайдером лицензия. Он не открывает данные всем MAX-пользователям; ограничения KudaGo/PRO не блокируют независимо полученные institutional facts в прежнем ADMITTED_TESTERS_FACTS scope.

Будущий cutover остаётся: остановить owned poller → проверить identity/subscriptions → развернуть согласованный профиль → проверить HTTPS/health → явно один раз зарегистрировать designated webhook → наблюдать реальный ingress и ответ. Эта задача его не выполняет. [Readiness](../SUBMISSION_READINESS.md) и [runbook B](../EXPLORATORY_MAX_RUNBOOK.md#b-одобренные-test-hostendpoint-и-регистрация) остаются единственной передачей; отдельного master plan нет.

**SOURCE_DISPLAY_SCOPE=ADMITTED_TESTERS_FACTS; PUBLIC_WEBHOOK_INGRESS=NOT_VERIFIED; DEPLOYMENT=NOT_RUN; REAL_APPLICATION_SMOKE=REQUIRED.** Отсутствующие human-наблюдения не понижают завершённую локальную подготовку и не являются app FAIL.

## Публикация delta

Только явные task-owned paths плюс безопасные входы. Архив `.review/real-max-and-webhook-preparation-delta.zip`: baseline, inventory, SHA-256, CRC; сборщик `scripts/package-webhook-review.py` читает уже созданный reviewed commit. Это delta поверх R18, не новый полный source archive. Исключены actual env/secrets/CA/DB, raw pages/events, персональные данные, зависимости и tools. Итоговые commit/remote SHA и hash архива хранятся в ignored `.review/real-webhook-r19/`, чтобы не создавать рекурсивный hash внутри собственного commit. После финального container smoke менялись только документы и сканер архива: исправлено совпадение его private-key шаблона с собственным исходником. Container sourceVersion относится к manifest на момент build; runtime/тесты после него не менялись, из-за упаковки application tests не повторялись.

Сообщённый пользователем внешний review R18: archive SHA-256 `475d086208ac1de233262a15579c9f2d504dc0d4f906f10f76c900ec778b04c4`, 32 payload + 4 review файла; inventory/hashes/CRC совпали. Он просмотрел код/тесты, но не запускал 245-test suite/MAX и не проверял remote branch. Эта внешняя граница сохранена; remote main для текущей работы проверена отдельно.

## Методика

Контракты [GET /updates](https://dev.max.ru/docs-api/methods/GET/updates), [PUT /messages](https://dev.max.ru/docs-api/methods/PUT/messages), [DELETE /messages](https://dev.max.ru/docs-api/methods/DELETE/messages), [POST /subscriptions](https://dev.max.ru/docs-api/methods/POST/subscriptions) прочитаны 25.09.2026: тестовый polling без webhook, собственные edit/delete, rate limits, HTTPS:443/secret/ACK и отдельная регистрация. API ACK не называется чтением человеком.

Локальные TXT M-01–M-03 отсутствуют. Через OpenAI Docs прочитаны официальные [Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide), [Model guidance](https://developers.openai.com/api/docs/guides/latest-model), [Rethinking skills and prompts](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra). Применены контекстные чтения, завершение независимой работы и соразмерная проверка; настройки модели/примерные инструкции не переносились в проект.
