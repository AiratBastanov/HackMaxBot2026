# Первое подключение MAX с подтверждённой авторизацией: тестовый polling

**24.09.2026 · MAXBOT_FIRST_MAX_SESSION_PARTIAL.** Авторизация и ограниченный polling проверены на настоящем MAX. Человек подтвердил web-меню/strict/полные условия/save/open, mobile continuity/удаление, candidate mobile→web с неопределённостью, пустой список после erasure и возвраты к подбору. Полный mobile/web smoke не завершён. Все процессы сеансов остановлены, тестовая БД и cursor сохранены. Исходный HEAD `a6ba679c1080f5d42c761951740655d514369ae4`, ветка main, origin `https://github.com/AiratBastanov/HackMaxBot2026.git`. В начале index/worktree чистые; read-only remote main подтвердил тот же SHA. Исторические квитанции 06–10, manifests и архивы сохранены. SHA-256 прежнего `user-readiness-source-review.zip` повторно совпал с `652c653542b8785be601ff1bbbb2e366eaf1ce89efbd84247369168f67eacbfb`; его содержимое не переписывалось.

| Граница | Факт |
|---|---|
| LOCAL_POLLING_IMPLEMENTATION | PASS: test-only runner, 21 новый тест, локальный HTTP E2E |
| BOT_API_INSPECTION | PASS: GET /me и /subscriptions успешны, bot ID pinned, subscriptions=0 |
| REAL_MAX_MOBILE | PARTIAL: A увидел сохранённую в web карточку после restart, удалил её, включил кандидатов и сохранил вариант с неизвестной ценой |
| REAL_MAX_WEB | PARTIAL: A подтвердил меню, strict/полные условия/save/open и сохранённую в mobile карточку кандидата с неопределённостью |
| WEBHOOK_INGRESS | NOT_VERIFIED: доставка из MAX не проверялась |
| PUBLIC_DEPLOYMENT | NOT_VERIFIED / NOT_DEPLOYED |
| DATA_SUITABILITY | EXPLORATORY_ONLY |
| PUBLIC_DISPLAY | NOT_CLEARED |
| REAL_APPLICATION_SMOKE | REQUIRED |

## Credential и identity

Назначен только `secrets/max_bot_token`. До любого чтения проверены: Git ignore/untracked, Docker allowlist с исключением secrets, source-only review allowlist. Первоначальный CREDENTIAL_LOCAL_SETUP_OR_ROTATION_PENDING устранён: оператор локально сохранил replacement и явно подтвердил ротацию. Флаги отражают это подтверждение; успешный /me доказывает действительность текущей авторизации, **не** отзыв старого credential. Автоматическая ротация/ревокация не выполнялась. Секрет из переписки не использован и в материалы не переносился.

`.env.inspect` создан из фактического безопасного example с уже разрешённым scope=true; `.env.polling` — из нового example. Существующие файлы не перезаписываются. Ротация и exclusive consumer по умолчанию false; в назначенной локальной конфигурации выставлены true только после отдельных ответов оператора. `live:inspect` читает секрет внутри приложения, не требует SQLite/host/tester IDs и использует только GET /me → GET /subscriptions. Успех каждого шага сохраняется отдельно в ignored `runtime/max-test/inspection.json`.

