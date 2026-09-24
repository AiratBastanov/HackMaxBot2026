# SQLite: ограниченный backup/restore этапа 4

Инструмент использует `better-sqlite3` из существующего lockfile и [SQLite Online Backup API](https://www.sqlite.org/backup.html). Он не копирует один основной файл поверх активного WAL. Сеть, broker, replication и автоматическое восстановление отсутствуют. Лимит файла — 256 MiB, backup progress deadline — 60 секунд; тесты используют только одноразовые БД.

Все paths задаются явно. Новые файлы допускаются только внутри ignored `runtime/`, `backups/`, `.tmp/`, `.review/` текущего проекта, с расширением `.sqlite`. Существующий target/sidecar отвергается. Источник открывается read-only; identity `mode:botId` и `user_version=2` проверяются. Recovery не мигрирует неизвестные схемы. Копирование идёт в отдельный temporary path; проверяется integrity, затем готовый файл публикуется эксклюзивно. Незавершённые файлы `.recovery-*` не предназначены для запуска приложения.

```sh
# Из корня; local/777 — только synthetic пример. Для live использовать его закреплённый bot ID.
node dist/scripts/recovery.js backup local 777 runtime/disposable.sqlite backups/check-001.sqlite
node dist/scripts/recovery.js restore local 777 backups/check-001.sqlite runtime/restored-check-001.sqlite
```

Команды создают копии, не заменяют действующую БД. В private `backup_manifest` записаны schema, mode:bot identity, UTC creation time и integrity `ok`. Backup помечен `BACKUP`, restore — `QUARANTINED` с отдельным `restored_at`. stdout содержит квитанцию без содержимого записей; для live она также приватная. Backup может содержать данные, которые пользователь впоследствии удалил. DB, sidecars, backups, personal payload и private manifest никогда не включаются в Git/архив review.

## Граница восстановления

Обычный restart целого тома сохраняет закладки; прежний SENDING становится UNKNOWN_RESULT и не отправляется повторно. Backup/restore — отдельная операция. Runtime отказывается открывать BACKUP/QUARANTINED даже с правильной identity. В restored copy удалены все action references; inbox/outbox payload очищены, историческая отправка подавлена, terminal `finished_at` заполнен. Личные записи физически могут ещё присутствовать в карантине, но недоступны приложению.

Последующие удаления отсутствуют в старом снимке. Минимальный recovery **не умеет сверять потерянные удаления** и не предлагает разблокировать старую персонализацию. Предусмотренный выход — оператор явно отказывается от восстановленных закладок/параметров/контактов и очередей. Только на остановленной новой restored copy:

```sh
node dist/scripts/recovery.js discard local 777 runtime/restored-check-001.sqlite DISCARD_RESTORED_PERSONALIZATION
```

Команда отказывается работать с обычной действующей БД, требует QUARANTINED и точную строку подтверждения. После discard старые данные недоступны, old callbacks не работают, входящие события до recovery cutoff не обрабатываются. Новая активность начинается с `/start`. Для live после проверки копии оператор явно выбирает новую DATABASE_PATH/volume; автоматической замены production и возобновления старых сообщений нет. Старые backup-файлы остаются приватными; retention/уничтожение определяет оператор. Удаление строк не обещает forensic wiping или удаление чатов на стороне MAX.

## Disposable-проверка

`npm run test:integration` включает четыре recovery-теста: backup активного WAL/restore без overwrite, damaged/wrong identity/unsupported schema, обе цепочки backup → удаление закладки или всех данных → loss → quarantine/discard, обычный restart/SENDING. После разрешения копии проверяется реальный HTTP/worker. Существующая пользовательская/живая БД никогда не выбирается автоматически.

Фактические результаты и время — [09](pivot/09_STAGE4_CORRECTIONS_AND_SMOKE.md). Измерения маленьких synthetic БД не гарантируют RPO/RTO и не являются production disaster recovery. Для этапа 5 остаются политика backup retention, доступ оператора и измерение на утверждённом объёме без персональных публикаций.
