# Проверка поставки: запуск, порядок сообщений и редактируемая презентация

27.09.2026. Исходный HEAD и удалённый `main`: `bb9d6fa0d5f943906abe7e8be80ef742f87f6cf1`. Работающее исправление запуска сохранено: обычные запросы 5000 мс, отдельный polling deadline 35000 мс, CA передаётся Node до старта. Прежние гипотезы о причинах timeout не использованы как доказанные факты.

## Приложение

Общая публикация использует нормализованный тип события: сообщение пользователя (включая город, команды, форму и её ошибку) → новый POST; callback → редактирование текущего экрана. В durable payload перед сетью фиксируется mid предшественника. Только после проверенного создания новая identity экрана принимается вместе с очередью очистки в одной транзакции. Устаревшие поколения, чужие цели и повторённый mid не получают право перезаписать/удалить новый экран. Подтверждённый POST сохраняется и при ожидающем inbox: следующий вход может оказаться игнорируемым.

Неопределённый POST не повторяется автоматически и не удаляет прежний экран. При отказе DELETE снимается старая клавиатура; неуспех очистки не блокирует новый ответ. Exactly-once remote creation не заявляется. PUBLIC, source-specific display, strict/candidate, личные закладки, нейтральное подтверждение удаления данных и generation fencing сохранены.

Проверки Node 22.23.2, exit 0:
- TypeScript `tsc --noEmit` и `tsc`; Docker дополнительно выполнил `npm run typecheck && npm run build`.
- `node --test --test-timeout=20000 dist/tests/config.test.js dist/tests/contracts.test.js dist/tests/polling.test.js dist/tests/flow-*.test.js dist/tests/public-access.test.js dist/tests/integration.test.js dist/tests/recovery.test.js`: **172 теста**.
- Финальная узкая правка очищает унаследованный mid при смене диалога. Повторены только `flow-publication.test.js` и `flow-screens.test.js`: **24/24**, включая два добавленных случая смены диалога и позднего POST. Всего 174 различных теста; прежняя полная группа повторно не запускалась.

Причина охвата общих flow/ownership/source/recovery тестов — изменение единой публикации и принятия результата outbox. После правок только README/PPTX приложение повторно не тестировалось.

## Чистая установка

Кандидат: `.review/organizer-ready/candidate`, создан командой `python scripts/organizer-package.py --stage .review/organizer-ready/candidate`. Он содержит поставляемые файлы и текущие исправления; `.git`, `.tools`, `node_modules`, рабочие env/сертификат/БД не копировались. Контрольная сумма списка 132 файлов приложения, тестов, каталога и запуска: **`841caada863030e7cad1061ba70eddf3b5037daa29ebcb6e2b8c1e349c0d9d5d`**. Список сохранён в `.review/organizer-ready/candidate-application.sha256`; версия окончательного комплекта фиксируется отдельно в `VERSION.json` и полном `MANIFEST.sha256`.

Для демо заданы `COMPOSE_PROJECT_NAME=cultural-plan-review-0927-c18d`, `DEMO_PORT=33027`, `CULTURAL_PLAN_IMAGE=cultural-plan:review-0927-c18d`. Docker Compose v5.5.1. Финальный старт выполнен с пустым одноразовым томом после стабилизации кода; использовался обычный кеш сборки.

| Выполненная команда / шаг | Exit / результат |
|---|---|
| `docker compose up --build -d --wait` | 0; `healthy`, localhost:33027 |
| `docker compose ps` | 0; только сервис кандидата |
| `docker compose exec app node dist/scripts/organizer-check.js` | 0; новый PUBLIC actor, подбор, save/open, secret/dedup, `SIMULATED_MAX` |
| `docker compose restart` | 0 |
| `docker compose exec app node dist/scripts/organizer-check.js --restart` | 0; та же тестовая закладка сохранилась |
| `docker compose exec app node dist/scripts/runtime-info.js` | 0; UID 1000, Node v22.23.2, SQLite 3.53.4 |
| `docker compose down`; проверка именованного тома | 0; контейнер остановлен, `demo-data` сохранён |

Подключение проверено в проектах `cultural-plan-setup-0927-c18d` и `cultural-plan-polling-review-0927-c18d`. В новой папке secrets создан **синтетический** токен симулятора; настоящие credentials не читались и не копировались.

