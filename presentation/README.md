# Презентация

Редактируйте `slides.json` (текст), `render.py` (векторное оформление). Python 3.12:

```sh
python -m pip install -r presentation/requirements.txt
python presentation/render.py
```

Генератор создаёт `cultural-plan.pdf`, проверяет кириллицу и переполнение, рендерит страницы 1/4/8/10 в игнорируемую `.review/pdf-preview`. Встроенный Droid Sans Fallback подмножествуется; системные Windows-шрифты, фото и логотипы не нужны. PDF предназначен для публичного репозитория: рабочие credentials не вставлять. Закрытая передача — отдельный незаполненный `docs/PRIVATE_HANDOFF_TEMPLATE.md`. Это схемы и текст о реализации; скриншоты не выдаются за наблюдения MAX.
