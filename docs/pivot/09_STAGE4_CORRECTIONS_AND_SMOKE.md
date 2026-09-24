# Этап 4: коррекции source review, recovery и готовность smoke

Дата: 24.09.2026. **MAXBOT_STAGE4_LOCAL_HARDENING_PASS.** Это ограниченный verdict локальной части: полный этап 4 остаётся незавершённым без человеческих mobile/web наблюдений. **REAL_APPLICATION_SMOKE = REQUIRED.** Пользователь прямо подтвердил: live-предпосылок пока нет, подготовить передачу оператору.

| Область | Фактический статус |
|---|---|
| LOCAL_HARDENING | PASS: R08-01/02/03/04, регрессии, настоящий локальный HTTP/SQLite |
| DOCKER | PASS: новая сборка, HTTP/worker, save/restart/remove, offline public Compose preflight |
| BACKUP_RESTORE | PASS: disposable SQLite, consistent backup, quarantine/discard; без обещания RPO/RTO |
| REAL_MAX_MOBILE | NOT_VERIFIED; версии/наблюдения отсутствуют |
| REAL_MAX_WEB | NOT_VERIFIED; версии/наблюдения отсутствуют |
| DATA_SUITABILITY | EXPLORATORY_ONLY; новых provider-данных нет |
| PUBLIC_DISPLAY | NOT_CLEARED; provider delivery guards сохранены |
| GIT | Разрешены reviewed commit/normal push; точные финальные SHA/remote/upstream — в отдельной git-квитанции и итоговом ответе |

## База и границы

Исходный main/HEAD и remote main: `09810558ede26e58ecc182a21b97c99d8ab84cc8`; исходный worktree/index чистые. Единственный origin: `https://github.com/AiratBastanov/HackMaxBot2026.git`, fetch/push одинаковы. Первый sandbox Git запрос завершился Schannel SEC_E_NO_CREDENTIALS; разрешённая проверка вне ограничения подтвердила remote SHA без изменения TLS или credentials. Origin не перенастраивался.

Локальный `exploratory-source-review.zip` имеет сообщённый SHA-256 `bd0bd95570f999856fad58f096146c28f7c87f18e6e7bedd3062d1421c6c04be` — hash независимо проверен. Сообщение о совпадении draft/final source и отличии только плана принято как контекст внешнего review. Его narrow probes с заменённой инфраструктурой не названы полным проектным suite.

Изменения ограничены текущим flow/projection, persistence/recovery, admin/preflight, actual Compose, тестами и текущими документами. Пятиэтапный план, требования/ID/веса, receipts 06–08 и G1 evidence сохранены. «Игра состоится» не возвращалась. Новых dependencies, provider-запросов, ключей, AI/mini-app, напоминаний, coordination и публичной доставки нет.

## Замечания: воспроизведение и исправление

До runtime-исправлений новый `flow-stage4.test.ts` на настоящих HTTP/Fastify/SQLite/worker/transport дал **1 PASS / 7 FAIL из 8**. После коррекции те же восемь проходят. Дополнительно проверены legacy bookmark и timed session. Смена MAX на локальный transport явно маркирована и не означает real-client PASS.

| ID | Проверенный дефект и конечное поведение |
|---|---|
| R08-01 | Strict flexible visit 10–18 / query 12–18 / last entry 17:30 / adult 200 RUB / REQUIRED registration терял venue, lastEntry и admission. Новая именованная visit projection сохраняет точные price/conditions, venue name/address, opening/overlap или session, lastEntry, admission, warnings, source links, observation times и providerUpdatedAt отдельно. Overview сначала показывает необходимые условия; полные поля — через «Все условия» страницами |
| R08-02 | Home → Pick → Custom date → Back раньше включал editing и перескакивал в summary. Отдельный inputBack возвращает к исходному шагу без смены caller context. Все три Back-пути в initial и summary editing проверены; старые actions/typed codes по-прежнему отвергаются |
| R08-03 | Conversation mapping передавал optional interest в hard query.category. Теперь category=null, интерес в preferences.categories; при одинаковых date/time/budget theatre идёт раньше exhibition, обе категории остаются. Hard-category контракт чистого selector не изменён; candidate opt-in сбрасывается |
| R08-04 | Широкое очищение outbox стирало только что созданный culture_answer. Текущий action_key:answer с нейтральным «Принято.» исключён, старые payload очищены и finished_at заполнен. Через обычный worker ACK обработан один раз; semantic success:false становится FAILED_SEMANTIC, не успехом |

Обоснованное уточнение review: Back при **редактировании завершённого запроса** уже правильно возвращал summary (единственный PASS первого набора); этот путь не сломан ради initial entry. Selector уже корректно возвращал lastEntry, а hard category корректно исключал другие категории: исправлены projection и граница диалога. Actual public Compose/Caddy/live-admin находились в Git; их отсутствие в review ZIP не трактовалось как отсутствие проекта.