| Выполненная команда / шаг | Exit / результат |
|---|---|
| `docker compose -f compose.setup.yaml run --build --rm setup node /app/dist/scripts/setup-max-ca.js` | 0; CA впервые загружен с официального HTTPS CDN, DER fingerprint проверен |
| PowerShell `$env:NODE_EXTRA_CA_CERTS_CONTAINER='/run/secrets/max-official-root.pem'` | Путь контейнера задан до запуска Node |
| `docker compose -f compose.setup.yaml run --rm setup node /app/dist/scripts/polling-setup-check.js --initialize` | 0; фактический identity-init создаёт .env.public из примера через локальные /me и /subscriptions; повторная запись отклонена без изменения файла |
| `docker compose --env-file .env.public -f compose.polling.yaml run --rm --no-deps app node dist/scripts/polling-check.js` | 0; `loadConfig`, PUBLIC, identity-порт 42978, 5000/35000 мс, `LOADED_BY_NODE` |
| Та же команда с `polling-setup-check.js` | 0; фактический start-polling, текст/кнопки/ошибка формы/дубликат, SIGTERM, restart с прежним cursor; 55 запросов к симулятору, **0 к реальному MAX** |
| Через тот же контейнер: `loadConfig → seedCatalog → Catalog.load`, сверка bundled active pointer и прав runtime | 0; kzn/ekb, UID 1000, исходный реальный снимок без refresh и изменения дат |

После финальной правки отказа тестового runner отдельно проверен его запуск с неподдерживаемым синтетическим токеном: локально и в пересобранном Docker-кандидате ожидаемый exit 1, значение токена в выводе отсутствует. Повторён только этот затронутый шаг; приложение и конфигурация запуска не менялись.

Тестовый preload подключён явно только тестовым runner и отказывает с настоящим токеном. Обычный loader по-прежнему допускает только официальный API-host. Отсутствие лимитов кампании в foreground проверено существующим тестом PUBLIC polling (>120 запросов и >30 минут по синтетическим часам); тест не переименован в клиентское наблюдение.

**Внешняя граница:** реальный foreground запуск пользователь уже подтвердил. Второй настоящий poller, прямой /updates, новые /me или /subscriptions настоящего бота, клиентские наблюдения mobile/web и deployment в этой задаче не выполнялись. Работающий исходный контейнер сохранён и остался healthy на порту 3000. Локальный `compose.ca.override.yaml` и пользовательские env не изменены. Одноразовые контейнеры остановлены; их тома удалены только после проверки сохранности.

## PowerPoint

Оба файла созданы через `python presentation/export_pptx.py` (exit 0), с отдельной зависимостью `python-pptx==1.0.2`, поверх прежних layout-методов и 960×540 pt. 13/14 слайдов; 245/262 обычных редактируемых текстовых блока, по 46 групп, native фигуры, 33 линии/соединителя и 13 наконечников. Изображений, вложенных шрифтов и скрытых текстовых дублей в PPTX нет. Перенесены 13/14 заметок и 18/20 HTTPS-ссылок.

**Microsoft PowerPoint 16.0.17932.21000** открыл финальные файлы без видимого окна и экспортировал все 27 страниц в PDF. Проверены текст, кириллица/₽, начертания, ссылки, порядок и соответствие 13 продуктовых страниц. Просмотрены все 27 пар, 27 наложений 1,5× и 10 контактных листов. Переносы и компоновка совпадают; остаточное округление начала строки ≤0,18 pt по X и ≤0,41 pt по Y, без обрезки или подмены Segoe UI.

На одноразовой копии **в PowerPoint** изменён текст и перемещена группа схемы на 12/8 pt; выполнены сохранение, повторное открытие и PDF-экспорт, exit 0. Изменённая копия не поставляется. Повторный запуск экспортёра без нового output-dir отказал с exit 2, сохранив исходные PPTX. Временные экземпляры PowerPoint закрыты. Доказательства: `.review/pptx-final-render/validation.json`, `commands.json`.

| Файл | SHA-256 |
|---|---|
| Исходный `cultural-plan.pdf`, без изменения | `9a07b28211d5be2eff95623e3e16354fedc920f5802105b5029b087b464accc3` |
| Исходный `cultural-plan-submission-preview.pdf`, без изменения | `a5a7770457f938557ed1eba50a79e7fbe507b49db9308b99e293b3fb651e68fb` |
| Исходный `slides.json`, без изменения | `83b0bf0af6a29a15eba15bea4e341890b11380f91f795fb98eb4cb8371c3fc77` |
| `cultural-plan.pptx`, 13 слайдов | `4589e1abb790f3ab82881fffdfd70208df654d4ad5bab32dffb7e596b6986985` |
| `cultural-plan-submission-preview.pptx`, 14 слайдов | `80cf94a2473e6eb1def4ea6e9de699fcf05e3c229af0b3be0a0d05bb01dec3fa` |

Тексты, числа, участники и технический предпросмотр не обновлялись вслед за приложением. Исторические квитанции, BUILD_INFO, заметки, план пяти этапов и клиентский ledger сохранены. Итоговый единственный обезличенный архив: `.review/organizer-ready-final.zip`; версия и список файлов внутри, контрольная сумма рядом в `.zip.sha256`. `worktreeChangesAtPackaging` учитывает также непоставляемый пользовательский override.

Методика: применён OpenAI Docs и записанные официальные [Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide), [Model guidance](https://developers.openai.com/api/docs/guides/latest-model), [Rethinking skills and prompts](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra): релевантные чтения, законченный разрешённый результат и проверки по затронутому риску. Локальных TXT не было; настройки модели не менялись.
