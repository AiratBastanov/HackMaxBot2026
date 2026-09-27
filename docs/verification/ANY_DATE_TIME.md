# Любая дата / любое время

27.09.2026. Узкая поправка поверх фактического HEAD `a356cfd49d50ccf7889fae1bc45357cc2db2057a`. Предыдущая кампания семи исправлений не переоткрывалась. Пользовательский `compose.ca.override.yaml`, исторические квитанции, презентации и инструкции организатора сохранены. Работающий бот, БД и каталог не менялись; внешние запросы MAX/источникам не выполнялись.

Причина: черновик требовал date/from/until, `makeQuery` всегда строил один интервал; ручной ввод позволял лишь конкретное значение. На времени `dateBack` дублировал обычный Back. Теперь дата и время имеют независимые типы `SPECIFIC | ANY`, без фиктивных дат и скрытых прежних значений. Старый JSON черновика читается как прежние конкретные значения; SQLite остаётся v4, сохранённые строки не мигрируют.

| Выбор | Семантика |
|---|---|
| Конкретная дата + интервал | Прежнее конкретное окно и проверки |
| Конкретная дата + любое время | Местный календарный день начала сеанса; опубликованное окончание может быть на следующий день |
| Любая дата + интервал | Отдельное суточное окно для каждой применимой даты, включая ночные окна |
| Любая дата + любое время | Будущие/ещё возможные посещения в текущем покрытии каталога и относительно clock |

Планировщик использует только загруженный snapshot, опубликованные даты сеансов и недельные часы с закрытыми днями. Удалённый источник не опрашивается для каждого дня. Перебор ограничен покрытием и конечным числом исключений расписания; первое пригодное посещение каждой occurrence поступает в прежние evaluator/ранжирование/агрегацию. Сохраняются одна позиция на событие, лимиты 3 строгих + до 3 отдельно включённых кандидатов, бюджет, состав/возраст, тема, свежесть, hash/source review и карантин. Неизвестные часы/конец/цена не становятся известными. Явная дата вне покрытия даёт прежний ответ об отсутствии данных.

На дате доступны Сегодня/Завтра, «Любая дата», «Другая дата», «Назад» и «В меню». На времени сохранены интервалы и ручной ввод, добавлено «Любое время»; удалена только его лишняя «Другая дата». Старое действие `dateBack` проходит отказ устаревшей кнопки без сброса состояния. Открытие редактора и Back не меняют предпочтение/opt-in; подтверждённое изменение использует прежнюю границу инвалидирования.

В сводке: «Дата: любая», «Время: любое» либо выбранные значения. В карточке: опубликованный сеанс или явно **предложенное посещение**, например **6 апреля 2030 г., 10:00–20:00** в вымышленной выставке. Сохраняется конкретный Query и visit; минимальное необязательное `proposedVisit` отделяет предложение от ручного выбора. Новый review переоценивает условия, но не переносит выбранное посещение. Равный визит и состав из ANY/конкретного поиска используют прежнюю защиту точного дубля. Разные даты/интервалы/сеансы/составы самостоятельны; старые UUID, generation и содержимое закладок сохраняются.

## Проверки и граница доказательства

**150 уникальных тестов PASS**: 57 целевых (включая 8 новых), 93 затронутые общие регрессии. Финальные typecheck/build PASS. Watchdog: 180 с для typecheck/build, 120 с для suites, 300 с для integration/container; превышений нет. Первые два целевых прогона: по 55 PASS/2 FAIL в новых fixtures. Исправлены FREE с платной суммой, неверная граница review, различающийся состав в проверке равенства и hash до канонизации snapshot. Затем все 8 новых тестов прошли. После уточнения неизвестной даты карточки повторены 56 затронутых renderer/flow проверок; незатронутые PASS не перезапускались.

