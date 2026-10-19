import { describe, expect, it } from 'vitest';
import { checklistXlsx, sheetName, sheetXml } from '../xlsx';

describe('выгрузка чек-листа в xlsx', () => {
  const groups = [
    { name: 'Тема 1', items: [{ title: 'Дело 1', done: true }, { title: 'Дело 2', done: false }, { title: 'Дело 3', done: false }] },
    { name: 'Тема 2', items: [{ title: 'A & <B>', note: '2 шт', done: false }] },
  ];

  it('лист как в образце: шапка на 4 строки, темы, разделитель между группами', () => {
    const x = sheetXml(groups);
    expect(x).toContain('<mergeCell ref="A1:A4"/>');
    expect(x).toContain('<mergeCell ref="B1:B4"/>');
    expect(x).toContain('<mergeCell ref="C1:C4"/>');
    // Тема 1 — строка 5, дела 6–8, разделитель 9–10, Тема 2 — 11.
    expect(x).toMatch(/<c r="B5" s="4" t="inlineStr"><is><t xml:space="preserve">Тема 1</);
    expect(x).toContain('<c r="A8" s="2"><v>3</v></c>');
    expect(x).toContain('<mergeCell ref="A9:C9"/>');
    expect(x).toContain('<mergeCell ref="A10:C10"/>');
    expect(x).toMatch(/<c r="B11"[^>]*><is><t xml:space="preserve">Тема 2</);
    expect(x).toContain('<c r="A12" s="2"><v>1</v></c>');
    expect(x).toMatch(/r="C6"[^>]*><is><t xml:space="preserve">☑</);
    expect(x).toMatch(/r="C7"[^>]*><is><t xml:space="preserve">☐</);
    expect(x).toContain('A &amp; &lt;B&gt; (2 шт)');
  });

  it('одна безымянная группа — без строки «Тема»', () => {
    const x = sheetXml([{ name: null, items: [{ title: 'X', done: false }] }]);
    expect(x).toMatch(/<c r="B5"[^>]*><is><t xml:space="preserve">X</);
  });

  it('имя листа без запрещённых знаков и не длиннее 31', () => {
    expect(sheetName('a/b:c')).toBe('a b c');
    expect(sheetName('x'.repeat(40))).toHaveLength(31);
    expect(sheetName('  ')).toBe('Чек-лист');
  });

  it('zip: подписи и число файлов', () => {
    const z = checklistXlsx('Поездка', groups);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50);
    expect(v.getUint16(z.length - 22 + 10, true)).toBe(6);
  });
});
