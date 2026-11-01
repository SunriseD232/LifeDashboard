import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '@/lib/migrations';
import { household } from '../api/household';
import { items } from '../api/items';
import { reminders } from '../api/reminders';
import { tasks } from '../api/tasks';
import { vacations } from '../api/vacations';
import { batchMessage, pendingBatches } from '../familyEvents';
import { householdInfo, householdOf, invitesFor } from '../household';
import type { Ctx } from '../http';
import { goals } from '../moneyPlans';
import { doneByOthers, doneKeys, readReminders } from '../reminderStore';
import { readItems } from '../checklistStore';
import { readTasks } from '../taskStore';

function setup() {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  migrate(d);
  const user = d.prepare("insert into users (id, login, password_hash) values (?, ?, 'x')");
  ['me', 'wife', 'son', 'stranger'].forEach((u) => user.run(u, u));
  return d;
}

const call = (fn: (c: Ctx) => unknown, d: Database.Database, userId: string, method: string, body: Record<string, unknown> = {}, id?: string, action?: string) =>
  fn({ d, userId, method, body, id, action } as unknown as Ctx);

/** Семья me + wife: создали, позвали, приняла. */
function family(d: Database.Database) {
  call(household, d, 'me', 'POST', { name: 'Дом' });
  call(household, d, 'me', 'POST', { login: 'wife' }, 'members');
  call(household, d, 'wife', 'POST', {}, 'invites', invitesFor(d, 'wife')[0].id);
  return householdOf(d, 'me')!;
}

describe('приглашения в семью', () => {
  it('добавить без согласия нельзя: сначала приглашение, вступает сам человек', () => {
    const d = setup();
    call(household, d, 'me', 'POST', { name: 'Дом' });
    call(household, d, 'me', 'POST', { login: 'Wife' }, 'members');
    expect(householdOf(d, 'wife')).toBeNull();
    const inv = invitesFor(d, 'wife');
    expect(inv).toMatchObject([{ family: 'Дом', from: 'me' }]);
    expect(householdInfo(d, 'me')!.invited.map((x) => x.login)).toEqual(['wife']);
    call(household, d, 'wife', 'POST', {}, 'invites', inv[0].id);
    expect(householdOf(d, 'wife')).toBe(householdOf(d, 'me'));
    expect(householdInfo(d, 'me')!.invited).toEqual([]);
  });

  it('ответ одинаковый, есть такой логин или нет', () => {
    const d = setup();
    call(household, d, 'me', 'POST', { name: 'Дом' });
    expect(call(household, d, 'me', 'POST', { login: 'nobody' }, 'members')).toEqual({ ok: true });
    expect(call(household, d, 'me', 'POST', { login: 'son' }, 'members')).toEqual({ ok: true });
    // Человек в другой семье — тоже не узнать.
    call(household, d, 'stranger', 'POST', { name: 'Чужие' });
    expect(call(household, d, 'me', 'POST', { login: 'stranger' }, 'members')).toEqual({ ok: true });
    expect(householdInfo(d, 'me')!.invited.map((x) => x.login)).toEqual(['nobody', 'son', 'stranger']);
  });

  it('чужое приглашение не принять; в семье — сначала выйти; отклонить можно', () => {
    const d = setup();
    call(household, d, 'me', 'POST', { name: 'Дом' });
    call(household, d, 'me', 'POST', { login: 'son' }, 'members');
    const id = invitesFor(d, 'son')[0].id;
    expect(() => call(household, d, 'stranger', 'POST', {}, 'invites', id)).toThrow(/не найдено/);
    call(household, d, 'son', 'POST', { name: 'Своя' });
    expect(() => call(household, d, 'son', 'POST', {}, 'invites', id)).toThrow(/уже в семье/);
    call(household, d, 'son', 'DELETE', {}, 'invites', id);
    expect(invitesFor(d, 'son')).toEqual([]);
  });

  it('приглашённому приходит событие для push', () => {
    const d = setup();
    call(household, d, 'me', 'POST', { name: 'Дом' });
    call(household, d, 'me', 'POST', { login: 'wife' }, 'members');
    d.prepare("update family_events set created_at = datetime('now', '-5 minute')").run();
    const b = pendingBatches(d);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ userId: 'wife', kind: 'invite' });
    expect(batchMessage(b[0]).body).toContain('«Дом»');
  });
});

describe('уход из семьи и кухня', () => {
  it('запасы остаются у каждого ушедшего, холодильник — у последнего', () => {
    const d = setup();
    const hh = family(d);
    const pid = (d.prepare('select id from products limit 1').get() as { id: string }).id;
    d.prepare('insert into pantry (scope, product_id) values (?, ?)').run(hh, pid);
    d.prepare("insert into fridge_items (id, scope, name, title) values ('f1', ?, 'молоко', 'Молоко')").run(hh);
    call(household, d, 'wife', 'DELETE', {}, 'members', 'wife');
    expect(d.prepare("select count(*) as n from pantry where scope = 'u:wife'").get()).toEqual({ n: 1 });
    call(household, d, 'me', 'DELETE', {}, 'members', 'me');
    expect(d.prepare("select scope from fridge_items where id = 'f1'").get()).toEqual({ scope: 'u:me' });
    expect(d.prepare("select count(*) as n from pantry where scope = 'u:me'").get()).toEqual({ n: 1 });
    expect(d.prepare('select count(*) as n from pantry where scope = ?').get(hh)).toEqual({ n: 0 });
  });

  it('вступил — его запасы сливаются с семейными', () => {
    const d = setup();
    const pid = (d.prepare('select id from products limit 1').get() as { id: string }).id;
    d.prepare("insert into pantry (scope, product_id) values ('u:wife', ?)").run(pid);
    const hh = family(d);
    expect(d.prepare('select count(*) as n from pantry where scope = ?').get(hh)).toEqual({ n: 1 });
  });
});