Проверены все четыре сочетания через HTTP application/worker/SQLite/MAX simulator, время вне 12–18, дата дальше завтра, отдельные ночные окна, начало 23:59:30, исключительная граница полуночи, Казань/Екатеринбург, summary/Back/custom/edit/restart, unknown/stale/denied/quarantine, отсутствие повторов выставки, неизменность визита и legacy, равенство ANY/конкретного визита. Reviewed refresh использует только disposable копии прежних данных; это не новое подтверждение источника.

[Девять экранов из реального локального renderer](../evidence/any-date-time/walkthrough.md), [машинная квитанция](../evidence/any-date-time/verification.json), [baseline/manifest/SHA-256](../evidence/any-date-time/sources.json). Воспроизведение: `node scripts/any-date-time-checks.mjs typecheck`, затем отдельно `build`, `focused`, `shared`, `walkthrough`, `container`. **Единственный изолированный smoke PASS, 13,7 с**: новый сквозной сценарий, уникальные image/project, disposable volume и `network_mode: none`. ID/StartedAt/restart count существующих контейнеров до/после совпали, временный проект и том удалены. Подробный результат и source hash — в машинной квитанции. После smoke менялись только документация и упаковка; clean-build benchmark отсутствует.

Sanitized delta: `.review/any-date-time/changed-source-a356cfd.zip`; генератор `python scripts/package-any-date-time.py`. Только явные task-owned файлы, baseline и manifest с SHA-256/CRC; без секретов, runtime, БД, сырых журналов и полного проекта. Hash квитанции/manifest не включаются сами в себя; их метаданные хранятся отдельно. HUMAN/MAX mobile/web: **NOT_RUN**. Прежние HUMAN_PASS не переобъявляются; U16 ledger не переоткрыт.

Выборочно применены OpenAI Docs: [Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide) — существующие контракты и проверяемое завершение, [Model guidance](https://developers.openai.com/api/docs/guides/latest-model) — выполнение разрешённого объёма и соразмерные проверки, [Rethinking skills and prompts](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) — чтение релевантного контекста. Использованы записанные официальные ссылки; настройки модели не менялись.

## Контролируемое обновление — не выполнялось

Рабочий контейнер `cultural-plan-polling-app-1` подтвердил project `cultural-plan-polling`, `.env.public`, оба Compose-файла ниже и image `cultural-plan:local`. Его revision label — `local-unreviewed`: HEAD репозитория не доказывает наличие изменений в контейнере. Другой `maxbot-g1-local-app-1` этой процедурой не затрагивается. Сначала оператор завершает текущий foreground polling через Ctrl+C. Затем из PowerShell:

```powershell
Set-Location -LiteralPath C:\Users\BastaPC\Desktop\MaxBotHack
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'Обновление кода не завершено' }
$anyCompose = @('-p', 'cultural-plan-polling', '--env-file', '.env.public', '-f', 'compose.polling.yaml', '-f', 'compose.ca.override.yaml')
docker compose @anyCompose stop app
if ($LASTEXITCODE -ne 0) { throw 'Остановка не подтверждена' }
$anyBotId = [regex]::Match((Get-Content -LiteralPath .env.public -Raw), '(?m)^MAX_EXPECTED_BOT_ID=(\d+)\s*$').Groups[1].Value
if (-not $anyBotId) { throw 'Не найден ID своего бота' }
$anyBackup = 'runtime/backups/before-any-date-time-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.sqlite'
docker compose @anyCompose run --rm --no-deps app node dist/scripts/recovery.js backup live $anyBotId runtime/public.sqlite $anyBackup
if ($LASTEXITCODE -ne 0) { throw 'Backup не завершён; обновление остановлено' }
docker compose @anyCompose up --build
```

Используется [штатный SQLite backup](../RECOVERY_RUNBOOK.md) старым образом до пересборки, без запуска polling. Сохраняются project, том `public-data`, `/app/runtime/public.sqlite`, CA и секреты. Обычный `restart` не устанавливает новый код. Второй consumer, source refresh, замена БД и восстановление старой копии этой процедурой не выполняются.
