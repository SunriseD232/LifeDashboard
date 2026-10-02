'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { CATEGORY_LABELS, type Category } from '@/lib/kitchenSeed';
import { useApp } from './AppShell';
import { Icon } from './icons';
import { ProductsList } from './Kitchen';
import { AiButton, compressImage, useAiReady } from './Ai';
import type { RecipeDraft } from '@/lib/aiParse';

const UNITS = ['г', 'кг', 'мл', 'л', 'шт.', 'ст. л.', 'ч. л.', 'стакан', 'зубчик', 'ломтик', 'банка', 'пучок', 'упак.'];

interface Row {
  name: string;
  qty: string;
  unit: string;
}

/** Новый рецепт (id нет) или правка своего / общего. Ингредиенты — по названиям продуктов. */
export default function RecipeEditor({ id }: { id?: string }) {
  const { data, reload, toast } = useApp();
  const router = useRouter();
  const byId = new Map(data.kitchen.products.map((p) => [p.id, p]));
  const r = id ? data.kitchen.recipes.find((x) => x.id === id) : undefined;

  const [title, setTitle] = useState(r?.title ?? '');
  const [category, setCategory] = useState<Category>(r?.category ?? 'dinner');
  const [minutes, setMinutes] = useState(r?.minutes ? String(r.minutes) : '');
  const [servings, setServings] = useState(String(r?.servings ?? 2));
  const [rows, setRows] = useState<Row[]>(
    r ? r.ingredients.map((i) => ({ name: byId.get(i.product_id)?.name ?? '', qty: i.qty === null ? '' : String(i.qty), unit: i.unit ?? 'г' })) : [{ name: '', qty: '', unit: 'г' }],
  );
  const [steps, setSteps] = useState((r?.steps ?? []).join('\n'));
  const [shared, setShared] = useState(r ? !!r.household_id : !!data.household);
  const [busy, setBusy] = useState(false);
  const aiReady = useAiReady();
  const [source, setSource] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [filling, setFilling] = useState(false);

  /** ИИ: текст, ссылка или фото → поля формы (сохраняет человек сам). */
  const fill = async () => {
    setFilling(true);
    try {
      const isUrl = /^https?:\/\//i.test(source.trim());
      const { recipe: r2 } = await api<{ recipe: RecipeDraft }>('ai/recipe', 'POST', {
        url: isUrl ? source.trim() : undefined,
        text: isUrl ? undefined : source.trim() || undefined,
        image: photo ?? undefined,
      });
      setTitle(r2.title);
      setCategory(r2.category);
      setMinutes(r2.minutes ? String(r2.minutes) : '');
      setServings(String(r2.servings));
      setRows(r2.ingredients.map((i) => ({ name: i.name, qty: i.qty === null ? '' : String(i.qty), unit: i.unit ?? 'г' })));
      setSteps(r2.steps.join('\n'));
      toast('Заполнено — проверьте и сохраните');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setFilling(false);
    }
  };

  if (id && !r) {
    return (
      <div className="panel" style={{ padding: 24 }}>
        Рецепт не найден. <Link href="/kitchen">К рецептам</Link>
      </div>
    );
  }

  const setRow = (i: number, p: Partial<Row>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const body = {
      title: title.trim(),
      category,
      minutes: minutes ? Number(minutes) : null,
      servings: Number(servings) || 2,
      steps: steps.split('\n').map((s) => s.trim()).filter(Boolean),
      ingredients: rows
        .filter((x) => x.name.trim())
        .map((x) => ({ name: x.name.trim(), qty: x.qty.trim() ? Number(x.qty.replace(',', '.')) : null, unit: x.unit })),
      ...(data.household && (!r || !r.author) ? { shared } : {}),
    };
    try {
      const res = r ? await api(`kitchen/recipes/${r.id}`, 'PATCH', body) : await api<{ id: string }>('kitchen/recipes', 'POST', body);
      await reload();
      router.push(`/kitchen/${r ? r.id : (res as { id: string }).id}`);
    } catch (err) {
      toast((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <ProductsList />
      <Link href={r ? `/kitchen/${r.id}` : '/kitchen'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 14, textDecoration: 'none', minHeight: 32 }}>
        <Icon name="back" size={18} />
        {r ? r.title : 'Кухня'}
      </Link>
      <div className="page-head" style={{ marginTop: 8 }}>
        <h1 className="h1 display">{r ? 'Изменить рецепт' : 'Новый рецепт'}</h1>
      </div>
      {aiReady && (
        <details className="card ai-card" style={{ maxWidth: 820, marginBottom: 16 }} open={!r}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, minHeight: 32, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Icon name="sparkles" size={18} />
            Заполнить с помощью ИИ — из текста, ссылки или фото
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            <label className="sr-only" htmlFor="re-source">
              Текст рецепта или ссылка
            </label>
            <textarea id="re-source" className="field" rows={4} placeholder="Вставьте ссылку на рецепт или его текст — хоть из переписки" value={source} onChange={(e) => setSource(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
                <Icon name="camera" size={18} />
                {photo ? 'Фото выбрано' : 'Фото страницы'}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setPhoto(await compressImage(f, 1600).catch(() => null));
                  }}
                />
              </label>
              <AiButton busy={filling} disabled={!source.trim() && !photo} onClick={fill}>
                Заполнить
              </AiButton>
            </div>
          </div>
        </details>
      )}
      <form className="card" onSubmit={save} style={{ maxWidth: 820, gap: 16 }}>
        <div className="fld">
          <label className="label" htmlFor="re-title">
            Название
          </label>
          <input id="re-title" className="field" maxLength={120} required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, «Гречка с грибами»" />
        </div>
        <div className="task-fields">
          <div className="fld">
            <label className="label" htmlFor="re-cat">
              Когда
            </label>
            <select id="re-cat" className="field" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="fld">
            <label className="label" htmlFor="re-min">
              Время, мин
            </label>
            <input id="re-min" className="field mono" type="number" min={1} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </div>
          <div className="fld">
            <label className="label" htmlFor="re-srv">
              Порций
            </label>
            <input id="re-srv" className="field mono" type="number" min={1} max={50} required value={servings} onChange={(e) => setServings(e.target.value)} />
          </div>
        </div>

        <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend className="label" style={{ padding: 0, marginBottom: 8 }}>
            Ингредиенты <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— количество пустое значит «по вкусу»</span>
          </legend>
          {rows.map((x, i) => (
            <div key={i} className="ing-row">
              <input className="field" list="products" aria-label={`Продукт ${i + 1}`} placeholder="Продукт" value={x.name} onChange={(e) => setRow(i, { name: e.target.value })} />
              <input className="field mono" aria-label={`Количество ${i + 1}`} inputMode="decimal" placeholder="—" value={x.qty} onChange={(e) => setRow(i, { qty: e.target.value })} />
              <select className="field" aria-label={`Единица ${i + 1}`} value={x.unit} onChange={(e) => setRow(i, { unit: e.target.value })}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              <button className="icon-btn bare" type="button" aria-label={`Убрать ингредиент ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                <Icon name="x" size={16} />
              </button>
            </div>
          ))}
          <button className="btn btn-ghost btn-dashed" type="button" onClick={() => setRows([...rows, { name: '', qty: '', unit: 'г' }])} style={{ alignSelf: 'flex-start' }}>
            <Icon name="plus" size={16} />
            Ингредиент
          </button>
        </fieldset>

        <div className="fld">
          <label className="label" htmlFor="re-steps">
            Шаги — каждый с новой строки
          </label>
          <textarea id="re-steps" className="field" rows={7} value={steps} onChange={(e) => setSteps(e.target.value)} />
        </div>

        {data.household && (!r || !r.author) && (
          <label className="check" style={{ padding: 0 }}>
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            <span className="check-text">Общий рецепт семьи</span>
          </label>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={busy || !title.trim()}>
            <Icon name="check" size={18} />
            Сохранить
          </button>
          <Link className="btn btn-ghost" href={r ? `/kitchen/${r.id}` : '/kitchen'}>
            Отмена
          </Link>
        </div>
      </form>
    </>
  );
}
