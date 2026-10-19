/**
 * Выгрузка чек-листа в .xlsx — без библиотек: пара XML-файлов в zip без сжатия.
 * Вид повторяет образец: шапка «№ / Дело / Статус» на четыре строки, группы —
 * голубой строкой «Тема», между группами — зелёная полоса и пустая строка,
 * Times New Roman 14, жирные рамки, в «Статусе» — флажки.
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

/** Флажок «Статус» у дела: строка листа (с 1), отступ строки сверху и её высота в pt, отмечен ли. */
interface Box {
  row: number;
  top: number;
  ht: number;
  checked: boolean;
}

// Ширины колонок A/B/C в пикселях (15 / 40.5 / 15 знаков Calibri 11) и размер флажка.
const COL_PX = [110, 289, 110];
const BOX_W = 22;
const BOX_H = 18;
const EMU = 9525; // в одном пикселе

export function sheetXml(groups: XlsxGroup[]): { xml: string; boxes: Box[] } {
  const rows: string[] = [];
  const boxes: Box[] = [];
  const merges: string[] = ['A1:A4', 'B1:B4', 'C1:C4'];
  let top = 0;
  const row = (r: number, cells: string, ht: number) => {
    rows.push(`<row r="${r}" ht="${ht}" customHeight="1">${cells}</row>`);
    top += ht;
  };

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
      const ht = rowHeight(text);
      boxes.push({ row: r, top, ht, checked: it.done });
      row(r, num(`A${r}`, S_NUM, i + 1) + str(`B${r}`, S_TEXT, text) + blank(`C${r}`, S_STATUS), ht);
      r++;
    });
  });

  const controls = boxes
    .map((b, i) => {
      const a = boxAnchor(b);
      return `<mc:AlternateContent><mc:Choice Requires="x14"><control shapeId="${1025 + i}" r:id="rId${3 + i}" name="Check Box ${i + 1}"><controlPr defaultSize="0" autoFill="0" autoLine="0" autoPict="0"><anchor moveWithCells="1"><from><xdr:col>2</xdr:col><xdr:colOff>${a.x1 * EMU}</xdr:colOff><xdr:row>${b.row - 1}</xdr:row><xdr:rowOff>${a.y1 * EMU}</xdr:rowOff></from><to><xdr:col>2</xdr:col><xdr:colOff>${a.x2 * EMU}</xdr:colOff><xdr:row>${b.row - 1}</xdr:row><xdr:rowOff>${a.y2 * EMU}</xdr:rowOff></to></anchor></controlPr></control></mc:Choice></mc:AlternateContent>`;
    })
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
<dimension ref="A1:C${r - 1}"/>
<sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>
<sheetFormatPr baseColWidth="10" defaultRowHeight="16"/>
<cols><col min="1" max="1" width="15" customWidth="1"/><col min="2" max="2" width="40.5" customWidth="1"/><col min="3" max="3" width="15" customWidth="1"/></cols>
<sheetData>${rows.join('')}</sheetData>
<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>${
    boxes.length
      ? `<drawing r:id="rId1"/><legacyDrawing r:id="rId2"/><mc:AlternateContent><mc:Choice Requires="x14"><controls>${controls}</controls></mc:Choice></mc:AlternateContent>`
      : ''
  }
