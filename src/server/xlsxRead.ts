import { inflateRawSync } from 'node:zlib';

/**
 * Чтение .xlsx без библиотек — только то, что нужно для выписок: zip →
 * общие строки и листы → таблица значений. Берём лист, где больше всего
 * строк. Даты Excel хранит числами — их разбирает parseDay.
 */

function unzip(buf: Buffer): Map<string, Buffer> {
  // Конец центрального каталога ищем с хвоста (после него бывает комментарий).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!/^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    files.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data));
  }
  return files;
}

const unescape = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&amp;/g, '&');

const texts = (xml: string) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1])).join('');

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? 'A') n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

export type XCell = string | number | null;

/** Первый «большой» лист .xlsx → строки ячеек. Не xlsx — исключение. */
export function readXlsx(buf: Buffer): XCell[][] {
  const files = unzip(buf);
  const shared = files.has('xl/sharedStrings.xml') ? [...files.get('xl/sharedStrings.xml')!.toString('utf8').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1])) : [];
  let best: XCell[][] = [];
  for (const [name, data] of files) {
    if (!name.startsWith('xl/worksheets/')) continue;
    const rows: XCell[][] = [];
    for (const r of data.toString('utf8').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: XCell[] = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const body = c[2] ?? '';
        const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
        const idx = ref ? colIndex(ref) : row.length;
        const t = /\bt="(\w+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let val: XCell = null;
        if (t === 's' && v !== undefined) val = shared[+v] ?? null;
        else if (t === 'inlineStr') val = texts(body);
        else if (t === 'str' || t === 'e') val = v !== undefined ? unescape(v) : null;
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else if (v !== undefined) val = Number(v);
        while (row.length < idx) row.push(null);
        row[idx] = val;
      }
      if (row.some((x) => x !== null && x !== '')) rows.push(row);
    }
    if (rows.length > best.length) best = rows;
  }
  return best;
}