**2026-09-24T13:28:45.654Z:** GET /me PASS: имя **«Хакатон МАХ 432»**, ID **`426717762`**, username **`t432_hakaton_max_bot`**, [проверенная ссылка](https://max.ru/t432_hakaton_max_bot). GET /subscriptions PASS, **0 подписок**. Bot ID сохранён lossless string и закреплён в обеих локальных конфигурациях. Никаких subscription/profile mutations. При startup pairing эти GET повторно прошли с pinned ID.

После успешного `/me` добавляется pin в `.env.inspect`/`.env.polling`, если он отсутствует; имеющийся pin в них или `.env.live` проверяется до записи и никогда автоматически не заменяется. Существующая подписка только подсчитывается, её URL/secret не выводятся. Любая подписка останавливает polling; удаления/регистрации/изменения профиля в этом пути нет. Пустые subscriptions не доказывают отсутствие удалённого poller: необходимо отдельное подтверждение оператора.

## Исполняемый путь

Команды выполняются из корня в foreground PowerShell. Первый запуск:

```powershell
npm.cmd run build
npm.cmd run live:prepare
# На этой машине официальный CA подключается только к текущему процессу:
$env:NODE_EXTRA_CA_CERTS = (Resolve-Path secrets/max-official-root.pem).Path
# Сохранить заменённый credential только в secrets/max_bot_token.
# В .env.inspect поставить MAX_CREDENTIAL_ROTATION_CONFIRMED=true после ротации.
npm.cmd run live:inspect
# Убедиться, что inspect вернул ожидаемого бота и subscriptions=EMPTY.
# В .env.polling: MAX_CREDENTIAL_ROTATION_CONFIRMED=true.
# LIVE_EXCLUSIVE_CONSUMER_CONFIRMED=true только после проверки всех мест запуска.
```

Если числовой ID согласившегося A известен, записать его в `PROBE_TESTER_IDS` файла `.env.polling`. Телефон, username и bot ID не подходят. Если ID неизвестен:

```powershell
npm.cmd run live:poll -- pair
```

В отдельном локальном терминале после `READY_FOR_PAIRING` появится `/pair <случайный код>`. Передать эту строку только предполагаемому A; он отправляет её проверенному боту. Окно ≤2 минут, код 128 бит, одноразовый. `/start`, другой код, чужой тип/чат и просроченный код не допускают человека. После получения оператор лично сверяет, кто отправил код, и вводит **ПОДТВЕРЖДАЮ** в том же терминале. До этого product flow и исходящие сообщения отключены. Сохраняется только bot ID + actor ID в ignored `runtime/max-test/testers.json`; профили и код не сохраняются. Повторный pair нужен только для отдельно согласившегося B, до начала основной кампании. A достаточно для начала; B нужен только для F09.

```powershell
npm.cmd run live:poll -- start
# После READY_FOR_TESTER_ACTION: /start в MAX.
# Ctrl+C останавливает только foreground process; БД/cursor остаются.
npm.cmd run live:poll -- resume
# Только по явному выбору оператора, для НОВОГО сеанса:
npm.cmd run live:poll -- start --minutes 30
```

`start` по умолчанию ограничен 15 минутами. После отдельной просьбы пользователя увеличить окно из-за задержек добавлен явный `start --minutes 30`; другие значения запрещены, pairing по-прежнему ≤2 минут. `resume` применяется для F10 внутри первоначального deadline/120 запросов и никогда не продлевает их; новый `start` в этом интервале отвергается. Нельзя удалять БД/meta или менять snapshot для обхода лимитов. После истечения кампании отдельный явно начатый сеанс может использовать ту же БД и cursor. Если снимку больше часа, создать **новый** файл и изменить только DATA_SNAPSHOT_PATH:

```powershell
node dist/scripts/prepare-flow-fixture.js --synthetic-current runtime/max-test/synthetic-next.json
```

Снимок создаётся фактическими часами и содержит вымышленные события; реальные event dates не переносятся. `live:prepare` не обновляет старый файл и не заменяет пользовательскую конфигурацию. Если прежний inspection предшествовал созданию `.env.polling`, повторить `live:inspect` для pin. Контакты тестировщиков не означают согласие на уведомления.

## Гарантии и ограничения

- `APP_MODE=live`, `APP_INGRESS=test-polling`; обязательны pin, synthetic-test/current catalog, PUBLIC_DISPLAY=NOT_CLEARED и dedicated `runtime/max-test/<bot-id>.sqlite`. Public origin/webhook secret не требуются и отвергаются. Обычный `npm start` отвергает такой ingress; runner не создаёт Fastify receiver. Общие decoder/admission/inbox/worker/renderer/SQLite/MAX transport используются напрямую, без поддельного HTTP webhook.
- Production webhook config сохраняет обязательные secret/public origin. Identity SQLite разделяет `test-polling:<bot>` и прежние `local:<bot>`/`live:<bot>`; recovery quarantine и UNKNOWN_RESULT после прерванной отправки сохраняются. Старые базы не сбрасываются.
- OS mutex на детерминированном **loopback** TCP-порту действует между cooperating polling и обновлённым live webhook entry point, даже при другом cwd/DB. Он не принимает HTTP/данные, не публикуется наружу, освобождается ОС после crash. Коллизия порта приводит к отказу. Это не обнаружение чужого кода, старой версии, другого сетевого namespace/контейнера или другой машины; подтверждение оператора остаётся обязательным.
- GET /updates: limit=10, timeout=30 с, deadline=35 с с учётом чтения тела; обычный POST остаётся 5 с (конфигурация допускает 0,1–10 с). Максимум ответа 256 KiB, lossless JSON, ограничены структура и размер batch. Редиректы запрещены, токен только в Authorization, TLS не ослаблен. Официальный CA подключён только к процессу; Windows trust store не изменялся.
- Marker — непрозрачная int64-лексема, а не JS number и не локальный счётчик. Весь batch декодируется до записи; принятые события и следующий marker фиксируются одной SQLite-транзакцией. Ошибка parse/commit не продвигает cursor. Crash после commit возобновляется с него, delivery keys подавляют дубликаты. Корректные нерелевантные события/non-testers игнорируются; повреждённый relevant event останавливает batch целиком.
- Отсутствующий/null marker в запросе означает **только latest**, не историю. Первый bootstrap использует timeout=0; `READY_FOR_TESTER_ACTION` выдаётся после первого успешного commit. Пустой initial response без marker разрешён. Непустой batch без next marker или null после закреплённого cursor останавливается без сброса/продвижения. Полная история доставки не обещается.
- Worker асинхронен относительно long poll. На каждый цикл повторяется GET /subscriptions. Не более 120 polling requests и 15 минут от start по умолчанию; явно выбранное окно 30 минут не увеличивает число запросов. Не чаще 1/с. Попытка резервируется до сети; deadline, счётчик, rate-limit delay и ошибки переживают restart. Respect Retry-After; до трёх последовательных retryable ошибок. AUTH/permission, webhook conflict, malformed/commit failure и три одинаковые ошибки отправки останавливают путь. Ctrl+C/deadline отменяют сеть; неоднозначный POST не переотправляется автоматически. Никаких background service/autorun.
- Сохранённый allowlist допускает только согласившихся пользователей; worker дополнительно подавляет очередь исключённого tester. Provider delivery guards renderer/worker/transport и quarantine сохранены. Сопряжение — отдельная операторская процедура, не регистрация продукта.

## Проверки и реальные наблюдения

Измеренные результаты: [validation.json](../evidence/first-max-session/validation.json). На итоговом коде и закреплённом **Node 22.23.2** typecheck/build и **118 уникальных тестов PASS = 21 polling + 32 unit/contract + 25 integration/recovery + 40 flow**. Предыдущий успешный запуск оказался на системном Node 22.20; после обнаружения расхождения тот же ограниченный набор повторён на уже установленной закреплённой версии, без новых зависимостей. После просьбы увеличить окно добавлен один тест явного 30-минутного start с прежним лимитом 120 запросов и неизменяемым deadline при resume; итоговый набор повторён на изменённом коде. Повтор не увеличивает число уникальных тестов. Исторические **179 = 40 + 82 + 32 + 25** из 10 остаются историей; 82 data-теста отдельно на host не повторялись. Docker rebuild PASS **33,144 с**: существующий Dockerfile выполнил 179 тестов; это проверка совместимости изменённых общих runtime-модулей, не clean submission benchmark. Образ `maxbot-first-max-session:review`, identity в validation.json; контейнер не запускался. Последующая опция длительности касается только test CLI и не меняет исполняемый webhook runtime образа; Docker ради неё не пересобирался. Первые два живых сеанса выполнялись на Node 22.20, новый 30-минутный — на 22.23.2.

Новые проверки покрывают int64 > MAX_SAFE_INTEGER, nullable cursor, duplicate/empty, atomic rollback/reopen, неверного бота/webhook/consumer, процессный mutex, медленный успешный GET при коротком POST timeout, abort/stream/body bounds, частоту/Retry-After/бюджеты, pairing/expiry/replay/confirmation, provider guard, конфигурацию и recovery. Локальный E2E использует настоящий loopback HTTP endpoint → decoder/admission → SQLite/worker → culture renderer → имитированный MAX HTTP. Пройдено /start → завтра/время/бюджет/театр → strict/полные условия → save/open/remove → opt-in/candidate/save → restart/список → /delete_data/подтверждение → два /saved с пустым списком без повторного подтверждения. Последние assertions добавлены после сообщения тестировщика; typecheck/build и 21/21 polling повторно PASS в 14:31:59 UTC, runtime не менялся, число уникальных тестов не увеличилось. Ответ worker приходит даже при ожидающем следующем GET. [Вывод renderer](../evidence/first-max-session/synthetic-transcript.md) полностью синтетический; это **не real-client PASS**.

Во время разработки исправлены тестовые cleanup-order на Windows и неверное имя кнопки тестового драйвера; продуктовая кнопка «К карточке» сохранена. Дополнительно при review остановка по ошибке исходящей авторизации связана с отменой ожидающего long poll; повторяющиеся send errors сохраняются в campaign. Assertions не удалялись.

Реальные /me и /subscriptions успешны; /updates в явно начатом pairing-сеансе также возвращает валидные события. Отдельные evidence-уровни runner: `poll_api_receipt`, `poll_commit`, `inbox_processed`, `messages/answers MAX_ACCEPTED`; человеческое наблюдение записывается отдельно. API success не равен увиденному экрану. Mobile OS/app version и web browser/version ещё не получены.

Первый authenticated GET остановился **до HTTP-ответа** из-за `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. Дальнейшая диагностика без credential подтвердила необходимость CA. URL корневого сертификата подтверждён [официальной документацией Сбера](https://developers.sber.ru/docs/ru/salutespeech/quick-start/certificates), которая ссылается на Госуслуги/gu-st.ru. Получены по проверенному HTTPS [DER](https://gu-st.ru/content/Other/doc/russian_trusted_root_ca.cer) и [PEM](https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt), проверены их одинаковый fingerprint, CA=true, self-signature и срок 2022-03-01–2032-02-27. SHA-256 certificate DER: `D26D2D0231B7C39F92CC738512BA54103519E4405D68B5BD703E9788CA8ECF31`. Файл `secrets/max-official-root.pem` ignored; TLS bypass из сторонних примеров не применялся. NODE_EXTRA_CA_CERTS задаётся **до Node startup**, в окружении PowerShell: вариант только в --env-file не работает, проверен без credential. С CA unauthenticated /me вернул ожидаемый 401, затем отдельный credential-bearing `live:inspect` прошёл успешно.

| Проверки | Mobile | Web | Оставшееся действие |
|---|---|---|---|
| F01 | NOT_VERIFIED | PARTIAL: меню PASS | A подтвердил Подобрать / Мои события / О данных в web; маркировка и версия отдельно не подтверждены |
| F02 | Клиент последнего прохода не уточнён | PARTIAL: обычный путь подтверждён | A прошёл Другая дата/Назад, Другое время/Назад, Другая сумма/Назад и подтвердил итоговый выбор интереса; отдельное повторение в обоих клиентах не доказано |
| F03 | PARTIAL: opt-in/мастерская подтверждены | PARTIAL: strict-группа видна | A подтвердил отдельную группу кандидатов, время 12–18 и неизвестный взрослый тариф в mobile; весь порядок/исключение дорогого зала отдельно не подтверждены |
| F04 | PARTIAL: карточка видна | PARTIAL | В web A подтвердил вымышленный адрес, билет 200 ₽, часы 10–18, последний вход 17:30 и регистрацию в полных условиях; внешняя ссылка не проверена |
| F05 | PARTIAL | PARTIAL | Strict сохранён/открыт в web и увиден в mobile тем же A после restart; candidate сохранён в mobile и открыт в web с пометкой неопределённости |
| F06–F07 | NOT_VERIFIED | NOT_VERIFIED | Edit/opt-in reset, custom/старые коды; API-отказ старых действий не равен human PASS |
| F08 | PARTIAL: удаление подтверждено | PARTIAL: /delete_data выполнен по заданию | Пустой ответ /saved после erasure подтверждён точным текстом A, клиент этого ответа пока не уточнён; re-save/старые подтверждения ещё проверить |
| F09 | NOT_VERIFIED | NOT_VERIFIED | Отдельно согласившийся B; его отсутствие не блокирует A |
| F10 | PARTIAL | PARTIAL (технический restart) | Кампания/закладка сохранены, карточка после restart видна A в mobile. Удаление подтверждено уже в отдельном сеансе; /probe не проверен |

Точные expected F01–F10 сохранены в [runbook](../EXPLORATORY_MAX_RUNBOOK.md). A явно подтвердил готовность, прошёл одноразовое сопряжение и дал отдельное подтверждение допуска. Первая попытка сопряжения истекла до подтверждения, ID не был сохранён; повтор выполнен с новым кодом, без продления/повтора старого. Основная кампания: **13:36:15.497–13:51:15.519 UTC** (16:36–16:51 МСК), **46 зарезервированных GET /updates**, 44 успешных ответа/commit; две прерванные попытки — при restart и deadline. Приняты 22 события: 20 FLOW_ACCEPTED и 2 FLOW_ACTION_EXPIRED_OR_FOREIGN. MAX принял 20 POST /messages и 21 POST /answers; все 41 outbox записи ACKNOWLEDGED, poll errors=0. В **13:38:21 UTC** впервые received → committed → FLOW_ACCEPTED → POST /messages MAX_ACCEPTED; позднее A отдельно подтвердил web-экраны. Эти числа не доказывают прочтение сообщений.

Контролируемый restart выполнен только для проверенного владельца test mutex: переданный через инструмент Ctrl+C не завершил Windows ConPTY-процесс, Stop-Process вернул ошибку PowerShell; после повторной проверки PID/имени/времени запуска применён taskkill только к этому PID, без дерева процессов. `resume` вернул READY **13:49:16.427 UTC**. Сверка SQLite подтвердила прежние campaign ID/deadline и одну закладку; зарезервированные запросы продолжились, cursor остался сохранён. БД не удалялась. Точное значение cursor до самого kill отдельно не снималось, поэтому его побайтовая неизменность в этом реальном restart не заявляется; атомарность/точное восстановление воспроизводимо проверены offline.

В **13:51:15.519 UTC** автоматический deadline отменил ожидающий GET, процесс завершился с exit 0; mutex больше не слушает. Фонового poller нет. Dedicated DB/cursor сохранены, в конце одна закладка. Обезличенные технические итоги, private human observations и restart-сверка лежат в ignored `.review/first-max-session/`, сессионный журнал — ignored `runtime/max-test/`. Эти файлы не включаются в review archive. Скриншоты/версии клиентов не предоставлены. Общий PASS возможен только после запланированных реальных mobile/web наблюдений; полная cross-user isolation без B не сертифицируется.

После сообщения A «удаление не отвечает» проведён отдельный целевой follow-up с той же БД, cursor и допуском A: READY **13:57:25.526 UTC**. При возобновлении получены десять накопившихся действий, первое с MAX timestamp **13:51:25.500 UTC**, то есть после остановки первой кампании. Одно принято, девять повторных действий безопасно отвергнуты как старые; silent cursor reset не применялся. Свежий путь «Мои события → Открыть 1 → Удалить закладку → Да, удалить» прошёл: SQLite показала **0 закладок**, outgoing queue пустая, **A отдельно подтвердил, что всё удалилось в mobile**. Дефект удаления не воспроизведён; прежнее отсутствие ответа объясняется временем отключённого test runtime. Новая кампания имеет собственный deadline 14:12:25 UTC; это отдельное исследование сообщения о сбое после завершения первой, не сброс лимитов при restart.

В этой же кампании запрошена проверка opt-in/candidate/save в mobile и открытия в web. MAX принял список с отдельной группой и карточку кандидата; на момент завершения этой кампании человеческого подтверждения ещё не было. После перехода в главное меню/список три старых действия получили FLOW_ACTION_EXPIRED_OR_FOREIGN; сохранение кандидата в этой попытке не подтверждено. Повтор на свежих кнопках выполнен в следующем явно начатом сеансе ниже. B не предоставлен; F09 не проверен.

Follow-up остановлен оператором **14:10:50.470 UTC**, спустя 13 мин 25 с и до собственного deadline, только после проверки владельца mutex/PID/времени старта. Завершён ровно task-owned Node; фоновой службы нет, mutex освобождён. Итог: **46 зарезервированных polling requests, 44 успешных ответа/commit**, один TRANSPORT_AMBIGUOUS с успешным ограниченным повтором и один GET прерван при остановке; 35 принятых событий (23 FLOW_ACCEPTED, 12 старых действий), **23 messages + 35 answers MAX_ACCEPTED**. В конце 0 закладок, 0 PENDING/SENDING; DB/cursor сохранены. Эта остановка — принудительное завершение собственного процесса, не проверка SIGINT. Приватные итоги — `followup-summary.json`, `followup-stop.json` и `delete-diagnostic.json` в ignored `.review/first-max-session/`.

После остановки follow-up пользователь отдельно попросил увеличить время проверки из-за задержек. Это изменило первоначальное ограничение длительности для нового явно начатого сеанса: start **14:14:38.552 UTC**, deadline **14:44:38.552 UTC**, ≤30 минут, прежние ≤120 polling requests. Предыдущая кампания и её счётчик не продлевались при restart. Перед новым start создан отдельный свежий synthetic-current снимок по фактическим часам; DB/cursor/tester admission сохранены, identity/subscriptions вновь проверены.

В этом окне A подтвердил шаги с отдельной группой кандидатов, мастерской, известным временем 12–18 и неизвестным взрослым тарифом в mobile; сохранённая карточка открылась в web с прежней неопределённостью. После `/delete_data` A сообщил, что `/saved` вновь просит подтверждение. Проверены отдельно: успешное erasure/0 закладок в SQLite; обработка повторных `/saved`; ACKNOWLEDGED исходящих ответов; содержимое **двух собственных известных сообщений**, прочитанных через [GET /messages/{messageId}](https://dev.max.ru/docs-api/methods/GET/messages/-messageId-). В 14:33:44.318 UTC MAX вернул тот же текст пустого списка и те же кнопки, sender/recipient совпали с pinned bot и допущенным A; обход чужих чатов/истории не выполнялся. Локальный E2E этого перехода также PASS.

Затем A прислал точный видимый текст: «Закладок пока нет», кнопки «Удалить мои данные» и «Главная». Это обычный пустой список; кнопок подтверждения «Да, удалить» / «Да, удалить мои данные» на нём нет. Сообщённое расхождение разрешено по человеческому наблюдению, изменения runtime для его маскировки не делались. Первоначальная интерпретация не считается подтверждённым дефектом. Проверка содержимого MAX сама по себе не подменяет клиентское наблюдение; версии клиентов и скриншоты не получены.

В конце A выполнил переходы «Другая дата → Назад → Завтра», «Другое время → Назад → 12:00–18:00», «Другая сумма → Назад → До 500 ₽» и подтвердил ожидаемый выбор «Любой / Выставки / Театр». Это человеческое наблюдение возвратов F02. В ответе не указан клиент последнего прохода и пустого списка; двойной mobile/web PASS из него не выводится. Остаются edit/opt-in reset, проверки ошибочного/устаревшего кода ввода, повторное сохранение со старым подтверждением, внешняя illustrative ссылка и /probe; полный F09 требует отдельно согласившегося B.

Последнее окно автоматически остановилось **14:44:38.561 UTC (17:44:38 МСК), exit 0**. Итог: **81 зарезервированный GET /updates, 80 успешных ответов/commit**, последний ожидающий GET отменён по deadline; **34 принятых события, 34 FLOW_ACCEPTED, 34 messages + 23 answers MAX_ACCEPTED**, poll errors=0. В конце 0 закладок, 0 PENDING/SENDING; marker сохранён, mutex освобождён. Проверка в 14:45:31 UTC подтвердила отсутствие владельца mutex. Фонового poller/автозапуска нет. Технический итог — ignored `.review/first-max-session/extended-summary.json`; точные человеческие наблюдения отдельно в `human-observations.json`, проверка двух сообщений — `max-stored-screen-check.json`. Частные файлы не публикуются. Для нового сеанса A уже допущен; нужны свежий synthetic-current при возрасте снимка >1 часа и явный foreground `start`, действия после READY.

## Источники и публикация

24.09.2026 проверены текущие первичные контракты [GET /me](https://dev.max.ru/docs-api/methods/GET/me), [GET /subscriptions](https://dev.max.ru/docs-api/methods/GET/subscriptions), [GET /updates](https://dev.max.ru/docs-api/methods/GET/updates), [Update](https://dev.max.ru/docs-api/objects/Update), [POST /messages](https://dev.max.ru/docs-api/methods/POST/messages), [POST /answers](https://dev.max.ru/docs-api/methods/POST/answers). Test polling допустим без webhook; production остаётся webhook. M-01–M-03 применены по официальным [Codex guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide), [Model guidance](https://developers.openai.com/api/docs/guides/latest-model), [skills/prompts](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra): целевые чтения, завершение разрешённой работы, соразмерные проверки. Использован OpenAI Docs skill; локальных TXT-копий нет, настройки модели не менялись.

Один новый sanitized review archive: `.review/first-max-session-source-review.zip`; упаковщик `scripts/package-first-max-review.py`. Внутри source/tests/scripts/safe examples/relevant docs/synthetic evidence, REVIEW_INVENTORY.json с commit и per-file SHA-256, SHA256SUMS.txt; ZIP CRC, inventory и hashes проверяются после создания. Credential/env, pairing codes, реальные tester IDs, DB/sidecars/backups, raw MAX/provider data, зависимости/tools и private observations исключены. Внешние hash/commit/push results — `.review/first-max-session/archive-receipt.json` и `publication.json`, без самохеширования архива.

К сдаче остаются REAL_APPLICATION_SMOKE, production webhook/hosting/период доступности, допустимость и достаточность настоящих данных, пользовательские документы/retention, итоговый API/PDF/закрытые материалы и финальная clean-сборка. Пятиэтапная структура не меняется; новый hosting, provider publication, напоминания, AI, mini-app и сдача не выполнялись.
