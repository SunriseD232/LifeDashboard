import { describe, expect, it } from 'vitest';
import { deptRank, guessDept } from '../kitchenSeed';

describe('отдел по названию', () => {
  it('узнаёт частое', () => {
    expect(guessDept('Кефир 1%')).toBe('Молочное и яйца');
    expect(guessDept('печенье овсяное')).toBe('Сладкое');
    expect(guessDept('куриная печень')).toBe('Мясо и рыба');
    expect(guessDept('Бородинский хлеб')).toBe('Хлеб');
    expect(guessDept('стиральный порошок')).toBe('Для дома');
    expect(guessDept('батарейки АА')).toBe('Для дома');
    expect(guessDept('черри помидоры')).toBe('Овощи и фрукты');
    expect(guessDept('что-то странное')).toBe('Другое');
  });
  it('порядок обхода: овощи раньше бытового, «Другое» — в конце', () => {
    expect(deptRank('Овощи и фрукты')).toBeLessThan(deptRank('Для дома'));
    expect(deptRank('Неизвестный')).toBe(deptRank('Другое'));
  });
});
