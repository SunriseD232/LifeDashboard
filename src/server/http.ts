import type Database from 'better-sqlite3';
import type { NextRequest } from 'next/server';

/** Общее для обработчиков API (src/server/api/*): ошибки, проверка полей. */

export interface Ctx {
  req: NextRequest;
  method: string;
  body: Record<string, any>;
  userId: string;
  d: Database.Database;
  /** /api/<раздел>/<id>/<action> */
  id?: string;
  action?: string;
}

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function text(v: unknown, max: number, field: string, optional = false): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (optional) return null;
    throw new HttpError(400, `Заполните поле «${field}».`);
  }
  if (typeof v !== 'string') throw new HttpError(400, `Поле «${field}» должно быть текстом.`);
  const t = v.trim();
  if (t.length > max) throw new HttpError(400, `«${field}» — не длиннее ${max} символов.`);
  return t;
}

export function own<T>(row: T | undefined, what: string): T {
  if (!row) throw new HttpError(404, `${what} не найден.`);
  return row;
}
