import { beforeEach, describe, expect, it } from 'vitest';

// В тестах нет браузера: хватает хранилища и событий.
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  window: { dispatchEvent: () => true },
  CustomEvent: class {
    constructor(
      public type: string,
      public init?: unknown,
    ) {}
  },
});

const { enqueue, flush, outbox, queueable, saveState, loadState, clearOffline } = await import('../offline');

describe('очередь без сети', () => {
  beforeEach(() => store.clear());

  it('в очередь — только правки своих данных', () => {
    expect(queueable('tasks', 'POST')).toBe(true);
    expect(queueable('reminders/abc/done', 'PUT')).toBe(true);
    expect(queueable('items/x', 'PATCH')).toBe(true);
    expect(queueable('ai/quick-add', 'POST')).toBe(false);
    expect(queueable('notes', 'POST')).toBe(false);
    expect(queueable('state', 'GET')).toBe(false);
  });

  it('отправляет по порядку и подставляет настоящий id созданного', async () => {
    const created = enqueue('tasks', 'POST', { title: 'Хлеб' });
    enqueue(`tasks/${created.tempId}/done`, 'POST', { day: '2026-10-03' });
    const calls: string[] = [];
    const r = await flush(async (path, method) => {
      calls.push(`${method} ${path}`);
      return path === 'tasks' ? { id: 'real-1' } : { ok: true };
    });
    expect(calls).toEqual(['POST tasks', 'POST tasks/real-1/done']);
    expect(r).toEqual({ sent: 2, rejected: 0 });
    expect(outbox()).toHaveLength(0);
  });

  it('нет сети — останавливается и ждёт; сервер отказал — выкидывает', async () => {
    enqueue('items/a', 'PATCH', { done: true });
    enqueue('items/b', 'PATCH', { done: true });
    const r1 = await flush(async () => {
      throw Object.assign(new Error('offline'), {});
    });
    expect(r1.sent).toBe(0);
    expect(outbox()).toHaveLength(2);
    const r2 = await flush(async (path) => {
      if (path === 'items/a') throw Object.assign(new Error('нет'), { status: 404 });
      return {};
    });
    expect(r2).toEqual({ sent: 1, rejected: 1 });
  });

  it('сохранённые данные и выход', () => {
    saveState('me@x', { tasks: [1] });
    expect(loadState<{ tasks: number[] }>()?.state.tasks).toEqual([1]);
    enqueue('items/a', 'PATCH', {});
    clearOffline();
    expect(loadState()).toBeNull();
    expect(outbox()).toHaveLength(0);
  });
});
