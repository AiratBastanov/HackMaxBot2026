"""Редактируемые PPTX из прежних текстов и геометрии render.Designer.

PDF и JSON не изменяются. Существующие PPTX никогда не перезаписываются:
для следующей сборки укажите новый --output-dir и сравните изменения вручную.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime
from io import BytesIO
import json
import math
import os
from pathlib import Path
import re

import fitz
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_AUTO_SHAPE_TYPE, MSO_CONNECTOR, MSO_SHAPE_TYPE
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Pt

from render import Designer, H, PALETTE, ROOT, W


FONT_FAMILY = "Segoe UI"
# Компенсация первой базовой линии Segoe UI в PowerPoint 16 относительно
# ascender PyMuPDF. Проверена по PDF-экспорту всех страниц; это внутренний
# отступ рамки, а не изменение координат, размера шрифта или текста макета.
OFFICE_BASELINE_EM = {1.06: .25136, 1.15: .148, 1.22: .16}


def rgb(name):
    return RGBColor.from_string(PALETTE.get(name, name).lstrip("#"))


def no_theme_effects(shape):
    # Шаблон python-pptx ссылается на эффект тени темы; в исходнике теней нет.
    style = shape._element.find("{http://schemas.openxmlformats.org/presentationml/2006/main}style")
    if style is not None:
        shape._element.remove(style)
    shape._element.spPr.append(OxmlElement("a:effectLst"))


class PptxDesigner(Designer):
    """Меняет только примитивы вывода; композиции наследуются без копирования."""

    def page(self, doc, slide_id, background="paper"):
        self.p = doc.slides.add_slide(doc.slide_layouts[6])
        self.slide_id = slide_id
        self.shapes = self.p.shapes
        self.p.background.fill.solid()
        self.p.background.fill.fore_color.rgb = rgb(background)
        return self.p

    @contextmanager
    def group(self, name):
        parent = self.shapes
        group = parent.add_group_shape()
        group.name = f"{self.slide_id} · {name}"
        self.shapes = group.shapes
        try:
            yield group
        finally:
            self.shapes = parent

    def rect(self, x, y, w, h, fill, stroke=None, width=1):
        shape = self.shapes.add_shape(MSO_AUTO_SHAPE_TYPE.RECTANGLE, Pt(x), Pt(y), Pt(w), Pt(h))
        no_theme_effects(shape)
        shape.name = f"{self.slide_id} · Блок {len(self.shapes)}"
        shape.fill.solid()
        shape.fill.fore_color.rgb = rgb(fill)
        if stroke:
            shape.line.color.rgb = rgb(stroke)
            shape.line.width = Pt(width)
        else:
            shape.line.fill.background()
        return shape

    def line(self, x1, y1, x2, y2, shade="line", width=1):
        shape = self.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Pt(x1), Pt(y1), Pt(x2), Pt(y2))
        no_theme_effects(shape)
        shape.name = f"{self.slide_id} · Соединитель {len(self.shapes)}"
        shape.line.color.rgb = rgb(shade)
        shape.line.width = Pt(width)
        return shape

    def arrow(self, points, shade="teal", width=2, head=6):
        with self.group("Стрелка"):
            for start, end in zip(points, points[1:]):
                self.line(*start, *end, shade, width)
            x, y = points[-1]
            px, py = points[-2]
            angle = math.atan2(y-py, x-px)
            triangle = [(x, y),
                        (x-head*math.cos(angle)+head*.55*math.sin(angle),
                         y-head*math.sin(angle)-head*.55*math.cos(angle)),
                        (x-head*math.cos(angle)-head*.55*math.sin(angle),
                         y-head*math.sin(angle)+head*.55*math.cos(angle))]
            vertices = [(Pt(tx), Pt(ty)) for tx, ty in triangle]
            builder = self.shapes.build_freeform(*vertices[0], scale=1)
            builder.add_line_segments(vertices[1:], close=True)
            shape = builder.convert_to_shape()
            no_theme_effects(shape)
            shape.name = f"{self.slide_id} · Наконечник"
            shape.fill.solid()
            shape.fill.fore_color.rgb = rgb(shade)
            shape.line.fill.background()

    def text(self, x, y, w, value, size=18, bold=False, shade="ink", maxh=None,
             align="left", leading=1.22, url=None):
        font = self.fonts[bold]
        lines = self.wrap(value, w, size, bold)
        step = size * leading
        height = (len(lines)-1)*step + (font.ascender-font.descender)*size
        if maxh is not None and height > maxh + .1:
            raise ValueError(f"{self.slide_id}: переполнение текста: {value}")
        assert x >= 0 and y >= 0 and x+w <= W+.1 and y+height <= H+.1
        shape = self.shapes.add_textbox(Pt(x), Pt(y), Pt(w), Pt(height))
        shape.name = f"{self.slide_id} · {value.splitlines()[0][:70]}"
        frame = shape.text_frame
        frame.clear()
        frame.margin_left = frame.margin_right = frame.margin_top = frame.margin_bottom = 0
        frame.margin_top = Pt(size * OFFICE_BASELINE_EM[leading])
        frame.auto_size = MSO_AUTO_SIZE.NONE
        frame.word_wrap = False
        frame.vertical_anchor = MSO_ANCHOR.TOP
        paragraph = frame.paragraphs[0]
        paragraph.alignment = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER, "right": PP_ALIGN.RIGHT}[align]
        paragraph.space_before = paragraph.space_after = Pt(0)
        # При экспорте PowerPoint абсолютный интерлиньяж округляется.
        # Относительная запись уменьшает отклонение дробного шага сетки.
        paragraph.line_spacing = leading / 1.2
        # Один нормальный абзац на исходный текстовый блок, с сохранёнными переносами.
        # Не применяем автоматическое уменьшение, кернинг или смену гарнитуры.
        for index, line in enumerate(lines):
            if index:
                paragraph.add_line_break()
            run = paragraph.add_run()
            run.text = line
            run.font.name = FONT_FAMILY
            run.font.size = Pt(size)
            run.font.bold = bold
            run.font.italic = False
            run.font.underline = False
            run.font.color.rgb = rgb(shade)
            run._r.get_or_add_rPr().set("lang", "ru-RU")
            run._r.get_or_add_rPr().set("kern", "120000")
        paragraph.font.name = FONT_FAMILY
        paragraph.font.size = Pt(size)
        if url:
            assert url.startswith("https://"), "Только явные HTTPS-ссылки"
            shape.click_action.hyperlink.address = url
        self.blocks.append({"slide": self.slide_id, "text": value, "size": size, "bold": bold,
                            "bbox": [x, y, x+w, y+height], "lines": lines})
        return height

    def button(self, x, y, w, h, value, size=17, primary=False):
        with self.group(f"Кнопка: {value.replace(chr(10), ' ')}"):
            super().button(x, y, w, h, value, size, primary)

    def icon(self, x, y, kind):
        with self.group(f"Пиктограмма: {kind}"):
            super().icon(x, y, kind)

    def panel(self, asset_id, x, y):
        with self.group(f"Схема интерфейса: {asset_id}"):
            asset = self.source["interfaces"][asset_id]
            if not asset["image"]:
                super().panel(asset_id, x, y)
                return
            # Настоящий будущий снимок остаётся отдельным заменяемым изображением.
            w, h = asset["width"], asset["height"]
            self.text(x, y, w, asset["caption"], 14, shade="muted", maxh=23)
            y += 26
            self.rect(x, y, w, h, asset.get("surface", "white"))
            path = (ROOT / asset["image"]).resolve()
            assert path.is_relative_to((ROOT / "assets").resolve())
            assert "Схема" not in asset["caption"]
            pix = fitz.Pixmap(str(path))
            ratio = min(w / pix.width, h / pix.height)
            iw, ih = pix.width * ratio, pix.height * ratio
            self.shapes.add_picture(BytesIO(pix.tobytes("png")), Pt(x+(w-iw)/2), Pt(y+(h-ih)/2), Pt(iw), Pt(ih))

    def group_blocks(self):
        """Объединяет подложку и следующие вложенные элементы, сохраняя порядок."""
        shapes = list(self.p.shapes)
        assigned = set()
        for start, background in enumerate(shapes):
            if background.shape_id in assigned or background.shape_type != MSO_SHAPE_TYPE.AUTO_SHAPE:
                continue
            if background.width < Pt(80) or background.height < Pt(60):
                continue
            items = [background]
            bx, by = background.left, background.top
            right, bottom = bx+background.width, by+background.height
            for child in shapes[start+1:]:
                if child.shape_id in assigned:
                    break
                if (child.left >= bx and child.top >= by and
                        child.left+child.width <= right+Pt(.1) and child.top+child.height <= bottom+Pt(.1)):
                    items.append(child)
                else:
                    break
            if len(items) < 2:
                continue
            tree = self.p.shapes._spTree
            index = tree.index(background._element)
            group = self.p.shapes.add_group_shape(items)
            group.name = f"{self.slide_id} · Блок схемы"
            tree.remove(group._element)
            tree.insert(index, group._element)
            assigned.update(item.shape_id for item in items)


def speaker_notes():
    source = (ROOT / "SPEAKER_NOTES.md").read_text(encoding="utf-8")
    notes = {}
    for match in re.finditer(r"^## ((?:P|T)\d+)\b([^\n]*)\n(.*?)(?=^## |\Z)", source, re.M | re.S):
        text = match.group(3).strip()
        # Относительные ссылки становятся пригодными вне репозитория; текст сохранён.
        text = re.sub(r"\[([^\]]+)\]\(\.\./([^\)]+)\)",
                      r"\1 (https://github.com/AiratBastanov/HackMaxBot2026/blob/32127a01e126658599e0da4d0ca4de59af52752a/\2)", text)
        notes[match.group(1)] = text
    return notes


def new_deck(source, edition):
    deck = Presentation()
    deck.slide_width, deck.slide_height = Pt(W), Pt(H)
    props = deck.core_properties
    props.title = f"Культурный план — {edition}"
    props.subject = "Продукт, сценарий, реализация и развитие"
    props.author = "; ".join(source["meta"]["participants"])
    props.last_modified_by = ""
    props.comments = "Редактируемый экспорт исходной презентации"
    props.keywords = ""
    props.created = props.modified = datetime(2026, 9, 27)
    props.revision = 1
    return deck


def generate(output_dir, regular, bold):
    source = json.loads((ROOT / "slides.json").read_text(encoding="utf-8"))
    assert source["schema_version"] == 2
    paths = [output_dir / "cultural-plan.pptx", output_dir / "cultural-plan-submission-preview.pptx"]
    if any(p.exists() for p in paths):
        raise FileExistsError("PPTX уже существует. Выберите новый --output-dir; ручные правки не перезаписываются.")
    assert regular.is_file() and bold.is_file(), "Нужны исходные Segoe UI Regular и Bold для измерения текста"
    output_dir.mkdir(parents=True, exist_ok=True)
    notes = speaker_notes()
    for preview, path in enumerate(paths):
        deck = new_deck(source, "предпросмотр сдачи" if preview else "продуктовая презентация")
        designer = PptxDesigner(regular, bold, source)
        assert designer.fonts[False].name == "Segoe UI Regular" and designer.fonts[True].name == "Segoe UI Bold", "Не заменяйте гарнитуру исходной презентации"
        if preview:
            designer.page(deck, "T00")
            designer.technical(source["technical"])
            designer.group_blocks()
            designer.p.notes_slide.notes_text_frame.text = notes["T00"]
        for slide in source["slides"]:
            background = {"cover": "ink", "pipeline": "ink", "quality": "ink", "conclusion": "ink",
                          "personal": "mint", "impact": "mint", "roadmap": "coral_tint"}.get(slide["layout"], "paper")
            designer.page(deck, slide["id"], background)
            getattr(designer, slide["layout"])(slide)
            designer.group_blocks()
            designer.p.notes_slide.notes_text_frame.text = notes[slide["id"]]
        deck.save(path)
    return paths


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    fonts = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    parser.add_argument("--output-dir", type=Path, default=ROOT, help="Новый каталог для двух PPTX")
    parser.add_argument("--font-regular", type=Path, default=fonts / "segoeui.ttf")
    parser.add_argument("--font-bold", type=Path, default=fonts / "segoeuib.ttf")
    args = parser.parse_args()
    try:
        paths = generate(args.output_dir, args.font_regular, args.font_bold)
    except FileExistsError as exc:
        parser.error(str(exc))
    print(json.dumps({"файлы": [str(p) for p in paths], "слайды": [13, 14]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
