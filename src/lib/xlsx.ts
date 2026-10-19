/**
 * Выгрузка чек-листа в .xlsx — без библиотек: пара XML-файлов в zip без сжатия.
 * Вид повторяет образец: шапка «№ / Дело / Статус» на четыре строки, группы —
 * голубой строкой «Тема», между группами — зелёная полоса и пустая строка,
 * Times New Roman 14, жирные рамки.
 */

export interface XlsxGroup {
  name: string | null;
  items: { title: string; note?: string | null; done: boolean }[];
}

/** Пункты по группам в порядке их первого появления — как в чек-листе на экране. */
export function groupForXlsx(
  items: { title: string; group_name: string | null; note?: string | null; done: boolean; position: number }[],
): XlsxGroup[] {
  const out: XlsxGroup[] = [];
  for (const it of [...items].sort((a, b) => a.position - b.position)) {
    let g = out.find((x) => x.name === it.group_name);
    if (!g) out.push((g = { name: it.group_name, items: [] }));
    g.items.push({ title: it.title, note: it.note, done: it.done });
  }
  return out;
}

/** Имя файла для Content-Disposition: без запрещённых в Windows знаков. */
export function xlsxFileName(title: string): string {
  return `${title.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Чек-лист'}.xlsx`;
}

// Индексы cellXfs в styles.xml ниже.
const S_HEAD = 1;
const S_NUM = 2;
const S_TEXT = 3;
const S_THEME = 4;
const S_SEP = 5;
const S_STATUS = 6;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="14"/><color rgb="FF000000"/><name val="Times New Roman"/><family val="1"/></font>
<font><b/><sz val="14"/><color rgb="FF000000"/><name val="Times New Roman"/><family val="1"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFC5D9F1"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEBF1DE"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="medium"><color indexed="64"/></left><right style="medium"><color indexed="64"/></right><top style="medium"><color indexed="64"/></top><bottom style="medium"><color indexed="64"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const esc = (s: string) =>
  s
    // Управляющие символы XML не допускает.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const str = (ref: string, s: number, text: string) =>
  `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
const num = (ref: string, s: number, n: number) => `<c r="${ref}" s="${s}"><v>${n}</v></c>`;
const blank = (ref: string, s: number) => `<c r="${ref}" s="${s}"/>`;

/** Excel сам не подгоняет высоту строк с переносом — прикинем по длине текста (~34 знака в строке «Дело»). */
const rowHeight = (text: string) => Math.max(19, Math.ceil(text.length / 34) * 19);

/** Имя листа: не длиннее 31 знака и без []:*?/\. */
export function sheetName(title: string): string {
  const s = title.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31).trim();
  return s || 'Чек-лист';
}

export function sheetXml(groups: XlsxGroup[]): string {
  const rows: string[] = [];
  const merges: string[] = ['A1:A4', 'B1:B4', 'C1:C4'];
  const row = (r: number, cells: string, ht?: number) =>
    rows.push(`<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells}</row>`);

  row(1, str('A1', S_HEAD, '№') + str('B1', S_HEAD, 'Дело') + str('C1', S_HEAD, 'Статус'), 18);
  for (let r = 2; r <= 4; r++) row(r, blank(`A${r}`, S_HEAD) + blank(`B${r}`, S_HEAD) + blank(`C${r}`, S_HEAD), 16);

  let r = 5;
  // Одна безымянная группа — пункты сразу под шапкой, без строки «Тема».
  const titled = groups.length > 1 || groups.some((g) => g.name);
  groups.forEach((g, gi) => {
    if (gi > 0) {
      row(r, blank(`A${r}`, S_SEP) + blank(`B${r}`, S_SEP) + blank(`C${r}`, S_SEP), 19);
      merges.push(`A${r}:C${r}`);
      r++;
      row(r, blank(`A${r}`, S_NUM) + blank(`B${r}`, S_NUM) + blank(`C${r}`, S_NUM), 19);
      merges.push(`A${r}:C${r}`);
      r++;
    }
    if (titled) {
      const name = g.name ?? 'Без группы';
      row(r, blank(`A${r}`, S_THEME) + str(`B${r}`, S_THEME, name) + blank(`C${r}`, S_THEME), Math.max(20, rowHeight(name)));
      r++;
    }
    g.items.forEach((it, i) => {
      const text = it.note ? `${it.title} (${it.note})` : it.title;
      row(
        r,
        num(`A${r}`, S_NUM, i + 1) + str(`B${r}`, S_TEXT, text) + str(`C${r}`, S_STATUS, it.done ? '☑' : '☐'),
        rowHeight(text),
      );
      r++;
    });
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:C${r - 1}"/>
<sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>
<sheetFormatPr baseColWidth="10" defaultRowHeight="16"/>
<cols><col min="1" max="1" width="15" customWidth="1"/><col min="2" max="2" width="40.5" customWidth="1"/><col min="3" max="3" width="15" customWidth="1"/></cols>
<sheetData>${rows.join('')}</sheetData>
<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

export function checklistXlsx(title: string, groups: XlsxGroup[]): Uint8Array {
  const files: [string, string][] = [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ],
    [
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName(title))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    ['xl/styles.xml', STYLES],
    ['xl/worksheets/sheet1.xml', sheetXml(groups)],
  ];
  return zip(files);
}

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Zip без сжатия (method 0) — Excel такой открывает. */
function zip(files: [string, string][]): Uint8Array {
  const enc = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameB = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);
    const head = new Uint8Array(30 + nameB.length);
    const h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // имена в UTF-8
    h.setUint16(10, 0, true);
    h.setUint16(12, 0x21, true); // 1980-01-01
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nameB.length, true);
    head.set(nameB, 30);
    local.push(head, data);

    const dir = new Uint8Array(46 + nameB.length);
    const d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true);
    d.setUint16(14, 0x21, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, data.length, true);
    d.setUint32(24, data.length, true);
    d.setUint16(28, nameB.length, true);
    d.setUint32(42, offset, true);
    dir.set(nameB, 46);
    central.push(dir);
    offset += head.length + data.length;
  }
  const dirSize = central.reduce((n, b) => n + b.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, dirSize, true);
  e.setUint32(16, offset, true);

  const out = new Uint8Array(offset + dirSize + end.length);
  let p = 0;
  for (const b of [...local, ...central, end]) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}
