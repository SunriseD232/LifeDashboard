import { describe, expect, it } from 'vitest';
import { inMinutes, plural } from '../dates';

describe('plural', () => {
  it('склоняет', () => {
    expect(plural(1, 'вещь', 'вещи', 'вещей')).toBe('1 вещь');
    expect(plural(3, 'вещь', 'вещи', 'вещей')).toBe('3 вещи');
    expect(plural(12, 'вещь', 'вещи', 'вещей')).toBe('12 вещей');
    expect(plural(21, 'вещь', 'вещи', 'вещей')).toBe('21 вещь');
  });
});

describe('inMinutes', () => {
  it('пишет по-человечески', () => {
    expect(inMinutes(0)).toBe('сейчас');
    expect(inMinutes(25)).toBe('через 25 мин');
    expect(inMinutes(130)).toBe('через 2 ч 10 мин');
  });
});
