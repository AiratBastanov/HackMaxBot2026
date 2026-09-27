"""Векторная презентация 16:9: один источник, два синхронных PDF.

Обычная сборка не читает секреты, БД, каталог и сеть. Шрифты берутся с хоста,
в PDF встраиваются подмножества; файлы шрифтов не копируются в комплект.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import zipfile

import fitz

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
REVIEW = REPO / ".review" / "presentation-redesign"
W, H = 960, 540
PALETTE = {
    "ink": "142F3D", "teal": "116E75", "coral": "E47F68",
    "paper": "F8F5EF", "mint": "E1F0EB", "coral_tint": "F8E5DF",
    "gold": "F1C760", "white": "FFFFFF", "muted": "47616B",
    "line": "BCD0CF", "slate": "254753", "pale": "C4DCDA",
}


def color(name):
    value = PALETTE.get(name, name).lstrip("#")
    return tuple(int(value[i:i+2], 16) / 255 for i in (0, 2, 4))


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class Designer:
    def __init__(self, regular, bold, source):
        self.paths = {False: regular, True: bold}
        self.fonts = {weight: fitz.Font(fontfile=str(path)) for weight, path in self.paths.items()}
        for font in self.fonts.values():
            assert all(font.has_glyph(ord(c)) for c in "ЖёЯ₽—"), "В шрифте нет нужных знаков"
        assert self.fonts[False].name != self.fonts[True].name, "Нужны реальные обычное и жирное начертания"
        self.source = source
        self.blocks = []
        self.assets = []

    def page(self, doc, slide_id, background="paper"):
        self.p = doc.new_page(width=W, height=H)
        self.slide_id = slide_id
        for weight, path in self.paths.items():
            self.p.insert_font(fontname="Bold" if weight else "Regular", fontfile=str(path))
        self.rect(0, 0, W, H, background)
        return self.p

    def rect(self, x, y, w, h, fill, stroke=None, width=1):
        self.p.draw_rect(fitz.Rect(x, y, x+w, y+h), fill=color(fill),
                         color=color(stroke) if stroke else None, width=width)

    def line(self, x1, y1, x2, y2, shade="line", width=1):
        self.p.draw_line((x1, y1), (x2, y2), color=color(shade), width=width)

    def arrow(self, points, shade="teal", width=2, head=6):
        shape = self.p.new_shape()
        shape.draw_polyline(points)
        shape.finish(color=color(shade), width=width, closePath=False)
        shape.commit()
        x, y = points[-1]
        px, py = points[-2]
        angle = math.atan2(y-py, x-px)
        triangle = [(x, y), (x-head*math.cos(angle)+head*.55*math.sin(angle), y-head*math.sin(angle)-head*.55*math.cos(angle)),
                    (x-head*math.cos(angle)-head*.55*math.sin(angle), y-head*math.sin(angle)+head*.55*math.cos(angle))]
        shape = self.p.new_shape()
        shape.draw_polyline(triangle)
        shape.finish(fill=color(shade), color=None, closePath=True)
        shape.commit()

    def wrap(self, value, width, size, bold):
        font = self.fonts[bold]
        result = []
        for paragraph in value.split("\n"):
            if not paragraph:
                result.append("")
                continue
            current = ""
            for word in paragraph.split(" "):
                if font.text_length(word, fontsize=size) > width:
                    raise ValueError(f"{self.slide_id}: слово не помещается: {word}")
                candidate = (current + " " + word).strip()
                if current and font.text_length(candidate, fontsize=size) > width:
                    result.append(current)
                    current = word
                else:
                    current = candidate
            result.append(current)
        return result

    def text(self, x, y, w, value, size=18, bold=False, shade="ink", maxh=None, align="left", leading=1.22, url=None):
        font = self.fonts[bold]
        lines = self.wrap(value, w, size, bold)
        step = size * leading
        height = (len(lines)-1)*step + (font.ascender-font.descender)*size
        if maxh is not None and height > maxh + .1:
            raise ValueError(f"{self.slide_id}: переполнение {height:.1f}>{maxh}: {value[:90]}")
        assert x >= 0 and y >= 0 and x+w <= W+.1 and y+height <= H+.1, (self.slide_id, value)
        used = []
        for i, line in enumerate(lines):
            length = font.text_length(line, fontsize=size)
            dx = (w-length)/2 if align == "center" else w-length if align == "right" else 0
            self.p.insert_text((x+dx, y+font.ascender*size+i*step), line,
                               fontname="Bold" if bold else "Regular", fontsize=size, color=color(shade))
            used.append([x+dx, y+i*step, x+dx+length, y+i*step+(font.ascender-font.descender)*size])
        self.blocks.append({"slide": self.slide_id, "text": value, "size": size,
                            "bold": bold, "bbox": [x, y, x+w, y+height], "lines": used})
        if url:
            assert url.startswith("https://"), "Только явные HTTPS-ссылки"
            self.p.insert_link({"kind": fitz.LINK_URI, "from": fitz.Rect(x,y,x+w,y+height), "uri": url})
        return height

    def heading(self, value, shade="ink"):
        self.text(48, 34, 864, value, 32, True, shade, maxh=82)

    def button(self, x, y, w, h, value, size=17, primary=False):
        self.rect(x,y,w,h,"teal" if primary else "mint")
        font = self.fonts[False]
        lines = self.wrap(value, w-12, size, False)
        th = (len(lines)-1)*size*1.15 + (font.ascender-font.descender)*size
        self.text(x+6, y+(h-th)/2, w-12, value, size, shade="white" if primary else "ink",
                  maxh=h, align="center", leading=1.15)

    def panel(self, asset_id, x, y):
        asset = self.source["interfaces"][asset_id]
        w, h = asset["width"], asset["height"]
        self.text(x, y, w, asset["caption"], 14, shade="muted", maxh=23)
        y += 26
        self.rect(x,y,w,h,asset.get("surface", "white"))
        self.assets.append({"id":asset_id,"slide":self.slide_id,"rect":[x,y,w,h],"image":asset["image"]})
        if asset["image"]:
            path = (ROOT / asset["image"]).resolve()
            assert path.is_relative_to((ROOT/"assets").resolve()), "Снимки должны лежать в presentation/assets"
            assert "Схема" not in asset["caption"], "Для настоящего снимка обновите подпись"
            pix = fitz.Pixmap(str(path))
            # Переупаковка пикселей исключает исходные EXIF и другие метаданные снимка.
            self.p.insert_image(fitz.Rect(x,y,x+w,y+h), stream=pix.tobytes("png"), keep_proportion=True)
            return
        assert "Схема интерфейса" in asset["caption"]
        for el in asset["elements"]:
            ex, ey = x+el["x"], y+el["y"]
            assert el["x"] >= 0 and el["y"] >= 0 and el["x"]+el["w"] <= w
            if el["type"] == "text":
                self.text(ex,ey,el["w"],el["text"],el.get("size",18),el.get("bold",False),
                          el.get("color","ink"),maxh=h-el["y"])
            elif el["type"] == "button":
                assert el["y"]+el["h"] <= h
                self.button(ex,ey,el["w"],el["h"],el["text"],el.get("size",17),el.get("primary",False))
            else:
                raise ValueError(f"Неизвестный элемент: {el['type']}")

    def icon(self, x, y, kind):
        self.rect(x,y,44,50,"slate", "pale", 1.4)
        if kind == "page":
            for offset, width in [(12,25),(22,25),(32,17)]: self.line(x+9,y+offset,x+9+width,y+offset,"pale",2)
        elif kind == "extract":
            for k in range(3):
                self.rect(x+8,y+10+k*11,5,5,"coral")
                self.line(x+19,y+12+k*11,x+35,y+12+k*11,"pale",2)
        elif kind == "check":
            self.line(x+8,y+26,x+19,y+36,"gold",3)
            self.line(x+19,y+36,x+37,y+13,"gold",3)
        else:
            self.rect(x+7,y+8,30,12,"coral")
            self.line(x+7,y+29,x+34,y+29,"pale",2)
            self.line(x+7,y+38,x+25,y+38,"pale",2)

    def cover(self, s):
        self.rect(628,0,332,H,"mint")
        self.text(48,58,562,s["title"],66,True,"white",maxh=178,leading=1.06)
        self.text(51,242,509,s["promise"],25,shade="pale",maxh=113)
        self.text(51,382,515,s["team_label"],16,shade="pale")
        for i,name in enumerate(self.source["meta"]["participants"]):
            self.text(51,412+i*29,515,name,20,shade="white")
        m=s["motif"]
        self.rect(666,63,247,280,"ink")
        self.rect(655,52,247,280,"paper")
        self.rect(655,52,247,53,"coral")
        for xx in [685,863]: self.rect(xx,39,7,30,"ink")
        self.text(674,65,210,m["month"],22,True,maxh=32)
        self.text(674,105,204,m["day"],92,True,maxh=125)
        self.text(679,239,203,m["day_label"],22,maxh=32)
        self.line(677,279,880,279,"line",1.2)
        self.text(677,293,214,m["choice"],18,maxh=29)
        for i,word in enumerate(m["tags"]):
            self.rect(655+i*86,357,78,34,"teal" if i==0 else "paper")
            self.text(660+i*86,362,68,word,16,shade="white" if i==0 else "ink",align="center",maxh=26)
        self.text(655,439,263,s["hackathon"],21,True,maxh=31)
        self.text(655,478,263,s["track"],17,maxh=48)

    def comparison(self,s):
        self.heading(s["title"])
        self.text(48,93,864,s["context"],19,maxh=51)
        self.rect(48,163,414,331,"white")
        self.rect(498,163,414,331,"mint")
        self.text(72,180,365,s["left_title"],26,True,maxh=69)
        self.text(522,180,365,s["right_title"],26,True,maxh=69)
        for i,(a,b) in enumerate(s["rows"]):
            y=267+i*72
            for x,value in [(72,a),(522,b)]:
                self.text(x,y,33,f"{i+1:02d}",18,True,"teal")
                self.text(x+48,y,322,value,20,maxh=57)
                if i<2: self.line(x,y+61,x+365,y+61)

    def journey(self,s):
        self.heading(s["title"])
        self.text(48,94,864,s["context"],19,maxh=30)
        for i,(x,asset) in enumerate(zip([48,324,620],s["assets"])):
            self.text(x,145,27,f"{i+1:02d}",17,True,"teal")
            self.text(x+33,142,self.source["interfaces"][asset]["width"]-33,s["stages"][i],19,True,maxh=30)
            self.panel(asset,x,177)
            if i<2: self.arrow([(x+self.source["interfaces"][asset]["width"]+5,330),(x+self.source["interfaces"][asset]["width"]+23,330)],head=5)
        self.text(48,510,864,s["evidence_caption"],15,shade="muted",maxh=23)

    def selection(self,s):
        self.heading(s["title"])
        for i,(label,body) in enumerate(s["constraints"]):
            y=130+i*79
            self.text(48,y,34,f"{i+1:02d}",20,True,"teal")
            self.text(96,y-2,350,label,22,True,maxh=32)
            self.text(96,y+32,350,body,18,maxh=29)
        self.rect(516,125,396,129,"mint")
        self.text(536,138,356,s["strict_title"],21,True,"teal",maxh=58)
        self.text(536,198,356,s["strict_text"],18,maxh=51)
        self.panel(s["asset"],516,270)
        self.line(48,490,912,490)
        self.text(48,501,864,s["time_note"],17,maxh=27)

    def pipeline(self,s):
        self.heading(s["title"],"white")
        for i,(label,body,kind) in enumerate(s["steps"]):
            x=48+i*225
            self.icon(x,135,kind)
            self.text(x+58,143,110,f"{i+1:02d}",24,True,"coral")
            if i<3: self.arrow([(x+116,161),(x+207,161)],"pale",head=7)
            self.text(x,206,205,label,22,True,"white",maxh=62)
            self.text(x,277,208,body,18,shade="pale",maxh=50)
        self.text(48,345,864,s["refresh"],20,shade="white",maxh=32)
        self.rect(48,397,864,84,"mint")
        for i,(number,label) in enumerate(s["metrics"]):
            x=66+i*216
            self.text(x,401,60,number,39,True,"teal",maxh=54)
            self.text(x+71,416,126,label,16,maxh=48)
        self.text(48,499,864,s["dataset"],17,shade="pale",maxh=27)

    def personal(self,s):
        self.heading(s["title"])
        self.panel(s["asset"],48,128)
        for i,(title,body) in enumerate(s["benefits"]):
            y=146+i*101
            self.text(484,y,36,f"{i+1:02d}",21,True,"teal")
            self.text(536,y-2,376,title,23,True,maxh=34)
            self.text(536,y+36,376,body,19,maxh=55)
        self.text(48,474,864,s["privacy"],17,shade="muted",maxh=51)

    def architecture(self,s):
        self.heading(s["title"])
        nodes=[(48,157,180,113,"mint"),(278,157,286,113,"teal"),
               (80,339,216,100,"white"),(332,339,254,100,"white")]
        self.arrow([(231,196),(273,196)])
        self.arrow([(273,229),(231,229)])
        self.arrow([(421,273),(421,306),(188,306),(188,335)])
        self.arrow([(421,306),(459,306),(459,335)])
        for i,((x,y,w,h,bg),(label,body)) in enumerate(zip(nodes,s["nodes"])):
            self.rect(x,y,w,h,bg)
            self.text(x+16,y+15,w-32,label,20,True,"white" if i==1 else "ink",maxh=31)
            self.text(x+16,y+51,w-32,body,17,shade="white" if i==1 else "muted",maxh=53)
        self.rect(626,121,286,322,"ink")
        self.text(646,134,246,s["stack_title"],21,True,"white",maxh=32)
        for i,(name,role) in enumerate(s["stack"]):
            y=178+i*51
            self.text(646,y,246,name,19,True,"pale",maxh=29)
            self.text(646,y+28,246,role,16,shade="white",maxh=25)
        self.text(48,478,864,s["connection"],18,maxh=53)

    def quality(self,s):
        self.heading(s["title"],"white")
        self.text(48,136,315,s["number"],103,True,"gold",maxh=142)
        self.text(52,279,308,s["number_label"],27,shade="white",maxh=75)
        self.text(52,375,308,s["date"],17,shade="pale",maxh=28)
        self.text(52,429,308,s["rerun"],18,shade="pale",maxh=53)
        for i,(label,body) in enumerate(s["groups"]):
            y=132+i*94
            self.text(406,y,35,f"{i+1:02d}",20,True,"coral")
            self.text(458,y-2,454,label,23,True,"white",maxh=36)
            self.text(458,y+35,454,body,18,shade="pale",maxh=53)

    def roadmap(self,s):
        self.heading(s["title"])
        for i,(label,body) in enumerate(s["steps"]):
            x=48+i*296
            self.text(x,128,70,f"{i+1:02d}",38,True,"teal",maxh=56)
            if i<2: self.arrow([(x+82,159),(x+270,159)],"teal",head=7)
            self.text(x,207,270,label,24,True,maxh=67)
            self.text(x,286,275,body,19,maxh=82)
        self.rect(0,395,W,94,"ink")
        self.text(48,413,864,s["dependencies"],19,shade="white",maxh=65)
        self.text(48,507,864,s["capacity"],16,maxh=25)

    def impact(self,s):
        self.heading(s["title"])
        self.text(48,151,400,s["effect"],33,True,"teal",maxh=190)
        self.text(48,403,398,s["method"],19,maxh=82)
        self.line(461,144,461,483,"line",1.5)
        self.text(508,134,404,s["metrics_label"],22,True,maxh=34)
        for i,(label,body) in enumerate(s["metrics"]):
            y=203+i*95
            self.text(508,y,35,f"{i+1:02d}",20,True,"teal")
            self.text(560,y-3,352,label,23,True,maxh=35)
            self.text(560,y+34,352,body,18,maxh=52)

    def handoff(self,s):
        self.heading(s["title"])
        for i,(label,body) in enumerate(s["blocks"]):
            x=48+(i%2)*310
            y=130+(i//2)*167
            self.rect(x,y,278,3,"teal" if i<2 else "coral")
            self.text(x,y+14,34,f"{i+1:02d}",19,True,"teal")
            self.text(x+48,y+11,230,label,22,True,maxh=63)
            self.text(x+48,y+86,240,body,17,maxh=55)
        self.rect(690,125,222,335,"ink")
        for i,label in enumerate(s["sequence"]):
            y=143+i*104
            self.text(711,y,179,label,22,True,"white",maxh=90)
            if i<2: self.arrow([(719,y+67),(719,y+94)],"coral",head=6)
        self.text(48,493,864,s["availability"],19,maxh=31)

    def conclusion(self,s):
        self.heading(s["title"],"white")
        self.text(48,130,450,s["current"],31,True,"white",maxh=91)
        for i,line in enumerate(s["value"]):
            self.text(48,266+i*58,32,f"{i+1:02d}",18,True,"coral")
            self.text(96,264+i*58,392,line,20,shade="pale",maxh=55)
        self.rect(522,126,390,337,"mint")
        self.text(544,145,346,s["limits_title"],23,True,maxh=35)
        for yy,entry in zip([202,249,320,368],s["limits"]):
            self.text(544,yy,346,entry,18,maxh=80)
        self.text(48,494,864,s["next"],19,shade="white",maxh=32)

    def sources(self,s):
        self.heading(s["title"])
        self.text(48,125,495,s["institutions_title"],22,True,maxh=34)
        for i,(label,domain,url) in enumerate(s["institutions"]):
            y=181+i*60
            self.text(48,y,29,f"{i+1:02d}",16,True,"teal")
            self.text(91,y-3,454,label,18,True,maxh=28,url=url)
            self.text(91,y+24,454,domain,16,shade="muted",maxh=25,url=url)
        self.rect(582,115,330,380,"mint")
        self.text(602,132,290,s["technical_title"],21,True,maxh=32)
        for i,(label,body,url) in enumerate(s["technical"]):
            y=180+i*61
            self.text(602,y,290,label,19,True,"teal",maxh=30,url=url)
            self.text(602,y+29,290,body,16,maxh=45,url=url)
        self.text(48,507,864,s["note"],16,shade="muted",maxh=25)

    def technical(self,t):
        self.heading(t["title"])
        self.text(48,86,864,t["caption"],17,shade="muted",maxh=27)
        self.rect(580,125,332,307,"mint")
        self.text(48,127,509,t["bot_label"],20,True,"teal")
        self.text(48,163,509,self.source["meta"]["bot_url"],17,url=self.source["meta"]["bot_url"])
        self.text(48,190,509,t["bot_note"],15,shade="muted")
        self.text(48,232,509,t["repo_label"],20,True,"teal")
        self.text(48,267,509,self.source["meta"]["repository"].removeprefix("https://"),17,url=self.source["meta"]["repository"])
        self.text(48,297,509,t["commit_label"],15,shade="muted")
        self.text(48,320,509,self.source["meta"]["application_commit"],15,True)
        self.text(48,359,509,t["api_label"],20,True,"teal")
        self.text(48,390,509,t["api"],16,maxh=66)
        self.text(600,141,292,t["access_label"],19,True,"teal")
        self.text(600,175,292,t["access"],16,maxh=93)
        self.text(600,273,292,t["env_label"],18,True,"teal",maxh=52)
        self.text(600,327,292,t["env"],14,maxh=101)
        self.text(48,467,225,t["scenario_label"],19,True,"teal",maxh=31)
        self.text(283,462,629,t["scenario"],18,maxh=70)


def metadata(title):
    return {"title":title,"author":"Садыков Булат; Бастанов Айрат; Белова Маргарита",
            "subject":"Культурный план — продукт, сценарий, реализация и развитие",
            "creator":"Векторный генератор презентации", "producer":"PyMuPDF 1.26.3",
            "creationDate":"D:20260927000000Z","modDate":"D:20260927000000Z"}


def save_pdf(doc, path, title):
    doc.set_metadata(metadata(title))
    doc.subset_fonts()
    doc.save(path,garbage=4,deflate=True,no_new_id=True)


def normalized(value):
    return " ".join(value.split())


def validate_and_preview(source, designer):
    REVIEW.mkdir(parents=True,exist_ok=True)
    paths=[ROOT/"cultural-plan.pdf",ROOT/"cultural-plan-submission-preview.pdf"]
    report={"pages":{},"identical_product_pages":[],"assets":designer.assets,"fonts":{},"files":{}}
    docs=[fitz.open(p) for p in paths]
    n=len(source["slides"])
    assert len(docs[0])==n and len(docs[1])==n+1
    forbidden=["\ufffd","\u2022","ДОСТУП СКРЫТ","ПУБЛИЧНАЯ КОПИЯ","PASS","PARTIAL","NOT_RUN","PUBLIC →"]
    for variant,doc,path in zip(["product","submission"],docs,paths):
        assert doc.embfile_count()==0 and not doc.is_encrypted
        assert not doc.get_xml_metadata(), "Неожиданные метаданные XMP"
        titles=([source["technical"]["title"]] if variant=="submission" else [])+[s["title"] for s in source["slides"]]
        for i,p in enumerate(doc):
            assert tuple(p.rect)==(0,0,W,H)
            text=p.get_text()
            assert normalized(titles[i]) in normalized(text),(variant,i,"заголовок")
            assert all(t not in text for t in forbidden),(variant,i,"нежелательный текст")
            assert not list(p.annots() or []) and not list(p.widgets() or [])
            for block in p.get_text("dict")["blocks"]:
                for line in block.get("lines",[]):
                    for span in line["spans"]:
                        assert p.rect.contains(fitz.Rect(span["bbox"])),(variant,i,span)
                        assert "Segoe" in span["font"] or "DejaVu" in span["font"] or "Liberation" in span["font"],span["font"]
            for link in p.get_links():
                assert link["kind"]==fitz.LINK_URI and link["uri"].startswith("https://")
            p.get_pixmap(matrix=fitz.Matrix(1.4,1.4),alpha=False).save(REVIEW/f"{variant}-{i+1:02d}.png")
        report["pages"][variant]=len(doc)
        report["files"][path.name]=digest(path)
        # Контактные листы — только в игнорируемом каталоге, по шесть страниц.
        for start in range(0,len(doc),6):
            sheet=fitz.open(); q=sheet.new_page(width=984,height=870)
            q.draw_rect(q.rect,color=None,fill=color("line"))
            for j,index in enumerate(range(start,min(start+6,len(doc)))):
                x=8+(j%2)*488; y=8+(j//2)*288
                q.show_pdf_page(fitz.Rect(x,y,x+480,y+270),doc,index)
            q.get_pixmap().save(REVIEW/f"{variant}-contact-{start//6+1}.png")
            sheet.close()
    for i in range(n):
        a,b=docs[0][i],docs[1][i+1]
        assert a.get_text()==b.get_text(),("текст",i)
        assert a.get_pixmap(matrix=fitz.Matrix(1.4,1.4)).samples==b.get_pixmap(matrix=fitz.Matrix(1.4,1.4)).samples,("пиксели",i)
        assert [(x["uri"],tuple(x["from"])) for x in a.get_links()]==[(x["uri"],tuple(x["from"])) for x in b.get_links()]
        report["identical_product_pages"].append(source["slides"][i]["id"])
    title_text=docs[0][0].get_text()
    assert all(name in title_text for name in source["meta"]["participants"])
    assert "github" not in title_text and source["meta"]["application_commit"] not in title_text
    tech=docs[1][0].get_text()
    for field in [source["meta"]["application_commit"],"MAX", "API", "Тестовый доступ", "Основной сценарий","Токен", "PUBLIC_HOST"]:
        assert field in tech,field
    alltext="\n".join(p.get_text() for doc in docs for p in doc)
    assert "₽" in alltext
    assert not re.search(r"(?:Bearer\s+[A-Za-z0-9_.-]{12,}|BEGIN .*PRIVATE KEY|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{15,})",alltext)
    # Коллизии текстовых блоков: проверяются реальные строки, а не пустые края рамки.
    conflicts=[]
    for i,a in enumerate(designer.blocks):
        for b in designer.blocks[i+1:]:
            if a["slide"]!=b["slide"]: continue
            if any((fitz.Rect(ra)&fitz.Rect(rb)).get_area()>5 for ra in a["lines"] for rb in b["lines"]):
                conflicts.append([a["slide"],a["text"],b["text"]])
    report["text_collisions"]=conflicts
    write_json(REVIEW/"layout-blocks.json",designer.blocks)
    write_json(REVIEW/"validation.json",report)
    for doc in docs: doc.close()
    assert not conflicts, f"Пересечения текста: {conflicts}"
    return report


def assemble_private(page_path, output_path):
    private=(REPO/"private").resolve()
    source=page_path.resolve(); target=output_path.resolve()
    assert source.is_relative_to(private) and target.is_relative_to(private), "Закрытые вход и выход — только в private/"
    assert not target.exists(), "Закрытый выход уже существует; выберите новое имя"
    with fitz.open(source) as first, fitz.open(ROOT/"cultural-plan.pdf") as product:
        assert len(first)==1 and tuple(first[0].rect)==(0,0,W,H), "Нужен один технический лист 960 × 540"
        out=fitz.open();out.insert_pdf(first);out.insert_pdf(product)
        save_pdf(out,target,"Культурный план — закрытая техническая передача")
        out.close()
    # Закрытый PDF намеренно не попадает в публичные превью, отчёт или архив.
    print("Закрытая версия собрана в указанном private-пути. Автоматической отправки нет.")


def package():
    names=["cultural-plan.pdf","cultural-plan-submission-preview.pdf",
           "cultural-plan.pptx","cultural-plan-submission-preview.pptx","slides.json","render.py","export_pptx.py",
           "requirements.txt","requirements-pptx.txt","README.md","SCREENSHOT_PLAN.md","SPEAKER_NOTES.md","VERIFICATION.md","BUILD_INFO.json"]
    files=[ROOT/name for name in names]
    assert all(p.is_file() for p in files)
    # Любые будущие снимки добавляются только как явно перечисленные публичные ассеты.
    data=json.loads((ROOT/"slides.json").read_text(encoding="utf-8"))
    for asset in data["interfaces"].values():
        if asset["image"]:
            p=(ROOT/asset["image"]).resolve()
            assert p.is_relative_to((ROOT/"assets").resolve())
            files.append(p)
    manifest="\n".join(f"{digest(p)}  presentation/{p.relative_to(ROOT).as_posix()}" for p in files)+"\n"
    path=REVIEW/"cultural-plan-presentation.zip"
    with zipfile.ZipFile(path,"w",zipfile.ZIP_DEFLATED) as archive:
        for p in files:
            info=zipfile.ZipInfo("presentation/"+p.relative_to(ROOT).as_posix(),(2026,9,27,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED
            archive.writestr(info,p.read_bytes())
        info=zipfile.ZipInfo("MANIFEST.sha256",(2026,9,27,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
        archive.writestr(info,manifest.encode("utf-8"))
    write_json(REVIEW/"package-checksum.json",{"file":path.name,"sha256":digest(path),"entries":len(files)+1})


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    fonts=Path(os.environ.get("WINDIR","C:/Windows"))/"Fonts"
    parser.add_argument("--font-regular",type=Path,default=fonts/"segoeui.ttf")
    parser.add_argument("--font-bold",type=Path,default=fonts/"segoeuib.ttf")
    parser.add_argument("--package",action="store_true",help="Собрать только презентационный комплект")
    parser.add_argument("--private-page",type=Path,help="Позже: готовый закрытый технический PDF из private/")
    parser.add_argument("--private-output",type=Path,help="Новый закрытый PDF внутри private/")
    args=parser.parse_args()
    if args.private_page:
        assert args.private_output and not args.package, "Укажите закрытый выход; упаковка здесь запрещена"
        assemble_private(args.private_page,args.private_output)
        return
    assert not args.private_output
    assert args.font_regular.is_file() and args.font_bold.is_file(), "Укажите доступную пару шрифтов обычный/жирный"
    source=json.loads((ROOT/"slides.json").read_text(encoding="utf-8"))
    assert source["schema_version"]==2
    d=Designer(args.font_regular,args.font_bold,source)
    product=fitz.open()
    for s in source["slides"]:
        bg={"cover":"ink","pipeline":"ink","quality":"ink","conclusion":"ink",
            "personal":"mint","impact":"mint","roadmap":"coral_tint"}.get(s["layout"],"paper")
        d.page(product,s["id"],bg)
        getattr(d,s["layout"])(s)
    save_pdf(product,ROOT/"cultural-plan.pdf","Культурный план — продуктовая презентация")
    product.close()
    submission=fitz.open()
    d.page(submission,"T00")
    d.technical(source["technical"])
    with fitz.open(ROOT/"cultural-plan.pdf") as same_product:
        submission.insert_pdf(same_product)
    save_pdf(submission,ROOT/"cultural-plan-submission-preview.pdf","Культурный план — предпросмотр сдачи")
    submission.close()
    report=validate_and_preview(source,d)
    build={"reviewed_application_commit":source["meta"]["application_commit"],
           "date":source["meta"]["date"],"python":"3.12","pymupdf":fitz.VersionBind,
           "fonts":[{"name":d.fonts[b].name,"file":d.paths[b].name,"sha256":digest(d.paths[b])} for b in [False,True]],
           "inputs_sha256":{n:digest(ROOT/n) for n in ["slides.json","render.py","requirements.txt"]},
           "outputs_sha256":report["files"],"pages":report["pages"],
           "identical_product_pages":len(report["identical_product_pages"])}
    write_json(ROOT/"BUILD_INFO.json",build)
    if args.package: package()
    print(json.dumps({"product_pages":len(source["slides"]),"submission_pages":len(source["slides"])+1,
                      "identical_product_pages":len(report["identical_product_pages"]),"text_collisions":0,
                      "preview_directory":".review/presentation-redesign","package":args.package},ensure_ascii=False))


if __name__=="__main__":
    main()
