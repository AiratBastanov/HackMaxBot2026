# Самопроверка организатора

R07/R11, PDF страницы 9–10. Из чистой копии репозитория без секретов:

1. `docker compose up --build -d` — один сервис `app`, именованный `demo-data`; health на localhost:3000.
2. `docker compose ps` — `healthy`. `docker compose logs --tail 20 app` — startup, без токенов и тел MAX.
3. `docker compose exec app node dist/scripts/organizer-check.js` — `PASS`, `SIMULATED_MAX`: новый private actor, Start, подбор, карточка, сохранение/открытие, отказ неверному secret и дедупликация.
4. `docker compose restart`, затем `docker compose exec app node dist/scripts/organizer-check.js --restart` — `PASS`, закладка сохранена.
5. `docker compose down` — процесс остановлен, том сохранён. Новый `up` возобновляет демо.

Это автоматическая симуляция MAX. Никакие действия в мобильном или web MAX для этой проверки не нужны. При занятом 3000 остановите свою конкурирующую копию либо явно измените localhost mapping; тест внутри контейнера продолжает использовать внутренний 3000.

Настоящее подключение требует действительного токена и PUBLIC-конфига из README. `polling_started` означает проверенную identity, отсутствие webhook и запуск consumer, а не подтверждение доставки/видимости карточки в клиентах. Нельзя запускать две копии для одного бота. Наличие webhook вызывает отказ, подписка сохраняется. Остановка Ctrl+C сохраняет cursor; production использует webhook.

Снимок истёк: выполните операторский refresh из README с новым каталогом кеша, затем перезапуск. Ошибка refresh оставляет прежний active pointer; истёкшие факты не выдаются как свежие. Ручной правки hash/timestamp не требуется.

Автоматические доказательства этой поставки: [проверки](evidence/public-handoff/verification.json), [покрытие реальных запросов](evidence/public-handoff/coverage.json). Отдельные fixture-тесты включают две новые identity, A/B-совместимость, actor ownership, source policy, burst limits, удаление, stale/parser failure, polling >120 запросов/>30 минут, mutex/cursor/recovery. Реальная доставка/клиенты не заявляются проверенными.
