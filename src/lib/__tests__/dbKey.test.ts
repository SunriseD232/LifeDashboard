import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { encryptExisting, isPlainFile, unlock } from '../dbKey';

const KEY = 'test-key-0123456789-abcdefghijklmnop';

describe('шифрование базы', () => {
  it('шифрует базу и старые копии; без ключа не открыть, с ключом — всё на месте', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-enc-'));
    const file = path.join(dir, 'main.db');
    const backups = path.join(dir, 'backups');
    fs.mkdirSync(backups);
    const plain = new Database(file);
    plain.pragma('journal_mode = WAL');
    plain.exec("create table notes (body text); insert into notes values ('Пароль от домофона 1234')");
    plain.prepare('vacuum into ?').run(path.join(backups, 'daily-2026-10-01.db'));
    plain.close();
    expect(isPlainFile(file)).toBe(true);

    expect(encryptExisting(Database, file, backups, KEY)).toBe(2);
    expect(isPlainFile(file)).toBe(false);
    expect(fs.readFileSync(file).includes(Buffer.from('домофона'))).toBe(false);
    expect(isPlainFile(path.join(backups, 'daily-2026-10-01.db'))).toBe(false);

    expect(() => new Database(file).prepare('select * from notes').all()).toThrow();
    const wrong = new Database(file);
    expect(() => unlock(wrong, 'wrong-key-0123456789-abcdefghijklmno')).toThrow(/LD_DATA_KEY/);
    wrong.close();

    const ok = new Database(file);
    unlock(ok, KEY);
    expect(ok.prepare('select body from notes').get()).toEqual({ body: 'Пароль от домофона 1234' });
    // Новая копия тем же ключом — тоже зашифрована.
    ok.prepare('vacuum into ?').run(path.join(backups, 'daily-2026-10-02.db'));
    ok.close();
    expect(isPlainFile(path.join(backups, 'daily-2026-10-02.db'))).toBe(false);
    // Повторный запуск ничего не трогает.
    expect(encryptExisting(Database, file, backups, KEY)).toBe(0);
  });
});
