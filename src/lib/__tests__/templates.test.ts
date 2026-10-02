import { describe, expect, it } from 'vitest';
import { describe as describeRule, parseRule } from '../recur';
import { CHECKLIST_TEMPLATES, CHORE_TEMPLATES } from '../templates';

describe('шаблоны', () => {
  it('чек-листы: уникальные id, без повторов пунктов, влезают в лимиты API', () => {
    expect(new Set(CHECKLIST_TEMPLATES.map((t) => t.id)).size).toBe(CHECKLIST_TEMPLATES.length);
    for (const t of CHECKLIST_TEMPLATES) {
      const titles = t.items.map((i) => `${i.group_name}/${i.title}`);
      expect(new Set(titles).size, t.title).toBe(titles.length);
      expect(t.items.length).toBeLessThanOrEqual(100);
      for (const i of t.items) {
        expect(i.title.length).toBeLessThanOrEqual(120);
        expect(i.group_name.length).toBeLessThanOrEqual(60);
      }
    }
  });
  it('бытовые дела: правила проходят проверку сервера и читаются словами', () => {
    for (const c of CHORE_TEMPLATES) {
      const rule = c.rule('2026-10-02');
      expect(parseRule(rule), c.title).toEqual(rule);
      expect(describeRule(rule)).toMatch(/\S/);
      expect(c.time).toMatch(/^\d{2}:\d{2}$/);
    }
  });
});
