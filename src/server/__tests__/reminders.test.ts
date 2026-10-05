import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '@/lib/migrations';
import { reminders } from '../api/reminders';
import type { Ctx } from '../http';
import { readReminders } from '../reminderStore';

function setup() {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  migrate(d);
  d.prepare("insert into users (id, login, password_hash) values ('me', 'me', 'x')").run();
  return d;
}

const call = (d: Database.Database, method: string, body: Record<string, unknown>, id?: string) =>
  reminders({ d, userId: 'me', method, body, id, action: undefined } as unknown as Ctx) as { id: string };

describe('метка у напоминания', () => {
  it('ставится при создании и меняется потом', () => {
    const d = setup();
    const rule = { kind: 'once', date: '2026-10-05' };
    const { id } = call(d, 'POST', { title: 'Созвон', times: ['15:00'], rule });
    expect(readReminders(d, 'me')[0].tag).toBeNull();
    call(d, 'PATCH', { tag: ' работа ' }, id);
    expect(readReminders(d, 'me')[0].tag).toBe('работа');
    call(d, 'PATCH', { tag: '' }, id);
    expect(readReminders(d, 'me')[0].tag).toBeNull();
    call(d, 'POST', { title: 'Мусор', times: ['20:00'], rule, tag: 'дом' });
    expect(readReminders(d, 'me')[1].tag).toBe('дом');
  });
});
