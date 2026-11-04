import sys
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

path = r"D:\3d_trainer\developement\requirement\Guitar_Piano_Interactive_Lessons_Technical_Design.docx"
doc = Document(path)


def iter_block_items(parent):
    from docx.oxml.ns import qn
    body = parent.element.body
    for child in body.iterchildren():
        if child.tag == qn('w:p'):
            yield Paragraph(child, parent)
        elif child.tag == qn('w:tbl'):
            yield Table(child, parent)


out = open(r"D:\3d_trainer\developement\_tdd_dump.txt", "w", encoding="utf-8")
def emit(s):
    out.write(s + "\n")

n = 0
for block in iter_block_items(doc):
    if isinstance(block, Paragraph):
        txt = block.text
        style = block.style.name if block.style is not None else ""
        if txt.strip():
            n += 1
            print(f"[{n}] <{style}> {txt}")
        else:
            # check numbered/empty
            pass
    else:
        n += 1
        print(f"[{n}] === TABLE ({len(block.rows)}x{len(block.columns)}) ===")
        for r in block.rows:
            cells = []
            seen = set()
            for c in r.cells:
                if id(c._tc) in seen:
                    continue
                seen.add(id(c._tc))
                cells.append(c.text.replace("\n", " / "))
            print("    | " + " | ".join(cells))