`src/culture/card.ts` хранит полные source fields, не меняет event/occurrence identity или fingerprint provenance. Поля overview имеют индивидуальные пределы; длинный текст обозначается многоточием и доступен полностью страницами ≤2700 UTF-16 units. Общий экран ограничен 3950 проверкой, финального `slice(0,3950)` нет. Source button label ≤80, URL >2048 не подрезается до другой ссылки: остаётся в полном тексте. Цена 200 ₽ не заменена общим тарифом. API retrieval не называется provider verification. В старой закладке без visit-данных явно указано, что дополнительные поля не сохранялись; новый snapshot не заполняет прошлое выдуманными значениями.

Проверены save/restart с last entry/registration, неизвестный address, длинные валидные fields с маркерами в конце текста, страницы, точный timed session, legacy record, isolated B bookmark, old save/erase/delete после нового состояния, terminal metadata очереди. Стирание не обещает мгновенного удаления истории MAX или старых backup.

## Recovery

[Операторская процедура](../RECOVERY_RUNBOOK.md), `src/recovery.ts`, `scripts/recovery.ts`: SQLite Online Backup API, проверка schema=2 / mode:bot identity / integrity, UTC metadata; новый explicit ignored target, no overwrite. Restore инвалидирует action references, очищает historical queue payload и ставит terminal metadata, помещает восстановленную персонализацию в QUARANTINED. Runtime не стартует на BACKUP/QUARANTINED. Обычный restart неизменённого тома сохраняет закладки; SENDING становится UNKNOWN_RESULT без повторной отправки.

Disposable-пробы покрывают повреждение, другую identity/режим, неизвестную schema, interrupted outbound и обе цепочки backup → пользователь удаляет закладку/данные → loss → старый restore. В старой копии действительно остаётся удалённая позже запись; её видимость заблокирована. При потере subsequent deletions текущая процедура допускает только явный `DISCARD_RESTORED_PERSONALIZATION`, после которого удаляются восстановленные preferences/bookmarks/contacts/probes/queues, отбрасываются события до cutoff, пользователь начинает заново. Разблокировки без сверки в этом инструменте нет.

CLI отдельно исполнена на новой ignored synthetic БД: backup **113 мс**, restore **92 мс**, discard **88 мс** (включая запуск процесса). Metadata: local:777, schema 2, integrity ok, creation `2026-09-24T11:01:39.565Z`. Проверены отказ runtime в карантине и пустые bookmarks после discard. Это измерение маленькой fixture, **не RPO/RTO**. Существующие пользовательские/live DB не открывались для восстановления и не заменялись.

## Фактическая валидация

Закреплённые Node 22.23.2 и lockfile; финальный host suite запущен один раз через `scripts/stage4-checks.mjs`. Новые результаты отдельно от historical **24 flow / 82 data / 29 unit-contract / 21 integration**:

| Проверка | Результат / время |
|---|---|
| Typecheck / build Windows | PASS, 486 / 513 мс |
| Flow HTTP/SQLite | **34/34 PASS**, 6234 мс (24 прежних + 10 stage4) |
| Data | **82/82 PASS**, 1206 мс |
| Unit/contract/admin | **32/32 PASS**, 450 мс (29 прежних + 3 admin) |
| Integration/recovery | **25/25 PASS**, 2470 мс (21 прежний + 4 recovery) |
| Локальный HTTP journey | PASS, 64 transport operations; Back ×3, interest preference, полные условия, save/restart/remove, erase/restart |
| Docker build Linux | PASS, **34,746 с**, cached inputs; это не clean submission benchmark |
| Docker startup / HTTP journey | PASS, 6,209 / 56,068 с; automatic worker, 26 экранов |
| Restart / повтор после готовности | restart 0,758 с; ready 6,077 с; чтение/удаление 10,370 с, 5 экранов |
| Offline public Compose / non-root container preflight | PASS, 113 / 785 мс, только placeholders, сеть отключена |

Всего **173 уникальных теста**. Linux build выполняет тот же набор, не увеличивает число тестов. Во время разработки исправлены TS annotations и порядок закрытия disposable DB перед cleanup; первоначальный recovery test hook ошибался EBUSY, финальные четыре теста проходят. Пакеты параллельно с native SQLite tests не устанавливались.

Первый Docker restart probe стартовал до HTTP readiness и получил `fetch failed`; это не PASS. В harness добавлено ожидание health. Повторены только dependent checks на прежнем собственном томе; сохранившаяся strict bookmark прочитана и удалена. Runtime после сборки не менялся. Дополнительно SHA-256 всех **37 compiled runtime файлов** образа совпали побайтно с проверенным host build. История обеих попыток — в [validation.json](../evidence/stage4/validation.json).

