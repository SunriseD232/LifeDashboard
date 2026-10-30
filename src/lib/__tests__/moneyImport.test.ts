import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readXlsx } from '@/server/xlsxRead';
import { checklistXlsx } from '../xlsx';
import {
  applyMapping,
  decodeText,
  detectMapping,
  importKeys,
  mergeScreens,
  parseAiTxs,
  parseCamt,
  parseCsv,
  parseDay,
  parseMt940,
  parseOfx,
  parseQif,
  parseSigned,
  validMapping,
} from '../moneyImport';

describe('суммы и даты', () => {
  it('суммы в разных записях', () => {
    expect(parseSigned('-1 234,56')).toBe(-1234.56);
    expect(parseSigned('1,234.56')).toBe(1234.56);
    expect(parseSigned('1.234,56 EUR')).toBe(1234.56);
    expect(parseSigned('(12.00)')).toBe(-12);
    expect(parseSigned('−500 ₽')).toBe(-500);
    expect(parseSigned('+120 000')).toBe(120000);
    expect(parseSigned('€-12.5')).toBe(-12.5);
    expect(parseSigned('500-')).toBe(-500);
    expect(parseSigned('0,5')).toBe(0.5);
    expect(parseSigned('12,40')).toBe(12.4);
    expect(parseSigned(-3.2)).toBe(-3.2);
    expect(parseSigned('')).toBeNull();
    expect(parseSigned('—')).toBeNull();
  });
  it('даты', () => {
    expect(parseDay('30.10.2026 18:42:01')).toBe('2026-10-30');
    expect(parseDay('30.10.26')).toBe('2026-10-30');
    expect(parseDay('2026-10-30T10:00:00')).toBe('2026-10-30');
    expect(parseDay('10/30/2026', 'mdy')).toBe('2026-10-30');
    expect(parseDay('20261030')).toBe('2026-10-30');
    expect(parseDay('30 Oct 2026')).toBe('2026-10-30');
    expect(parseDay('30 окт. 2026')).toBe('2026-10-30');
    expect(parseDay(46325)).toBe('2026-10-30');
    expect(parseDay('31.02.2026')).toBeNull();
    expect(parseDay('Итого')).toBeNull();
  });
  it('кодировка: Windows-1251 и UTF-8 с BOM', () => {
    const cp1251 = new Uint8Array([0xc4, 0xe0, 0xf2, 0xe0]); // «Дата»
    expect(decodeText(cp1251)).toBe('Дата');
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('A');
  });
});

