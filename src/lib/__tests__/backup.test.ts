import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dailyBackup, dailyToDelete, snapshot } from '../backup';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ld-backup-'));

describe('dailyToDelete', () => {
  it('оставляет 14 свежих ночных копий и не трогает остальные файлы', () => {
    const days = Array.from({ length: 20 }, (_, i) => `daily-2026-09-${String(i + 1).padStart(2, '0')}.db`);
    const files = [...days, 'pre-migrate-v1-2026-09-01-00-00-00.db', 'notes.txt'];
    const del = dailyToDelete(files);
    expect(del).toHaveLength(6);
    expect(del).toContain('daily-2026-09-01.db');
    expect(del).not.toContain('daily-2026-09-20.db');
    expect(del.some((f) => f.startsWith('pre-migrate'))).toBe(false);
  });
});

describe('dailyBackup', () => {
  it('делает одну копию в сутки, и она открывается с данными', () => {
    const dir = tmp();
    const db = new Database(':memory:');
    db.exec("create table t (x text); insert into t values ('ok')");
    const now = new Date('2026-10-02T03:00:00Z');
    const file = dailyBackup(db, dir, now);
    expect(file).toBe(path.join(dir, 'daily-2026-10-02.db'));
    expect(dailyBackup(db, dir, now)).toBeNull();
    expect(new Database(file!, { readonly: true }).prepare('select x from t').get()).toEqual({ x: 'ok' });
  });

  it('snapshot кладёт файл с именем и временем', () => {
    const dir = tmp();
    const db = new Database(':memory:');
    db.exec('create table t (x)');
    const file = snapshot(db, 'pre-migrate-v1', dir);
    expect(path.basename(file)).toMatch(/^pre-migrate-v1-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.db$/);
    expect(fs.existsSync(file)).toBe(true);
  });
});