describe('общие напоминания', () => {
  const rule = { kind: 'repeat', unit: 'day', every: 1, start: '2026-10-01' };

  it('видны семье; сделал один — сделано у всех, и видно кто', () => {
    const d = setup();
    family(d);
    const { id } = call(reminders, d, 'me', 'POST', { title: 'Полить цветы', times: ['10:00'], rule, shared: true }) as { id: string };
    expect(readReminders(d, 'wife').map((r) => [r.title, r.author])).toEqual([['Полить цветы', 'me']]);
    expect(readReminders(d, 'stranger')).toEqual([]);
    call(reminders, d, 'wife', 'PUT', { day: '2026-11-01', slot: '10:00', done: true }, id, 'done');
    expect(doneKeys(d, 'me', '2026-11-01')).toEqual([`${id}@10:00`]);
    expect(doneByOthers(d, 'me', '2026-11-01')).toEqual({ [`${id}@10:00`]: 'wife' });
    expect(doneByOthers(d, 'wife', '2026-11-01')).toEqual({});
  });

  it('удалить и сделать личным — только автор', () => {
    const d = setup();
    family(d);
    const { id } = call(reminders, d, 'me', 'POST', { title: 'Мусор', times: ['20:00'], rule, shared: true }) as { id: string };
    expect(() => call(reminders, d, 'wife', 'DELETE', {}, id)).toThrow(/только автор/);
    expect(() => call(reminders, d, 'wife', 'PATCH', { shared: false }, id)).toThrow(/только автор/);
    call(reminders, d, 'wife', 'PATCH', { title: 'Вынести мусор' }, id);
    expect(readReminders(d, 'me')[0].title).toBe('Вынести мусор');
  });

  it('кто делает: только из семьи; поручили — событие ему', () => {
    const d = setup();
    family(d);
    expect(() => call(reminders, d, 'me', 'POST', { title: 'X', times: ['09:00'], rule, shared: true, assignee: 'stranger' })).toThrow(/из семьи/);
    call(reminders, d, 'me', 'POST', { title: 'Квартплата', times: ['09:00'], rule, shared: true, assignee: 'wife' });
    expect(readReminders(d, 'me')[0].assignee).toBe('wife');
    const ev = d.prepare('select user_id, kind from family_events').all();
    expect(ev).toEqual([{ user_id: 'wife', kind: 'assign' }]);
  });
});

describe('общие задачи и покупки', () => {
  it('кто делает и кто выполнил', () => {
    const d = setup();
    family(d);
    const { id } = call(tasks, d, 'me', 'POST', { title: 'Купить лампочку', shared: true, assignee: 'wife' }) as { id: string };
    call(tasks, d, 'wife', 'POST', { day: '2026-11-01' }, id, 'done');
    const t = readTasks(d, 'me', '2026-11-01').tasks.find((x) => x.id === id)!;
    expect(t).toMatchObject({ assignee: 'wife', done_by: 'wife' });
    // Сделал сам — «кто выполнил» не показываем.
    expect(readTasks(d, 'wife', '2026-11-01').tasks.find((x) => x.id === id)!.done_by).toBeNull();
  });

  it('личной задаче поручить нельзя — кто делает сбрасывается', () => {
    const d = setup();
    family(d);
    const { id } = call(tasks, d, 'me', 'POST', { title: 'Своё', assignee: 'wife' }) as { id: string };
    expect(readTasks(d, 'me', '2026-11-01').tasks.find((x) => x.id === id)!.assignee).toBeNull();
  });

  it('купленное в общем списке — с тем, кто купил', () => {
    const d = setup();
    const hh = family(d);
    d.prepare("insert into checklists (id, user_id, household_id, title, kind) values ('s', 'me', ?, 'Покупки', 'shopping')").run(hh);
    d.prepare("insert into checklist_items (id, checklist_id, user_id, title) values ('i', 's', 'me', 'Хлеб')").run();
    call(items, d, 'wife', 'PATCH', { done: true }, 'i');
    expect(readItems(d, 'me').find((x) => x.id === 'i')!.done_by).toBe('wife');
    expect(readItems(d, 'wife').find((x) => x.id === 'i')!.done_by).toBeNull();
  });
});

describe('отпуска и цели семьи', () => {
  it('отпуск видно семье, только если показали', () => {
    const d = setup();
    family(d);
    call(vacations, d, 'wife', 'POST', { start: '2099-07-01', end: '2099-07-10', shared: true });
    call(vacations, d, 'wife', 'POST', { title: 'Своё', start: '2099-08-01', end: '2099-08-03' });
    const v = call(vacations, d, 'me', 'GET') as { family: { login: string; start: string }[] };
    expect(v.family.map((x) => [x.login, x.start])).toEqual([['wife', '2099-07-01']]);
  });

  it('общая цель: откладывают все, меняет автор', () => {
    const d = setup();
    family(d);
    const { id } = goals(d, 'me', 'POST', undefined, { name: 'Отпуск', target_minor: 100000, currency: 'RUB', shared: true }) as { id: string };
    goals(d, 'wife', 'PATCH', id, { add_minor: 5000 });
    expect(d.prepare('select saved_minor from money_goals where id = ?').get(id)).toEqual({ saved_minor: 5000 });
    expect(() => goals(d, 'wife', 'DELETE', id, {})).toThrow(/только тот/);
    expect(() => goals(d, 'stranger', 'PATCH', id, { add_minor: 1 })).toThrow(/не найдена/);
  });
});
