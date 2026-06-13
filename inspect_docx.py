import zipfile
import re
path = r"E:\merged_partition_content\Data Sekolah AN-NUR\Aplikasi\Olimpiyade_annur\Soal Olimpiade kelas 2 Sd.docx"
with zipfile.ZipFile(path) as z:
    data = z.read('word/document.xml').decode('utf-8')
    paras = re.findall(r'(<w:p[\s\S]*?</w:p>)', data)
    print('total paragraphs', len(paras))
    for i, p in enumerate(paras[:30]):
        txt = ' '.join(re.findall(r'<w:t>(.*?)</w:t>', p)).strip()
        num = re.search(r'<w:numId w:val="(\d+)"', p)
        ilvl = re.search(r'<w:ilvl w:val="(\d+)"', p)
        print(f'{i:02d} num={num.group(1) if num else "none"} ilvl={ilvl.group(1) if ilvl else "none"} text={repr(txt)}')
