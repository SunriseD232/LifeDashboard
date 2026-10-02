import { describe, expect, it } from 'vitest';
import { appliesOn, localDay, plural } from '../dates';
import type { Reminder } from '../types';

const r = (over: Partial<Reminder>): Reminder => ({
  id: 'r', title: 't', at_time: '09:00', repeat: 'once', on_date: null, checklist_id: null, ...over,
});

describe('appliesOn', () => {
  const fri = new Date(2026, 9, 2);
  const sat = new Date(2026, 9, 3);
  it('по будням — пятница да, суббота нет', () => {
    expect(appliesOn(r({ repeat: 'weekdays' }), fri)).toBe(true);
    expect(appliesOn(r({ repeat: 'weekdays' }), sat)).toBe(false);
  });
  it('разовое — только в свой день', () => {
    expect(appliesOn(r({ on_date: localDay(fri) }), fri)).toBe(true);
    expect(appliesOn(r({ on_date: localDay(fri) }), sat)).toBe(false);
  });
});

describe('plural', () => {
  it('склоняет', () => {
    expect(plural(1, 'вещь', 'вещи', 'вещей')).toBe('1 вещь');
    expect(plural(3, 'вещь', 'вещи', 'вещей')).toBe('3 вещи');
    expect(plural(12, 'вещь', 'вещи', 'вещей')).toBe('12 вещей');
    expect(plural(21, 'вещь', 'вещи', 'вещей')).toBe('21 вещь');
  });
});
