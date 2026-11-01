import type Database from 'better-sqlite3';
import { householdOf } from './household';

/**
 * События семьи для push: «вам поручили», «добавили в покупки», «зовут в
 * семью», «общее дело сделано». Пишутся сюда, а рассылка (src/lib/push.ts)
 * раз в тик собирает их в одно уведомление на человека — после паузы,
 * чтобы пять покупок подряд пришли одним сообщением, и не в тихие часы.
 */

export const FAMILY_PUSH = ['invite', 'assign', 'shopping', 'done'] as const;
export type FamilyPush = (typeof FAMILY_PUSH)[number];
/** По умолчанию — всё, кроме «сделано»: его обычно смотрят в списке. */
export const DEFAULT_FAMILY_PUSH: FamilyPush[] = ['invite', 'assign', 'shopping'];

export function familyPushOf(raw: string | null | undefined): FamilyPush[] {
  if (raw == null) return [...DEFAULT_FAMILY_PUSH];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? FAMILY_PUSH.filter((k) => v.includes(k)) : [...DEFAULT_FAMILY_PUSH];
  } catch {
    return [...DEFAULT_FAMILY_PUSH];
  }
}

function wants(d: Database.Database, userId: string, kind: FamilyPush): boolean {
  const row = d.prepare('select family_push from user_settings where user_id = ?').get(userId) as { family_push: string | null } | undefined;
  return familyPushOf(row?.family_push).includes(kind);
}

/** Событие одному человеку (если он такие хочет). */
export function notifyUser(d: Database.Database, userId: string, kind: FamilyPush, text: string, url: string | null = null): void {
  if (!wants(d, userId, kind)) return;
  d.prepare('insert into family_events (user_id, kind, text, url) values (?, ?, ?, ?)').run(userId, kind, text.slice(0, 200), url);
}

/** Событие остальным в семье того, кто сделал (себе не шлём). */
export function notifyFamily(d: Database.Database, fromUser: string, kind: FamilyPush, text: string, url: string | null = null, hh = householdOf(d, fromUser)): void {
  if (!hh) return;
  const others = d.prepare('select user_id from household_members where household_id = ? and user_id <> ?').all(hh, fromUser) as { user_id: string }[];
  for (const o of others) notifyUser(d, o.user_id, kind, text, url);
}

export function loginOf(d: Database.Database, userId: string): string {
  return (d.prepare('select login from users where id = ?').get(userId) as { login: string } | undefined)?.login ?? 'кто-то';
}

/** Пауза перед отправкой: за это время события одного вида копятся в пачку. */
export const BATCH_SEC = 90;

export interface PendingBatch {
  userId: string;
  kind: FamilyPush;
  texts: string[];
  url: string | null;
  ids: number[];
}

/**
 * Готовое к отправке: по человеку и виду, если последнее событие вида
 * старше паузы. Совсем старое (сутки) выбрасываем — уже не новость.
 */
export function pendingBatches(d: Database.Database): PendingBatch[] {
  d.prepare("delete from family_events where created_at < datetime('now', '-1 day')").run();
  const rows = d
    .prepare(
      `select e.id, e.user_id, e.kind, e.text, e.url from family_events e
       where (select max(created_at) from family_events x where x.user_id = e.user_id and x.kind = e.kind) <= datetime('now', '-${BATCH_SEC} second')
       order by e.id`,
    )
    .all() as { id: number; user_id: string; kind: FamilyPush; text: string; url: string | null }[];
  const out = new Map<string, PendingBatch>();
  for (const r of rows) {
    const k = `${r.user_id}|${r.kind}`;
    const b = out.get(k) ?? { userId: r.user_id, kind: r.kind, texts: [], url: r.url, ids: [] };
    b.texts.push(r.text);
    b.ids.push(r.id);
    out.set(k, b);
  }
  return [...out.values()];
}

/** Заголовок и текст одного уведомления о пачке событий. */
export function batchMessage(b: Pick<PendingBatch, 'kind' | 'texts'>): { title: string; body: string } {
  const n = b.texts.length;
  const list = b.texts.slice(0, 5).join(', ') + (n > 5 ? ` и ещё ${n - 5}` : '');
  switch (b.kind) {
    case 'invite':
      return { title: 'Приглашение в семью', body: b.texts.join('; ') };
    case 'assign':
      return { title: n === 1 ? 'Вам поручили' : `Вам поручили: ${n}`, body: list };
    case 'shopping':
      return { title: 'Добавили в покупки', body: list };
    case 'done':
      return { title: n === 1 ? 'Сделано в семье' : `Сделано в семье: ${n}`, body: list };
  }
}
