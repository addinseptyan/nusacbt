from docx import Document
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import parse_xml
from docx.oxml.ns import qn
from PIL import Image, ImageDraw
from io import BytesIO
import sys

M='http://schemas.openxmlformats.org/officeDocument/2006/math'

def run(s):
    return '<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>'+s+'</m:t></m:r>'
def root(n):
    return '<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>'+run(n)+'</m:e></m:rad>'
def frac(num, den):
    return '<m:f><m:fPr><m:type m:val="bar"/></m:fPr><m:num>'+num+'</m:num><m:den>'+den+'</m:den></m:f>'
def eq(par, body):
    par._p.append(parse_xml('<m:oMath xmlns:m="'+M+'">'+body+'</m:oMath>'))

def label(cell, txt):
    cell.text=txt

doc=Document(); doc.core_properties.author='NusaCBT'; doc.core_properties.title='Contoh template soal fiktif'
normal=doc.styles['Normal'];normal.font.name='Calibri';normal.font.size=Pt(11)
doc.add_heading('Form Import Soal Pilihan Ganda berdasarkan Topik yang dipilih', level=1)
doc.add_paragraph('Semua data di bawah ini adalah contoh fiktif. Ganti seluruh contoh sebelum mengimpor.')
doc.add_paragraph('Jawaban diisi 1 untuk tepat satu jawaban benar, 0 untuk jawaban salah. Baris SOAL tidak diisi pada kolom Jawaban.')
table=doc.add_table(rows=1+4*6,cols=4);table.style='Table Grid'
for c,x in zip(table.rows[0].cells,['No','Jenis','Isi','Jawaban']):c.text=x

def set_group(n, build_prompt, options, correct):
    base=1+(n-1)*6
    first=table.cell(base,0).merge(table.cell(base+5,0));first.text=str(n);first.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
    table.cell(base,1).text='SOAL';table.cell(base,3).text=''
    prompt=table.cell(base,2);prompt.text='';build_prompt(prompt)
    for i,build_option in enumerate(options):
        row=base+1+i;table.cell(row,1).text='JAWABAN';table.cell(row,3).text='1' if i==correct else '0'
        c=table.cell(row,2);c.text='';build_option(c)

def text(s, rtl=False):
    def make(cell):
        p=cell.paragraphs[0];p.add_run(s)
        if rtl:
            p.alignment=WD_ALIGN_PARAGRAPH.RIGHT
            pr=p._p.get_or_add_pPr();pr.append(parse_xml('<w:bidi xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'))
    return make

def prompt_arab(cell):
    p=cell.paragraphs[0];p.alignment=WD_ALIGN_PARAGRAPH.RIGHT;p.add_run('السُّؤَالُ: ').bold=True;p.add_run('مَا لَوْنُ السَّمَاءِ؟')
    p._p.get_or_add_pPr().append(parse_xml('<w:bidi xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'))
set_group(1,prompt_arab,[text(s,True) for s in ['أَزْرَقُ','أَخْضَرُ','أَحْمَرُ','أَصْفَرُ','أَسْوَدُ']],0)

def prompt_table(cell):
    cell.paragraphs[0].add_run('Perhatikan tabel kegiatan fiktif berikut!')
    t=cell.add_table(rows=4,cols=2);t.style='Table Grid'
    for row,(a,b) in zip(t.rows,[('Hari','Kegiatan'),('Senin','Membaca buku'),('Selasa','Berdiskusi'),('Rabu','Membuat ringkasan')]):
        row.cells[0].text=a;row.cells[1].text=b
    for c in t.rows[0].cells:
        for p in c.paragraphs:
            for r in p.runs:r.bold=True
set_group(2,prompt_table,[text(s) for s in ['Membaca buku','Berenang','Melukis','Berlari','Memasak']],0)

def prompt_math(cell):
    p=cell.paragraphs[0];p.add_run('Hitung hasil berikut:').add_break()
    eq(p,frac(root('32')+run('+2')+root('18'),root('8')))
def math_option(body):
    def make(cell):eq(cell.paragraphs[0],body)
    return make
set_group(3,prompt_math,[text('5'),math_option(run('2')+root('2')),math_option(run('3')+root('2')),math_option(frac(run('5'),run('2'))+root('2')),text('10')],0)

im=Image.new('RGB',(180,110),'white'); dr=ImageDraw.Draw(im);dr.ellipse((50,15,130,95),fill='#6db892',outline='#246c4e',width=3); buf=BytesIO();im.save(buf,format='PNG');buf.seek(0)
def prompt_image(cell):
    p=cell.paragraphs[0];p.add_run('Bentuk apa yang ditunjukkan gambar fiktif berikut?')
    p=cell.add_paragraph();p.add_run().add_picture(buf,width=Inches(1.2))
set_group(4,prompt_image,[text(s) for s in ['Lingkaran','Segitiga','Persegi','Trapesium','Bintang']],0)

doc.save(sys.argv[1] if len(sys.argv) > 1 else 'public/templates/template-soal-nusacbt.docx')
print('created')
