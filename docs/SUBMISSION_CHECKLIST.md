# Комплект сдачи — локальная часть

Материалы для оценки «Культурного плана» по требованиям организаторов, PDF страницы 9–10; продуктовые критерии — страница 12. Текущий каталог измерен 28.09.2026; [единая ведомость](DEFENSE_FACTS.json).

| Материал | Файл и состояние |
|---|---|
| R07: назначение, запуск, конфигурация, архитектура, проверки, остановка | [README](../README.md), [самопроверка](ORGANIZER_CHECK.md) |
| R11: Docker и измерение ≤5 минут без загрузки основы | [Dockerfile](../Dockerfile), [Compose](../compose.yaml), [историческое измерение чистой сборки](evidence/public-handoff/verification.json); новая кешированная сборка его не заменяет |
| R04: доступ к боту | [Бот команды](https://max.ru/t432_hakaton_max_bot); для независимой установки — [свой токен и инициализация](../README.md#подключение-к-настоящему-max). Действующий токен в исходники не входит |
| PUBLIC polling / production webhook | [polling](../compose.polling.yaml), [Docker-инициализация](../compose.setup.yaml), [webhook](../deploy/compose.public.yaml), [.env example](../.env.public.example) |
| C05: применимая HTTP-поверхность, девять групп DATA-API | [OpenAPI 3.1](../openapi.json), [DATA-API](../DATA-API.yaml); при внешней интеграции требуются host и схема организатора |
| Повторяемые входные данные и проверки | [синтетический каталог](../src/culture/stage4-fixture.ts), [MAX fixtures](../tests/fixtures.ts), [public tests](../tests/public-access.test.ts) |
| Реальные данные/источники | [инвентаризация](SOURCE_INVENTORY.md), [active snapshot](../catalog/real/active.json), [coverage](evidence/multi-city/coverage.json) |
| Презентация | [Продуктовый PDF, 13 страниц](../presentation/cultural-plan.pdf), [безопасный предпросмотр сдачи, 14 страниц](../presentation/cultural-plan-submission-preview.pdf), [PPTX, 13 слайдов](../presentation/cultural-plan.pptx), [PPTX, 14 слайдов](../presentation/cultural-plan-submission-preview.pptx) |
| Приватность и сторонние компоненты | [уведомление](PRIVACY.md), [notices](../THIRD_PARTY_NOTICES.md) |
| Закрытый первый слайд/доступ | [отдельный шаблон](PRIVATE_HANDOFF_TEMPLATE.md), НЕ ЗАПОЛНЕНО / НЕ ОТПРАВЛЕНО |
| Версии и целостность | [Текущий защитный пакет](../artifacts/defense-20260928/README.md): приложение и dataset в `VERSION.json`, суммы в `MANIFEST.sha256`, SHA-256 архива рядом. Commit документов — содержащий их Git commit |

Участники: Садыков Булат, Бастанов Айрат, Белова Маргарита. Для постоянной службы отдельно согласуются оператор, контакт, HTTPS-хост/DNS, доступ и период оценки. Для закрытой передачи заполняется технический лист; для внешней DATA-API-интеграции уточняется официальный `schema_version`. Публичный предпросмотр содержит незаполненные поля доступа. Текущая поставка работает локально под управлением оператора; внешний вид и доставка текущей версии в MAX mobile/web отдельно не подтверждены.

Пять этапов продукта сохранены: данные/селектор, диалог, личные закладки, надёжность, материалы. Расширение до 11 городов реализовано. [Готовность и оставшаяся операционная передача](SUBMISSION_READINESS.md), [брифинг](DEFENSE_BRIEF.md), [проверка защитных файлов](verification/DEFENSE_PACKAGE.md). В этой задаче REAL_APPLICATION_SMOKE = NOT_APPLICABLE_WITH_REASON (документы и экспорт); прежние runtime/client статусы не менялись.
