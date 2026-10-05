'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { formatQty, scaleQty } from '@/lib/kitchen';
import { CATEGORY_LABELS } from '@/lib/kitchenSeed';
import { plural } from '@/lib/dates';
import { useApp } from './AppShell';
import Confirm from './Confirm';
import { Icon } from './icons';
import { minutesLabel, useKitchen } from './Kitchen';

interface Added {
  id: string;
  created: boolean;
  prev: number | null;
}

/**
 * Рецепт: что из ингредиентов есть дома (нажатие на значок — «есть / нет»),
 * порции с пересчётом количеств, «недостающее — в покупки» с отменой, шаги.
 */
export default function RecipeView({ id }: { id: string }) {
  const { reload, toast } = useApp();
  const { k, byId, pantry, matchOf, setHave } = useKitchen();
  const router = useRouter();
  const recipe = k.recipes.find((r) => r.id === id);
  const [servings, setServings] = useState(recipe?.servings ?? 2);
  const [added, setAdded] = useState<{ list: Added[]; count: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  if (!recipe) {
    return (
      <div className="panel" style={{ padding: 24 }}>
        Рецепт не найден. <Link href="/kitchen">К рецептам</Link>
      </div>
    );
  }

  const factor = servings / recipe.servings;
  const m = matchOf(recipe);
  const missing = new Set(m.missing);

  const toShopping = async (onlyMissing: boolean) => {
    const list = recipe.ingredients
      .filter((i) => (onlyMissing ? missing.has(i.product_id) : !byId.get(i.product_id)?.basic))
      .map((i) => ({ product_id: i.product_id, qty: scaleQty(i.qty, i.unit, factor), unit: i.unit, recipe: recipe.title }));
    if (!list.length) return;
    setBusy(true);
    try {
      const r = await api<{ added: Added[] }>('kitchen/shopping', 'POST', { items: list });
      setAdded({ list: r.added, count: list.length });
      await reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!added) return;
    try {
      await api('kitchen/shopping/undo', 'POST', { added: added.list });
      setAdded(null);
      await reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const remove = async () => {
    setConfirm(false);
    try {
      await api(`kitchen/recipes/${recipe.id}`, 'DELETE');
      await reload();
      router.push('/kitchen');
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <>
      <Link href="/kitchen" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 'calc(14px * var(--fs))', textDecoration: 'none', minHeight: 32 }}>
        <Icon name="back" size={18} />
        Кухня
      </Link>
      <div className="page-head" style={{ marginTop: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
            <span className="tag">{CATEGORY_LABELS[recipe.category]}</span>
            {minutesLabel(recipe.minutes) && (
              <span style={{ fontSize: 'calc(14px * var(--fs))', color: 'var(--muted)', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <Icon name="timer" size={16} />
                {minutesLabel(recipe.minutes)}
              </span>
            )}
            {recipe.household_id && (
              <span className="tag">
                <Icon name="users" size={12} /> {recipe.author ? `общий, добавил(а) ${recipe.author}` : 'общий'}
              </span>
            )}
          </div>
          <h1 className="h1 display" style={{ overflowWrap: 'anywhere' }}>
            {recipe.title}
          </h1>
        </div>
        <Link className="icon-btn" href={`/kitchen/${recipe.id}/edit`} aria-label="Изменить рецепт">
          <Icon name="edit" size={18} />
        </Link>
        {!recipe.author && (
          <button className="icon-btn" type="button" aria-label="Удалить рецепт" onClick={() => setConfirm(true)}>
            <Icon name="trash" size={18} />
          </button>
        )}
      </div>

      <div className="recipe-layout">
        <section className="card" aria-labelledby="ing-title">
          <div className="card-head">
            <h2 className="card-title display" id="ing-title">
              Ингредиенты
            </h2>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
              <button className="icon-btn" type="button" style={{ width: 36, height: 36 }} aria-label="Меньше порций" disabled={servings <= 1} onClick={() => setServings(servings - 1)}>
                −
              </button>
              <span style={{ minWidth: 86, textAlign: 'center', fontWeight: 600 }} aria-live="polite">
                {plural(servings, 'порция', 'порции', 'порций')}
              </span>
              <button className="icon-btn" type="button" style={{ width: 36, height: 36 }} aria-label="Больше порций" disabled={servings >= 50} onClick={() => setServings(servings + 1)}>
                +
              </button>
            </div>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {recipe.ingredients.map((i, n) => {
              const p = byId.get(i.product_id);
              if (!p) return null;
              const have = p.basic || pantry.has(p.id);
              return (
                <li key={n} className="task-row" style={{ minHeight: 44, gap: 10 }}>
                  <button
                    className="icon-btn bare"
                    type="button"
                    style={{ color: have ? 'var(--accent-ink)' : 'var(--warm)', width: 36, height: 36 }}
                    disabled={p.basic}
                    aria-label={p.basic ? `${p.name}: всегда есть` : have ? `${p.name}: есть дома. Отметить, что нет` : `${p.name}: нет дома. Отметить, что есть`}
                    title={p.basic ? 'всегда есть' : have ? 'есть дома — нажмите, если кончилось' : 'нет дома — нажмите, если есть'}
                    onClick={() => setHave(p, !have)}
                  >
                    <Icon name={have ? 'check' : 'cart'} size={18} />
                  </button>
                  <span style={{ flex: 1, minWidth: 0 }}>{p.name}</span>
                  <span className="mono" style={{ fontSize: 'calc(14px * var(--fs))', color: 'var(--muted)', textAlign: 'right' }}>
                    {formatQty(scaleQty(i.qty, i.unit, factor), i.unit)}
                  </span>
                </li>
              );
            })}
          </ul>
          {added ? (
            <div className="added-box" role="status">
              <Icon name="check" size={18} />
              <span style={{ flex: 1 }}>Добавлено в «Покупки»: {added.count}</span>
              <button className="btn btn-ghost" type="button" style={{ minHeight: 36, padding: '4px 10px' }} onClick={undo}>
                Отменить
              </button>
              <Link className="btn btn-ghost" href="/kitchen?tab=shopping" style={{ minHeight: 36, padding: '4px 10px' }}>
                Покупки
              </Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-primary" type="button" disabled={busy || missing.size === 0} onClick={() => toShopping(true)}>
                <Icon name="cart" size={18} />
                {missing.size === 0 ? 'Всё есть дома' : `Недостающее (${missing.size}) — в покупки`}
              </button>
              <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => toShopping(false)}>
                Все ингредиенты — в покупки
              </button>
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="steps-title">
          <h2 className="card-title display" id="steps-title">
            Приготовление
          </h2>
          {recipe.steps.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--muted)' }}>Шаги не записаны.</p>
          ) : (
            <ol className="steps">
              {recipe.steps.map((s, n) => (
                <li key={n}>
                  <span className="mono step-n">{n + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          )}
          {recipe.note && <p style={{ margin: 0, color: 'var(--muted)', whiteSpace: 'pre-line' }}>{recipe.note}</p>}
        </section>
      </div>

      {confirm && <Confirm title={`Удалить «${recipe.title}»?`} text="Рецепт удалится насовсем." action="Удалить" onCancel={() => setConfirm(false)} onConfirm={remove} />}
    </>
  );
}
