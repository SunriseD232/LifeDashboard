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

export type Repeat = 'once' | 'daily' | 'weekdays';

export interface Reminder {
  id: string;
  title: string;
  /** 'HH:MM:SS' из колонки time. */
  at_time: string;
  repeat: Repeat;
  on_date: string | null;
  checklist_id: string | null;
}

export const REPEAT_LABELS: Record<Repeat, string> = {
  once: 'один раз',
  daily: 'каждый день',
  weekdays: 'по будням',
};