describe('форматы', () => {
  it('OFX 1 (SGML)', () => {
    const ofx = `OFXHEADER:100
<OFX><SIGNONMSGSRSV1><SONRS><FI><ORG>ING</ORG></FI></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR<BANKACCTFROM><ACCTID>NL91INGB0001234567</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261029120000<TRNAMT>-12.40<FITID>A1<NAME>ALBERT HEIJN 1234<MEMO>Betaalautomaat
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261030<TRNAMT>2500.00<FITID>A2<NAME>Salaris
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const p = parseOfx(ofx)!;
    expect(p).toMatchObject({ format: 'OFX', bank: 'ING', currency: 'EUR', account_ref: 'NL91INGB0001234567' });
    expect(p.txs).toEqual([
      { day: '2026-10-29', amount_minor: -1240, currency: 'EUR', description: 'ALBERT HEIJN 1234 · Betaalautomaat', ext_id: 'A1' },
      { day: '2026-10-30', amount_minor: 250000, currency: 'EUR', description: 'Salaris', ext_id: 'A2' },
    ]);
  });

  it('QIF', () => {
    const p = parseQif('!Type:Bank\nD10/29/2026\nT-45.00\nPShell\nLAuto\n^\nD10/30/2026\nT1,200.00\nPEmployer\n^\n')!;
    expect(p.txs).toEqual([
      { day: '2026-10-29', amount_minor: -4500, currency: null, description: 'Shell', bank_category: 'Auto' },
      { day: '2026-10-30', amount_minor: 120000, currency: null, description: 'Employer', bank_category: undefined },
    ]);
  });

  it('CAMT.053 с пространством имён', () => {
    const xml = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
      <Acct><Id><IBAN>DE89370400440532013000</IBAN></Id><Ccy>EUR</Ccy></Acct>
      <Ntry><NtryRef>1</NtryRef><Amt Ccy="EUR">24.99</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-10-28</Dt></BookgDt><AcctSvcrRef>REF-1</AcctSvcrRef>
        <NtryDtls><TxDtls><RltdPties><Cdtr><Nm>Netflix &amp; Co</Nm></Cdtr></RltdPties><RmtInf><Ustrd>Abo Oktober</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
      <Ntry><Amt Ccy="EUR">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-10-29</Dt></BookgDt>
        <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Max Mustermann</Nm></Dbtr></RltdPties></TxDtls></NtryDtls></Ntry>
    </Stmt></BkToCstmrStmt></Document>`;
    const p = parseCamt(xml)!;
    expect(p).toMatchObject({ format: 'CAMT.053', currency: 'EUR', account_ref: 'DE89370400440532013000' });
    expect(p.txs[0]).toEqual({ day: '2026-10-28', amount_minor: -2499, currency: 'EUR', description: 'Netflix & Co · Abo Oktober', ext_id: 'REF-1' });
    expect(p.txs[1]).toMatchObject({ amount_minor: 10000, description: 'Max Mustermann', ext_id: undefined });
  });

  it('MT940 с простым и структурным :86:', () => {
    const mt = [':20:STMT', ':25:12345678/0012345678', ':28C:1/1', ':60F:C261027EUR1000,00', ':61:2610281028D12,50NMSCNONREF//B1', ':86:REWE SAGT DANKE', ':61:261029C200,NTRFNONREF', ':86:166?00GUTSCHRIFT?20Miete Oktober?32Anna Schmidt', ':62F:C261029EUR1187,50'].join('\r\n');
    const p = parseMt940(mt)!;
    expect(p).toMatchObject({ currency: 'EUR', account_ref: '12345678/0012345678' });
    expect(p.txs).toEqual([
      { day: '2026-10-28', amount_minor: -1250, currency: 'EUR', description: 'REWE SAGT DANKE', ext_id: 'B1' },
      { day: '2026-10-29', amount_minor: 20000, currency: 'EUR', description: 'Anna Schmidt · Miete Oktober', ext_id: undefined },
    ]);
  });

  it('не тот формат — null', () => {
    expect(parseOfx('a;b')).toBeNull();
    expect(parseQif('a;b')).toBeNull();
    expect(parseCamt('<x/>')).toBeNull();
    expect(parseMt940('a')).toBeNull();
  });
});

