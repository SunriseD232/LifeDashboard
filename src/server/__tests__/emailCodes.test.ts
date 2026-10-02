import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '@/lib/migrations';
import { checkCode, issueCode, MAX_ATTEMPTS, normEmail, PER_EMAIL_HOUR, PER_IP_HOUR } from '../emailCodes';

const db = () => {
  const d = new Database(':memory:');
  migrate(d);
  return d;
};
const t0 = new Date('2026-10-02T10:00:00Z');
const at = (sec: number) => new Date(t0.getTime() + sec * 1000);
const code = (r: ReturnType<typeof issueCode>) => (r.ok ? r.code : (() => { throw new Error(r.error); })());

describe('коды из писем', () => {
  it('почта нормализуется и проверяется', () => {
    expect(normEmail('  Anna@Mail.RU ')).toBe('anna@mail.ru');
    expect(normEmail('anna@mail')).toBeNull();
    expect(normEmail('без собаки')).toBeNull();
  });

  it('верный код срабатывает один раз', () => {
    const d = db();
    const c = code(issueCode(d, 'a@b.ru', 'register', '1.1.1.1', t0));
    expect(c).toMatch(/^\d{6}$/);
    expect(checkCode(d, 'a@b.ru', 'register', c, at(30))).toBe('ok');
    expect(checkCode(d, 'a@b.ru', 'register', c, at(31))).toBe('expired');
  });

  it('пробелы в коде не мешают, чужая цель — не подходит', () => {
    const d = db();
    const c = code(issueCode(d, 'a@b.ru', 'register', 'ip', t0));
    expect(checkCode(d, 'a@b.ru', 'reset', c, at(5))).toBe('expired');
    expect(checkCode(d, 'a@b.ru', 'register', `${c.slice(0, 3)} ${c.slice(3)}`, at(5))).toBe('ok');
  });

  it('после 5 неверных — блокировка даже для верного кода', () => {
    const d = db();
    const c = code(issueCode(d, 'a@b.ru', 'register', 'ip', t0));
    const wrong = c === '000000' ? '111111' : '000000';
    for (let i = 1; i < MAX_ATTEMPTS; i++) expect(checkCode(d, 'a@b.ru', 'register', wrong, at(i))).toBe('wrong');
    expect(checkCode(d, 'a@b.ru', 'register', wrong, at(10))).toBe('locked');
    expect(checkCode(d, 'a@b.ru', 'register', c, at(11))).toBe('locked');
  });

  it('код живёт 10 минут', () => {
    const d = db();
    const c = code(issueCode(d, 'a@b.ru', 'reset', 'ip', t0));
    expect(checkCode(d, 'a@b.ru', 'reset', c, at(601))).toBe('expired');
  });

  it('новый код — не чаще раза в минуту и отменяет прежний', () => {
    const d = db();
    const c1 = code(issueCode(d, 'a@b.ru', 'register', 'ip', t0));
    const again = issueCode(d, 'a@b.ru', 'register', 'ip', at(30));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/30 с/);
    const c2 = code(issueCode(d, 'a@b.ru', 'register', 'ip', at(61)));
    if (c1 !== c2) expect(checkCode(d, 'a@b.ru', 'register', c1, at(62))).toBe('wrong');
    expect(checkCode(d, 'a@b.ru', 'register', c2, at(63))).toBe('ok');
  });

  it('лимиты в час: на почту и на IP', () => {
    const d = db();
    for (let i = 0; i < PER_EMAIL_HOUR; i++) expect(issueCode(d, 'a@b.ru', 'register', `ip${i}`, at(i * 61)).ok).toBe(true);
    expect(issueCode(d, 'a@b.ru', 'register', 'ipX', at(PER_EMAIL_HOUR * 61)).ok).toBe(false);
    const d2 = db();
    for (let i = 0; i < PER_IP_HOUR; i++) expect(issueCode(d2, `u${i}@b.ru`, 'register', 'same', at(i)).ok).toBe(true);
    expect(issueCode(d2, 'last@b.ru', 'register', 'same', at(PER_IP_HOUR)).ok).toBe(false);
  });
});
