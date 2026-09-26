# Комплект сдачи — локальная часть

Основание: неизменённые ID/веса [реестра требований](00_REQUIREMENTS_AND_EVIDENCE.md), PDF страницы 6–10, 18. Сообщение пользователя об отказе API-провайдеров в ключах и допустимости альтернативного сбора записано как сообщение пользователя, не как лицензия провайдера/поправка к PDF.

| Материал | Файл и состояние |
|---|---|
| R07: назначение, запуск, конфигурация, архитектура, проверки, остановка | [README](../README.md), [самопроверка](ORGANIZER_CHECK.md) |
| R11: Docker и измерение ≤5 минут без загрузки основы | [Dockerfile](../Dockerfile), [Compose](../compose.yaml), [измерение](evidence/public-handoff/verification.json) |
| PUBLIC polling / production webhook | [polling](../compose.polling.yaml), [webhook](../deploy/compose.public.yaml), [.env example](../.env.public.example) |
| C05: применимая HTTP-поверхность, девять групп DATA-API | [OpenAPI 3.1](../openapi.json), [DATA-API](../DATA-API.yaml); host/schema организатора не выдуманы |
| Повторяемые входные данные и проверки | [синтетический каталог](../src/culture/stage4-fixture.ts), [MAX fixtures](../tests/fixtures.ts), [public tests](../tests/public-access.test.ts) |
| Реальные данные/источники | [инвентаризация](SOURCE_INVENTORY.md), [active snapshot](../catalog/real/active.json), [coverage](evidence/public-handoff/coverage.json) |
| Презентация | [PDF](../presentation/cultural-plan.pdf), [редактируемый источник](../presentation/slides.json), [генератор](../presentation/render.py) |
| Приватность и сторонние компоненты | [уведомление](PRIVACY.md), [notices](../THIRD_PARTY_NOTICES.md) |
| Закрытый первый слайд/доступ | [отдельный шаблон](PRIVATE_HANDOFF_TEMPLATE.md), НЕ ЗАПОЛНЕНО / НЕ ОТПРАВЛЕНО |
| Проверенный архив | `scripts/organizer-package.py`, VERSION.json + MANIFEST.sha256 + SHA-256 архива |
| Результат/границы | [квитанция 21](pivot/21_PUBLIC_ACCESS_CATALOG_AND_HANDOFF.md) |

Открытые поля релиза: команда/оператор и контакт; HTTPS-хост/DNS и доступ; период оценки; закрытая передача доступа; официальный schema_version DATA-API, если организаторы его требуют. Новые наблюдения MAX mobile/web отложены пользователем; это отдельный пробел внешней проверки. Ни размещение, ни регистрация подписки, ни отправка заявки/файлов организаторам в задаче не выполнялись.