describe('таблицы', () => {
  it('выписка как у Т-Банка: «;», статус, валюта операции, категория', () => {
    const csv =
      '"Дата операции";"Дата платежа";"Номер карты";"Статус";"Сумма операции";"Валюта операции";"Сумма платежа";"Валюта платежа";"Кэшбэк";"Категория";"MCC";"Описание"\n' +
      '"30.10.2026 18:42:01";"30.10.2026";"*1234";"OK";"-1477,60";"RUB";"-1477,60";"RUB";"";"Супермаркеты";"5411";"Пятёрочка"\n' +
      '"29.10.2026 10:00:00";"30.10.2026";"*1234";"OK";"-12,00";"EUR";"-1132,80";"RUB";"";"Транспорт";"4121";"Uber"\n' +
      '"29.10.2026 09:00:00";"";"*1234";"FAILED";"-500,00";"RUB";"-500,00";"RUB";"";"Разное";"";"Отклонено"\n' +
      '"28.10.2026 12:00:00";"28.10.2026";"";"OK";"120000,00";"RUB";"120000,00";"RUB";"";"Пополнения";"";"Зарплата"\n';
    const rows = parseCsv(csv);
    const m = detectMapping(rows)!;
    expect(m).toMatchObject({ header_row: 0, date: 0, amount: 6, currency: 7, orig_amount: 4, orig_currency: 5, category: 9, status: 3 });
    const txs = applyMapping(rows, m);
    expect(txs).toHaveLength(3);
    expect(txs[0]).toMatchObject({ day: '2026-10-30', amount_minor: -147760, currency: 'RUB', bank_category: 'Супермаркеты', description: 'Пятёрочка' });
    expect(txs[1]).toMatchObject({ amount_minor: -113280, orig_amount_minor: 1200, orig_currency: 'EUR' });
    expect(txs[2].amount_minor).toBe(12000000);
  });

  it('английская выписка с Paid in / Paid out и датами мм/дд', () => {
    const rows = parseCsv('Date,Description,Paid out,Paid in,Balance\n10/28/2026,TESCO STORES,12.40,,100.00\n10/30/2026,SALARY,,2000.00,2100.00\n');
    const m = detectMapping(rows)!;
    expect(m).toMatchObject({ debit: 2, credit: 3, date_order: 'mdy' });
    expect(applyMapping(rows, m, 'GBP')).toEqual([
      expect.objectContaining({ day: '2026-10-28', amount_minor: -1240, currency: 'GBP', description: 'TESCO STORES' }),
      expect.objectContaining({ day: '2026-10-30', amount_minor: 200000 }),
    ]);
  });

  it('заголовок не в первой строке и столбец «Тип» вместо знака', () => {
    const rows = parseCsv('Bank XYZ statement\nAccount 123\n\nDate;Type;Amount;Details\n28.10.2026;Debit;12,40;Coffee\n29.10.2026;Credit;100,00;Refund\n');
    const m = detectMapping(rows)!;
    expect(m.header_row).toBe(2);
    expect(applyMapping(rows, m).map((t) => t.amount_minor)).toEqual([-1240, 10000]);
  });

  it('незнакомая таблица — null; шаблон от ИИ проверяется', () => {
    const rows = parseCsv('a,b,c\n1,2,3\n');
    expect(detectMapping(rows)).toBeNull();
    expect(validMapping({ date: 0, amount: 1, description: [2, 9] }, 3, 2)).toMatchObject({ date: 0, amount: 1, description: [2], date_order: 'dmy' });
    expect(validMapping({ date: 5, amount: 1, description: [2] }, 3, 2)).toBeNull();
    expect(validMapping({ date: 0, description: [2] }, 3, 2)).toBeNull();
  });

  it('xlsx: общие строки, числа, сжатие', () => {
    const shared = '<sst><si><t>Дата</t></si><si><t>Сумма</t></si><si><t>Описание</t></si><si><r><t>Кофе</t></r><r><t> &amp; булка</t></r></si></sst>';
    const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' + '<row r="2"><c r="A2"><v>46325</v></c><c r="B2"><v>-350.5</v></c><c r="C2" t="s"><v>3</v></c></row></sheetData></worksheet>';
    const rows = readXlsx(zip({ 'xl/sharedStrings.xml': shared, 'xl/worksheets/sheet1.xml': sheet }));
    expect(rows).toEqual([
      ['Дата', 'Сумма', 'Описание'],
      [46325, -350.5, 'Кофе & булка'],
    ]);
    const m = detectMapping(rows)!;
    expect(applyMapping(rows, m, 'RUB')).toEqual([expect.objectContaining({ day: '2026-10-30', amount_minor: -35050, description: 'Кофе & булка' })]);
    // Файл, который делает само приложение (без сжатия), тоже читается.
    expect(readXlsx(Buffer.from(checklistXlsx('Тест', [{ name: null, items: [{ title: 'Пункт', done: false }] }]))).flat()).toContain('Пункт');
  });
});

describe('повторы', () => {
  it('ключи: id банка, иначе день+сумма+описание; два одинаковых кофе — разные', () => {
    const k = importKeys([
      { day: '2026-10-30', amount_minor: -350, description: 'Кофе 1234' },
      { day: '2026-10-30', amount_minor: -350, description: 'кофе 9999' },
      { day: '2026-10-30', amount_minor: -350, description: 'x', ext_id: 'F1' },
    ]);
    expect(k).toEqual(['h:2026-10-30|-350|кофе', 'h:2026-10-30|-350|кофе#2', 'id:F1']);
  });
  it('скриншоты: перекрытие склеивается, два кофе на одном снимке остаются', () => {
    const a = { day: '2026-10-30', amount_minor: -350, currency: null, description: 'Кофе' };
    const b = { day: '2026-10-30', amount_minor: -1200, currency: null, description: 'Пятёрочка' };
    const c = { day: '2026-10-29', amount_minor: -400, currency: null, description: 'Такси' };
    const r = mergeScreens([
      [a, a, b],
      [b, c],
    ]);
    expect(r.txs).toEqual([a, a, b, c]);
    expect(r.merged).toBe(1);
  });
  it('ответ ИИ: будущие даты и мусор отбрасываются', () => {
    const r = parseAiTxs({ bank: 'Т-Банк', currency: 'rub', txs: [{ date: '2026-10-30', amount: '-1 200', description: 'Пятёрочка', category: 'Супермаркеты' }, { date: '2026-11-30', amount: -5 }, { date: '2026-10-29', amount: 0 }] }, '2026-10-30');
    expect(r).toEqual({ bank: 'Т-Банк', currency: 'RUB', account_ref: undefined, txs: [{ day: '2026-10-30', amount_minor: -120000, currency: 'RUB', description: 'Пятёрочка', bank_category: 'Супермаркеты' }] });
  });
});

/** Маленький zip со сжатием — как xlsx из Excel. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text);
    const data = deflateRawSync(raw);
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(n.length, 26);
    locals.push(lh, n, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
