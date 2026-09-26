"""Reproducible text/vector presentation, PyMuPDF 1.26.3. No system fonts/images."""
import json, pathlib, fitz
ROOT=pathlib.Path(__file__).resolve().parent
slides=json.loads((ROOT/'slides.json').read_text(encoding='utf8'))
doc=fitz.open();font=fitz.Font('cjk')
assert font.has_glyph(0x0416), 'Cyrillic font missing'
for i,s in enumerate(slides):
    page=doc.new_page(width=960,height=540)
    page.insert_font(fontname='cyr',fontbuffer=font.buffer)
    page.draw_rect(page.rect,fill=(.966,.974,.987),color=None)
    page.draw_rect(fitz.Rect(0,0,15,540),fill=(.05,.42,.55),color=None)
    def text(rect,value,size=18,color=(.10,.17,.26)):
        remaining=page.insert_textbox(fitz.Rect(rect),value,fontname='cyr',fontsize=size,color=color,lineheight=1.20)
        if remaining<0:raise ValueError(f'Overflow slide {i+1}: {value[:70]} ({remaining})')
    text((44,23,915,48),s['eyebrow'],12,(.05,.42,.55))
    text((42,53,920,101),s['title'],31)
    text((44,112,916,164),s['lead'],20)
    y=179
    for n,item in enumerate(s['items']):
        page.draw_circle(fitz.Point(51,y+10),3.6,fill=(.05,.42,.55),color=None)
        text((66,y,916,y+68),item,17)
        y+=74
    page.draw_line(fitz.Point(44,485),fitz.Point(916,485),color=(.76,.80,.85),width=.6)
    text((44,495,878,528),s['footer'],10,(.34,.39,.45))
    text((886,495,930,524),f'{i+1:02d} / {len(slides):02d}',10)
doc.set_metadata({'title':'Культурный план — локальная передача организаторам','author':'Проект Культурный план','subject':'PUBLIC, каталог, воспроизводимый запуск; секреты исключены','creationDate':'D:20260926000000Z','modDate':'D:20260926000000Z'})
doc.subset_fonts();target=ROOT/'cultural-plan.pdf';doc.save(target,garbage=4,deflate=True,no_new_id=True);doc.close()
with fitz.open(target) as result:
    for i,p in enumerate(result):
        content=p.get_text();assert slides[i]['title'] in content;assert '\ufffd' not in content
    preview=ROOT.parent/'.review/pdf-preview';preview.mkdir(parents=True,exist_ok=True)
    for i in [0,3,7,9]:result[i].get_pixmap(matrix=fitz.Matrix(1.3,1.3)).save(preview/f'slide-{i+1}.png')
print(json.dumps({'pdf':str(target),'pages':len(slides),'cyrillic':'PASS','overflow':'PASS','rendered':[1,4,8,10]}))