</worksheet>`;
  return { xml, boxes };
}

/** Флажок — по центру ячейки «Статус», в пикселях от её левого верхнего угла. */
function boxAnchor(b: Box) {
  const rowPx = Math.round((b.ht * 96) / 72);
  const x1 = Math.round((COL_PX[2] - BOX_W) / 2);
  const y1 = Math.max(0, Math.round((rowPx - BOX_H) / 2));
  return { x1, y1, x2: x1 + BOX_W, y2: Math.min(rowPx, y1 + BOX_H) };
}

/**
 * Флажки — элементы управления формы, как «Разработчик → Вставить → Флажок»:
 * кликаются в любом настольном Excel. Excel хранит их трижды — в VML (старый
 * формат), в drawing и в ctrlProp на каждый флажок — и ждёт все три.
 */
function checkboxParts(boxes: Box[]): [string, string][] {
  const anchors = boxes.map((b, i) => {
    const a = boxAnchor(b);
    return `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14"><xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>2</xdr:col><xdr:colOff>${a.x1 * EMU}</xdr:colOff><xdr:row>${b.row - 1}</xdr:row><xdr:rowOff>${a.y1 * EMU}</xdr:rowOff></xdr:from><xdr:to><xdr:col>2</xdr:col><xdr:colOff>${a.x2 * EMU}</xdr:colOff><xdr:row>${b.row - 1}</xdr:row><xdr:rowOff>${a.y2 * EMU}</xdr:rowOff></xdr:to><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${1025 + i}" name="Check Box ${i + 1}" hidden="1"><a:extLst><a:ext uri="{63B3BB69-23CF-44E3-9099-C40C66FF867C}"><a14:compatExt spid="_x0000_s${1025 + i}"/></a:ext></a:extLst></xdr:cNvPr><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></xdr:spPr><xdr:txBody><a:bodyPr vertOverflow="clip" wrap="square" lIns="27432" tIns="27432" rIns="0" bIns="27432" anchor="ctr" upright="1"/><a:lstStyle/><a:p><a:pPr algn="l" rtl="0"><a:defRPr sz="1000"/></a:pPr></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor></mc:Choice><mc:Fallback/></mc:AlternateContent>`;
  });
  const left = (COL_PX[0] + COL_PX[1]) * 0.75;
  const shapes = boxes.map((b, i) => {
    const a = boxAnchor(b);
    return `<v:shape id="_x0000_s${1025 + i}" type="#_x0000_t201" style="position:absolute;margin-left:${left + a.x1 * 0.75}pt;margin-top:${b.top + a.y1 * 0.75}pt;width:${BOX_W * 0.75}pt;height:${(a.y2 - a.y1) * 0.75}pt;z-index:${i + 1};mso-wrap-style:tight" filled="f" fillcolor="window [65]" stroked="f" strokecolor="windowText [64]" o:insetmode="auto"><v:path shadowok="t" strokeok="t" fillok="t"/><o:lock v:ext="edit" rotation="t"/><v:textbox style="mso-direction-alt:auto" o:singleclick="f"><div style="text-align:left"></div></v:textbox><x:ClientData ObjectType="Checkbox"><x:SizeWithCells/><x:Anchor>2, ${a.x1}, ${b.row - 1}, ${a.y1}, 2, ${a.x2}, ${b.row - 1}, ${a.y2}</x:Anchor><x:AutoFill>False</x:AutoFill><x:AutoLine>False</x:AutoLine><x:TextVAlign>Center</x:TextVAlign>${b.checked ? '<x:Checked>1</x:Checked>' : ''}<x:NoThreeD/></x:ClientData></v:shape>`;
  });
  // Номера фигур идут блоками по 1024 — VML перечисляет все занятые блоки.
  const blocks = [...new Set(boxes.map((_, i) => Math.floor((1025 + i) / 1024)))].join(',');
  return [
    [
      'xl/worksheets/_rels/sheet1.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/>${boxes
        .map((_, i) => `<Relationship Id="rId${3 + i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/ctrlProp" Target="../ctrlProps/ctrlProp${i + 1}.xml"/>`)
        .join('')}</Relationships>`,
    ],
    [
      'xl/drawings/drawing1.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors.join('')}</xdr:wsDr>`,
    ],
    [
      'xl/drawings/vmlDrawing1.vml',
      `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${blocks}"/></o:shapelayout><v:shapetype id="_x0000_t201" coordsize="21600,21600" o:spt="201" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path shadowok="f" o:extrusionok="f" strokeok="f" fillok="f" o:connecttype="rect"/><o:lock v:ext="edit" shapetype="t"/></v:shapetype>${shapes.join('')}</xml>`,
    ],
    ...boxes.map((b, i): [string, string] => [
      `xl/ctrlProps/ctrlProp${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<formControlPr xmlns="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" objectType="CheckBox"${b.checked ? ' checked="Checked"' : ''} lockText="1" noThreeD="1"/>`,
    ]),
  ];
}

export function checklistXlsx(title: string, groups: XlsxGroup[]): Uint8Array {
  const { xml, boxes } = sheetXml(groups);
  const types = boxes.length
    ? `<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>${boxes
        .map((_, i) => `<Override PartName="/xl/ctrlProps/ctrlProp${i + 1}.xml" ContentType="application/vnd.ms-excel.controlproperties+xml"/>`)
        .join('')}`
    : '';
  const files: [string, string][] = [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${types}</Types>`,
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
    ['xl/worksheets/sheet1.xml', xml],
    ...(boxes.length ? checkboxParts(boxes) : []),
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
