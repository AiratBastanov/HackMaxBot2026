# Презентация «Культурный план»

[Продуктовый PDF](cultural-plan.pdf) и [редактируемый PPTX](cultural-plan.pptx) содержат 13 слайдов. [Предпросмотр сдачи PDF](cultural-plan-submission-preview.pdf) и [PPTX](cultural-plan-submission-preview.pptx) — технический лист и те же 13 продуктовых слайдов. Дизайн сохранён: 960 × 540, 16:9, Segoe UI, прежние цвета, сетка, фигуры и порядок.

Общие цифры и версии берутся из [DEFENSE_FACTS.json](../docs/DEFENSE_FACTS.json): измерение 28.09.2026, приложение `9de3d29ee0dfb9550e7809f8ea371b3f4cb6ce43`, dataset `83664734f5fbb931cb19`. `{{имя}}` в [slides.json](slides.json) разрешается функцией `render.load_source()` из этой замороженной ведомости. Это не обращение к живому каталогу. Заметки — [SPEAKER_NOTES.md](SPEAKER_NOTES.md), короткие ответы — [брифинг](../docs/DEFENSE_BRIEF.md).

## Редактирование и экспорт

Перед перезаписью сохраните локальную копию PDF/PPTX, JSON и заметок. Независимые правки PPTX необходимо сверить с `slides.json`: генератор не читает их обратно. На старте обновления 28.09 все внутренние ZIP parts обоих PPTX совпали с экспортом прежнего источника; ручных отличий и растровых изображений не было. Резервная копия этой задачи находится в игнорируемом `.review/defense-20260928/before`.

Сохраняется один авторский макет `render.Designer`; `export_pptx.PptxDesigner` переводит его примитивы в обычные текстовые поля, фигуры, линии и группы. Полнослайдовых изображений/SVG нет. У каждой страницы есть заметки; ссылки кликабельны. PPTX не встраивает font-файлы. Segoe UI Regular/Bold используются с Windows; отдельно в репозиторий или пакет не копируются. В PDF Office встраивает необходимые подмножества.

Среда: Python 3.12, [зависимости](requirements-pptx.txt), Microsoft PowerPoint 16.0 для конечного PDF. Установка зависимостей, если их ещё нет:

```powershell
python -m pip install -r presentation/requirements-pptx.txt
```

Для новой сборки используйте новые имена каталогов. Проверенный порядок (имена текущей кампании показаны как пример; существующие PPTX/Office PDF не перезаписываются):

```powershell
python presentation/render.py --output-dir .review/defense-next/vector --review-dir .review/defense-next/vector
python presentation/export_pptx.py --output-dir .review/defense-next/updated
powershell -NoProfile -ExecutionPolicy RemoteSigned -File presentation/export_office.ps1 -InputDirectory .review/defense-next/updated -OutputDirectory .review/defense-next/office -VerifyEditability
python presentation/verify_exports.py --pptx-dir .review/defense-next/updated --pdf-dir .review/defense-next/office --vector-dir .review/defense-next/vector --report-dir .review/defense-next/check
```

`RemoteSigned` применяется только к процессу экспорта, без изменения политик пользователя/машины. Скрипт открывает презентации без окна, закрывает только свои документы; существующие документы пользователя сохраняет открытыми. Если среда не предоставляет Office COM-сессию, требуется обычный локальный запуск в доступной Office-сессии. В этой кампании использован Microsoft PowerPoint, не заявляется проверка в других редакторах.

Конечные PDF скопированы из Office-экспорта соответствующих PPTX. Векторный PDF служит сверкой текста и геометрии: текст совпал, максимальное отличие координаты видимого символа 1,79 pt, визуального дрейфа/обрезки нет. Office добавляет прозрачные метки доступности к ссылкам; проверка отдельно отличает их от видимого текста. В обоих форматах сохранены кириллица и ₽, 13 продуктовых страниц после сдвига на технический лист совпадают. До замены конечных файлов просмотрите все страницы. После копирования проверенных PDF/PPTX в `presentation/` повторите последнюю команду с `--write-build-info`: она сверит их hashes и запишет `BUILD_INFO.json`; затем обновите запись проверки. Генератор не обращается к MAX, сайтам учреждений, БД или секретам.

## Схемы и технический первый лист

Все пять панелей — подписанные редактируемые схемы. P03/P06 сохраняют исторический пример визита 27.09 по сбору 26.09; это не свежая рекомендация. P04 объясняет семейный запрос 2 взрослых + ребёнок 7 лет, до 3 000 ₽ по матрице 28.09. Правила возможной поздней замены — [SCREENSHOT_PLAN.md](SCREENSHOT_PLAN.md); новые снимки в этой задаче не получались.

Использован локальный `Досугиразвлечения.pdf`, 22 страницы, требования сдачи 9–10 и продуктовые критерии 12; SHA-256 `638e5de074ea38645f367d2c9d00385064a6db4c8e29036d1efc450a04c0914a`. Оригинал не публикуется. Организатор требует первый служебный слайд с ботом, репозиторием/commit, применимыми API/доступом/окружением и краткой проверкой. Отдельные продуктовая редакция, безопасный предпросмотр и закрытый лист — процедура проекта, а не дополнительное требование организатора.

T00 содержит обязательные группы полей: бот, код и commit, API, вход через MAX, закрытая передача токена, запуск и основной сценарий. Для постоянного размещения поддерживается Webhook через HTTPS; параметры конкретной установки вносятся в [закрытый шаблон](../docs/PRIVATE_HANDOFF_TEMPLATE.md). Токен и секрет webhook не включаются в публичные артефакты.

Для будущей разрешённой закрытой передачи сохранён существующий режим: подготовить по [шаблону](../docs/PRIVATE_HANDOFF_TEMPLATE.md) один лист `private/technical-page.pdf`, 960 × 540, затем:

```powershell
python presentation/render.py --private-page private/technical-page.pdf --private-output private/cultural-plan-submission.pdf
```

Выход должен быть новым и внутри `private/`; он не превьюится и не включается в открытый пакет. В этой задаче закрытый режим не использовался.

## Текущий пакет

[Защитный пакет 28.09](../artifacts/defense-final-20260928/README.md) заменяет прежние архивы только в роли текущей ссылки; исторические архивы сохранены. Это документы, презентации, их авторские источники и датированные данные, не runnable-приложение. Единый прежний механизм `scripts/organizer-package.py` получил режим `--defense`. Для первоначальной сборки текущего пакета:

```powershell
python scripts/organizer-package.py --defense --stage .review/final-organizer/package --zip --archive artifacts/defense-final-20260928/defense-package.zip
```

`python presentation/render.py --package` вызывает тот же режим, не перегенерирует PDF и не перезаписывает существующий архив. Для следующего пакета укажите новые stage/archive. `VERSION.json` содержит application commit и dataset version; commit документов — Git commit, содержащий пакет. Manifest и checksum архива отдельны, самоссылки нет. Контроль экспорта — [квитанция](../docs/verification/DEFENSE_PACKAGE.md), hashes четырёх файлов — [BUILD_INFO.json](BUILD_INFO.json). Ссылки на код/не включённые документы относятся к полному репозиторию.
