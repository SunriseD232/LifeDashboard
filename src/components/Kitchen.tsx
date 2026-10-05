'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { findProduct, groupOf, match, normName, type Match, type Product, type Recipe } from '@/lib/kitchen';
import { CATEGORY_LABELS, deptRank, SEED_RECIPES, type Category } from '@/lib/kitchenSeed';
import type { ChecklistItem } from '@/lib/types';
import { useApp } from './AppShell';
import { Icon } from './icons';
import Empty from './Empty';
import { MenuPlanner, PantryPhoto, StoreMode } from './KitchenAi';
import { Fab, useIsPhone } from './Phone';
import Swipe from './Swipe';

// ---------------------------------------------------------------- общее

/** Справочник, запасы и подбор — одним хуком для кухни, рецепта и главной. */
export function useKitchen() {
  const { data, mutate, reload, toast } = useApp();
  const k = data.kitchen;
  const byId = useMemo(() => new Map(k.products.map((p) => [p.id, p])), [k.products]);
  const pantry = useMemo(() => new Set(k.pantry), [k.pantry]);
  const matchOf = (r: Recipe) => match(r, pantry, byId);

  /** Есть дома / кончилось — сразу на экране, потом на сервере. */
  const setHave = (p: Product, have: boolean) =>
    mutate(
      (d) => ({ ...d, kitchen: { ...d.kitchen, pantry: have ? [...d.kitchen.pantry, p.id] : d.kitchen.pantry.filter((x) => x !== p.id) } }),
      () => (have ? api('kitchen/pantry', 'POST', { name: p.name }) : api(`kitchen/pantry/${p.id}`, 'DELETE')),
    );

  /** Добавить по названию: известный продукт — сразу, новый — через сервер (заведёт в справочник). */
  const addHave = async (name: string) => {
    const known = findProduct(k.products, name);
    if (known) {
      if (!pantry.has(known.id)) setHave(known, true);
      return;
    }
    try {
      await api('kitchen/pantry', 'POST', { name });
      await reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return { k, byId, pantry, matchOf, setHave, addHave };
}

export function minutesLabel(m: number | null): string | null {
  if (!m) return null;
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} ч ${m % 60} мин` : `${h} ч`;
}

/** «всё есть» или «нет: сливок, пармезана» — подпись подбора. */
export function MatchChip({ m, byId }: { m: Match; byId: Map<string, Product> }) {
  if (m.missing.length === 0)
    return (
      <span className="chip chip-on">
        <Icon name="check" size={14} />
        всё есть
      </span>
    );
  const names = m.missing.map((id) => byId.get(id)?.name ?? '…');
  return <span className="chip chip-warm">не хватает: {names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '')}</span>;
}

export function RecipeCard({ r, m, byId }: { r: Recipe; m: Match; byId: Map<string, Product> }) {
  const pct = m.total ? Math.round((m.have / m.total) * 100) : 100;
  return (
    <Link href={`/kitchen/${r.id}`} className="card recipe-card">
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="tag">{CATEGORY_LABELS[r.category]}</span>
        {r.household_id && (
          <span className="tag" title="Общий рецепт семьи">
            <Icon name="users" size={12} />
          </span>
        )}
        {minutesLabel(r.minutes) && (
          <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--muted)', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <Icon name="timer" size={16} />
            {minutesLabel(r.minutes)}
          </span>
        )}
      </span>
      <span className="display rc-title" style={{ fontWeight: 700, fontSize: 18, lineHeight: 1.25 }}>
        {r.title}
      </span>
      <span className="rc-bar" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="bar" style={{ flex: 1 }} aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
        </span>
        <span className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>
          {m.have} из {m.total}
        </span>
      </span>
      <span>
        <MatchChip m={m} byId={byId} />
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------- что есть дома

function Pantry() {
  const { k, byId, setHave, addHave } = useKitchen();
  const { reload, toast } = useApp();
  const addMany = async (names: string[]) => {
    try {
      for (const name of names) await api('kitchen/pantry', 'POST', { name });
      await reload();
      toast(`Добавлено: ${names.length}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const [name, setName] = useState('');
  const have = k.pantry.map((id) => byId.get(id)).filter(Boolean) as Product[];

  return (
    <section className="card" aria-labelledby="pantry-title">
      <h2 className="card-title display" id="pantry-title">
        Что есть дома
      </h2>
      <p className="hide-phone" style={{ margin: '-8px 0 0', fontSize: 13, color: 'var(--muted)' }}>
        Подберу, что приготовить. Купленное в «Покупках» попадает сюда само. Соль, перец, вода и масло считаются всегда.
      </p>
      <form
        style={{ display: 'flex', gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          addHave(name.trim());
          setName('');
        }}
      >
        <label className="sr-only" htmlFor="pantry-add">
          Добавить продукт
        </label>
        <input id="pantry-add" className="field" list="products" placeholder="Добавить: «творог»…" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="icon-btn" type="submit" aria-label="Добавить продукт" disabled={!name.trim()}>
          <Icon name="plus" size={18} />
        </button>
      </form>
      {have.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>Пока пусто. Напишите, что есть: «яйца», «молоко».</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {have.map((p) => (
            <span key={p.id} className="chip chip-on">
              {p.name}
              <button className="chip-x" type="button" aria-label={`Кончилось: ${p.name}`} onClick={() => setHave(p, false)}>
                <Icon name="x" size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      <PantryPhoto onAdd={addMany} />
    </section>
  );
}

/** Подсказки названий продуктов — один список на страницу. */
export function ProductsList() {
  const { data } = useApp();
  return (
    <datalist id="products">
      {data.kitchen.products.map((p) => (
        <option key={p.id} value={p.name} />
      ))}
    </datalist>
  );
}

// ---------------------------------------------------------------- рецепты

function Recipes() {
  const { k, byId, matchOf } = useKitchen();
  const { reload, toast } = useApp();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category | null>(null);
  const [quick, setQuick] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const needle = normName(q);
  const shown = k.recipes
    .filter((r) => (!cat || r.category === cat) && (!quick || (r.minutes ?? 999) <= 30))
    .filter((r) => !needle || normName(r.title).includes(needle) || r.ingredients.some((i) => normName(byId.get(i.product_id)?.name ?? '').includes(needle)))
    .map((r) => ({ r, m: matchOf(r) }))
    .sort((a, b) => a.m.missing.length - b.m.missing.length || a.r.title.localeCompare(b.r.title));
  const groups = [
    { id: 'now', title: 'Можно приготовить сейчас', list: shown.filter((x) => groupOf(x.m) === 'now') },
    { id: 'almost', title: 'Почти — докупить немного', list: shown.filter((x) => groupOf(x.m) === 'almost') },
    { id: 'rest', title: 'Остальные', list: shown.filter((x) => groupOf(x.m) === 'rest') },
  ];

  const seed = async () => {
    setSeeding(true);
    try {
      await api('kitchen/seed', 'POST');
      await reload();
      toast('Базовые рецепты добавлены');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSeeding(false);
    }
  };

  if (k.recipes.length === 0) {
    return (
      <Empty
        icon="pot"
        title="Рецептов пока нет"
        action={seeding ? 'Добавляем…' : `Добавить ${SEED_RECIPES.length} домашних: омлет, борщ, плов…`}
        onAction={seed}
        busy={seeding}
        secondary="Свой рецепт"
        onSecondary={() => router.push('/kitchen/new')}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <MenuPlanner />
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 12, top: 12, color: 'var(--muted)' }}>
          <Icon name="search" size={18} />
        </span>
        <label className="sr-only" htmlFor="recipes-q">
          Найти рецепт
        </label>
        <input id="recipes-q" className="field" style={{ paddingLeft: 40 }} placeholder="Название или ингредиент" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div role="group" aria-label="Фильтр" className="chip-scroll" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="chip" type="button" aria-pressed={!cat} onClick={() => setCat(null)}>
          Любое
        </button>
        {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
          <button key={c} className="chip" type="button" aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>
            {CATEGORY_LABELS[c]}
          </button>
        ))}
        <button className="chip" type="button" aria-pressed={quick} onClick={() => setQuick(!quick)}>
          до 30 мин
        </button>
      </div>
      {shown.length === 0 && <p style={{ margin: 0, color: 'var(--muted)' }}>Ничего не нашлось.</p>}
      {groups.map(
        (g) =>
          g.list.length > 0 &&
          (g.id === 'rest' ? (
            <details key={g.id} open={groups[0].list.length + groups[1].list.length === 0}>
              <summary className="group-title" style={{ cursor: 'pointer', minHeight: 32, padding: 0 }}>
                {g.title} · {g.list.length}
              </summary>
              <div className="recipes-grid" style={{ marginTop: 10 }}>
                {g.list.map(({ r, m }) => (
                  <RecipeCard key={r.id} r={r} m={m} byId={byId} />
                ))}
              </div>
            </details>
          ) : (
            <section key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 className="group-title" style={{ padding: 0 }}>
                {g.title} · {g.list.length}
              </h2>
              <div className="recipes-grid">
                {g.list.map(({ r, m }) => (
                  <RecipeCard key={r.id} r={r} m={m} byId={byId} />
                ))}
              </div>
            </section>
          )),
      )}
    </div>
  );
}

// ---------------------------------------------------------------- покупки

export function Shopping() {
  const { data, mutate, reload, toast } = useApp();
  const [name, setName] = useState('');
  const listId = data.kitchen.shopping_id;
  const items = data.items.filter((i) => i.checklist_id === listId);
  const open = items.filter((i) => !i.done);
  const bought = items.filter((i) => i.done);
  const depts = [...new Set(open.map((i) => i.group_name ?? 'Другое'))].sort((a, b) => deptRank(a) - deptRank(b));
  const [store, setStore] = useState(false);
  const shared = !!data.checklists.find((c) => c.id === listId)?.household_id;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api('kitchen/shopping', 'POST', { items: [{ name: name.trim() }] });
      setName('');
      await reload();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const toggle = (i: ChecklistItem, done: boolean) =>
    mutate(
      (d) => ({
        ...d,
        items: d.items.map((x) => (x.id === i.id ? { ...x, done } : x)),
        kitchen: done && i.product_id && !d.kitchen.pantry.includes(i.product_id) ? { ...d.kitchen, pantry: [...d.kitchen.pantry, i.product_id] } : d.kitchen,
      }),
      // Пункт без продукта сервер привяжет сам — подтянем, что теперь есть дома.
      () => api(`items/${i.id}`, 'PATCH', { done }).then(() => (done && !i.product_id ? reload() : undefined)),
    );

  const remove = (i: ChecklistItem) => {
    mutate(
      (d) => ({ ...d, items: d.items.filter((x) => x.id !== i.id) }),
      () => api(`items/${i.id}`, 'DELETE'),
    );
    toast(`Убрано: «${i.title}»`, async () => {
      try {
        await api('kitchen/shopping', 'POST', { items: [{ name: i.title, qty: i.qty ?? null, unit: i.unit ?? null }] });
        await reload();
      } catch (e) {
        toast((e as Error).message);
      }
    });
  };

  const clear = () =>
    mutate(
      (d) => ({ ...d, items: d.items.filter((x) => !(x.checklist_id === listId && x.done)) }),
      () => api('kitchen/shopping/clear', 'POST'),
    );

  const row = (i: ChecklistItem) => (
    <Swipe key={i.id} onRight={() => toggle(i, !i.done)} rightLabel={i.done ? 'Вернуть' : 'Куплено'} rightIcon={i.done ? 'reset' : 'check'} actions={[{ label: 'Удалить', icon: 'trash', tone: 'danger', onClick: () => remove(i) }]}>
    <div className="task-row">
      <label className={`check${i.done ? ' done' : ''}`} style={{ flex: 1, minWidth: 0 }}>
        <input type="checkbox" checked={i.done} onChange={(e) => toggle(i, e.target.checked)} />
        <span className="check-text" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline' }}>
          <span>{i.title}</span>
          {i.qty !== null && i.qty !== undefined && (
            <span className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>
              {i.note?.split(' · ')[0]}
            </span>
          )}
          {i.recipe_title && <span className="chip chip-blue">{i.recipe_title.toLowerCase()}</span>}
        </span>
      </label>
      <button className="icon-btn bare" type="button" aria-label={`Убрать «${i.title}»`} onClick={() => remove(i)}>
        <Icon name="x" size={16} />
      </button>
    </div>
    </Swipe>
  );

  return (
    <section className="card" aria-labelledby="shop-title" style={{ maxWidth: 760 }}>
      <div className="card-head">
        <h2 className="card-title display" id="shop-title">
          <Icon name="cart" />
          Покупки
        </h2>
        <span className="card-link" style={{ color: 'var(--muted)', fontWeight: 500 }}>
          {shared ? 'общий список семьи' : 'ваш список'}
        </span>
      </div>
      {open.length > 0 && (
        <button className="btn btn-primary" type="button" style={{ alignSelf: 'flex-start' }} onClick={() => setStore(true)}>
          <Icon name="cart" size={18} />
          В магазин — крупный список
        </button>
      )}
      {store && <StoreMode items={items} onToggle={toggle} onClose={() => setStore(false)} />}
      <form onSubmit={add} style={{ display: 'flex', gap: 8 }}>
        <label className="sr-only" htmlFor="shop-add">
          Что купить
        </label>
        <input id="shop-add" className="field" list="products" placeholder="Что купить, например «хлеб»" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-primary" type="submit" disabled={!name.trim()} aria-label="Добавить в покупки">
          <Icon name="plus" size={18} />
        </button>
      </form>
      {open.length === 0 && bought.length === 0 && (
        <p style={{ margin: 0, color: 'var(--muted)' }}>Список пуст. Добавляйте сюда сами или из рецепта — кнопкой «Недостающее — в покупки».</p>
      )}
      {depts.map((dept) => (
        <div key={dept}>
          <h3 className="group-title" style={{ padding: '8px 0 2px' }}>
            {dept}
          </h3>
          {open.filter((i) => (i.group_name ?? 'Другое') === dept).map(row)}
        </div>
      ))}
      {bought.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--muted)', minHeight: 32 }}>Куплено · {bought.length}</summary>
          {bought.map(row)}
          <button className="btn btn-ghost" type="button" style={{ marginTop: 8 }} onClick={clear}>
            Убрать купленное
          </button>
        </details>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- экран

/** Кухня: рецепты с подбором по «что есть дома» и список покупок. */
export default function Kitchen() {
  const { data } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const phone = useIsPhone();
  const q = params.get('tab');
  const tab = q === 'shopping' ? 'shopping' : q === 'pantry' && phone ? 'pantry' : 'recipes';
  const toBuy = data.items.filter((i) => i.checklist_id === data.kitchen.shopping_id && !i.done).length;

  return (
    <>
      <ProductsList />
      <div className="page-head">
        <h1 className="h1 display" style={{ flex: 1 }}>
          Кухня
        </h1>
        <div className="tabs-row" role="group" aria-label="Раздел кухни">
          <button type="button" aria-pressed={tab === 'recipes'} onClick={() => router.replace('/kitchen')}>
            Рецепты
          </button>
          {phone && (
            <button type="button" aria-pressed={tab === 'pantry'} onClick={() => router.replace('/kitchen?tab=pantry')}>
              Дома
            </button>
          )}
          <button type="button" aria-pressed={tab === 'shopping'} onClick={() => router.replace('/kitchen?tab=shopping')}>
            <Icon name="cart" size={16} />
            Покупки
            {toBuy > 0 && <span className="badge">{toBuy}</span>}
          </button>
        </div>
        <Link className="btn btn-ghost hide-phone" href="/kitchen/new">
          <Icon name="plus" size={18} />
          Рецепт
        </Link>
      </div>
      {tab === 'shopping' ? (
        <Shopping />
      ) : phone ? (
        tab === 'pantry' ? (
          <Pantry />
        ) : (
          <>
            <Recipes />
            <Fab label="Новый рецепт" onClick={() => router.push('/kitchen/new')} />
          </>
        )
      ) : (
        <div className="kitchen-layout">
          <Pantry />
          <Recipes />
        </div>
      )}
    </>
  );
}
