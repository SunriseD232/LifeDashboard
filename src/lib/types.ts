import type { Rule } from './recur';

export type IconName = 'bag' | 'wave' | 'house' | 'list';

export interface Checklist {
  id: string;
  title: string;
  icon: IconName;
  position: number;
}

export interface ChecklistItem {
  id: string;
  checklist_id: string;
  title: string;
  group_name: string | null;
  note: string | null;
  done: boolean;
  position: number;
}

export interface Reminder {
  id: string;
  title: string;
  /** Время в течение дня, 'ЧЧ:ММ', по возрастанию; у «после выполнения» — одно. */
  times: string[];
  rule: Rule;
  checklist_id: string | null;
  /** Последний день, когда отметили сделанным (для «после выполнения»). */
  last_done: string | null;
}

/** Отложенное время дела на сегодня: напомнить ещё раз в at. */
export interface Snooze {
  reminder_id: string;
  slot: string;
  at: string;
}

/** Заметка (src/server/noteStore.ts). */
export interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  /** Общая для семьи — или null, личная. */
  household_id: string | null;
  checklist_id: string | null;
  /** Кто написал — для общих заметок, если не я. */
  author: string | null;
  updated_at: string;
}