Docker project `maxbot-stage4-1790247184024`, отдельный volume `maxbot-stage4-1790247184024_flow-test-data`; остановлен только test app. Существующий G1 на 127.0.0.1:3000 и прежние volumes не останавливались/не удалялись. Image ID: `sha256:67158f3fbcd084ca874917aa083e42708c0ca77119734c9d0f06581f539d2b97`. Публикуемый [синтетический transcript](../evidence/stage4/synthetic-transcript.md) получен renderer, не написан вручную; реальных catalog/raw MAX в нём нет.

## Contracts, configuration и live handoff

Повторно прочитаны первичные документы 24.09.2026:

- [GET /me](https://dev.max.ru/docs-api/methods/GET/me): identity из токена, int64, Authorization header. ReadOnlyMax и `.env.inspect` не требуют deployment/БД/testers. Runtime ожидает pinned ID и проверяет GET до запуска.
- [GET /subscriptions](https://dev.max.ru/docs-api/methods/GET/subscriptions) и [POST /subscriptions](https://dev.max.ru/docs-api/methods/POST/subscriptions): текущие подписки, HTTPS 443 и trusted TLS, один consumer без совместного Long Polling. Admin сохраняет существующую подписку; перед POST пишет private journal, неоднозначность сверяет GET и блокирует повтор.
- [POST /messages](https://dev.max.ru/docs-api/methods/POST/messages) и [POST /answers](https://dev.max.ru/docs-api/methods/POST/answers): текст до 4000, inline keyboard, notify:false, preview в query; callback notification и success проверяются отдельно. Worker pacing 1,1 секунды сохранён.
- [Update](https://dev.max.ru/docs-api/objects/Update): webhook update types и callback/lifecycle; availability не становится согласием на рассылку.
- [SQLite backup](https://www.sqlite.org/backup.html): consistent Online Backup API, отдельное завершённое snapshot вместо копирования одного live WAL main file.

Actual public Compose теперь передаёт необходимые переменные явно: `--env-file .env.live` для interpolation, cwd против deploy-relative mount sources, container secret paths, fresh synthetic snapshot mount, non-root readability и HOST=0.0.0.0 проверены совместно. Offline preflight не печатал resolved live secrets (их не было), не открывал БД и не вызывал MAX. Real TLS/CA/host mounts остаются проверкой B. Provider guards в renderer/worker/LiveMax и PUBLIC_DISPLAY=NOT_CLEARED сохранены.

**Одна передача оператору:** [runbook A/B/C и F01–F10](../EXPLORATORY_MAX_RUNBOOK.md). Отсутствуют (A) назначенный бот/безопасный credential file и область доступа — блокируют GET identity/subscriptions; (B) конкретный уже одобренный host/endpoint и operator access — блокируют deployment/TLS/registration, не блокируют A; (C) consenting human clients/actions — блокируют mobile/web observations. Рабочие токены/личные данные в чат не запрашиваются. Client/code observations не выдуманы: client versions=null, human evidence отсутствует, все F01–F10 обоих клиентов NOT_VERIFIED. Live-сообщений, подписок и deployment не выполнялось.

M-01–M-03 TXT в workspace отсутствуют. Использован OpenAI Docs skill и записанные официальные [Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide), [Model guidance](https://developers.openai.com/api/docs/guides/latest-model), [Rethinking skills and prompts](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra): целевые чтения, независимые проверки, завершение разрешённого объёма и соразмерные тесты. Поиск всего компьютера, копирование чужих системных prompts и изменение модели не выполнялись.

## Review-пакет, Git и этап 5

Единственный новый финальный архив: `.review/stage4-source-review.zip`; внутри `REVIEW_INVENTORY.json` и `SHA256SUMS.txt`, явный allowlist необходимых source/tests/scripts, безопасных env examples, pinned runtime, конфигурации, relevant docs и synthetic evidence. Payload hashes, безопасные относительные пути и чтение каждого ZIP entry проверяются; inventory/checksum files описывают payload, не хешируют сами себя. Secrets, DB/sidecars/backups, actual env, каталоги/raw events, зависимости/tools/dist и private материалы исключены. Старые review archives не перепаковываются и не являются конкурирующим новым draft.

Перед stage/commit проверяются явные task-owned paths, отсутствие private data и актуальный remote HEAD; normal commit/push без reset/clean/stash/rebase/force. Итоговый commit hash не вписывается в собственный source document: `.review/stage4/git-publication.json` фиксирует SHA/upstream/remote/remaining worktree после публикации, итоговый ответ приводит результат. Git blocker не меняет локальный verdict.

Для завершения этапа 4 необходимы настоящие наблюдения MAX. Для этапа 5 остаются clean submission build benchmark, окончательная runtime/host эксплуатационная проверка, live evidence, организаторский пакет/презентация и политика private backup retention. Data suitability, спрос и разрешение публичного показа не доказаны синтетикой. Пятиэтапный план не изменён. Работа останавливается до напоминаний, нового получения данных и публичного выпуска.
