'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { localDay, plural } from '@/lib/dates';
import { amountLabel, isExact, totalOf, trustLabel, type FridgeDraft, type FridgeItem, type Nutrition } from '@/lib/fridge';
import { AiButton, compressImage, useAiReady } from './Ai';
import { useApp } from './AppShell';
import { Icon } from './icons';

/**
 * Холодильник: чек (фото или текст) → продукты с КБЖУ на 100 г. Что знаем
 * точно (этикетка, ввели сами), а что — оценка ИИ, видно у каждого продукта.
 */

const fmt = (x: number) => String(x).replace('.', ',');
const small = { fontSize: 'calc(13px * var(--fs))', color: 'var(--muted)' } as const;

function NutrLine({ n, per }: { n: Nutrition; per: string }) {
  return (
    <span className="mono" style={small}>
      {n.kcal} ккал · Б {fmt(n.protein)} · Ж {fmt(n.fat)} · У {fmt(n.carbs)} <span style={{ fontFamily: 'inherit' }}>{per}</span>
    </span>
  );
}

function Trust({ i }: { i: Pick<FridgeDraft, 'source' | 'confidence'> }) {
  const t = trustLabel(i.source, i.confidence);
  const cls = t.tone === 'ok' ? 'chip chip-on' : t.tone === 'warm' ? 'chip chip-warm' : 'chip chip-danger';
  return (
    <span className={cls} title={t.hint} style={{ minHeight: 24, padding: '0 8px' }}>
      {isExact(i) && <Icon name="check" size={12} />}
      {t.tone === 'danger' && '⚠ '}
      {t.text}
    </span>
  );
}

const per100 = (i: Pick<FridgeDraft, 'size_unit'>) => (i.size_unit === 'мл' ? 'на 100 мл' : 'на 100 г');

/** Сколько продуктов с неточным КБЖУ — честное предупреждение сверху. */
function unsure(list: Pick<FridgeDraft, 'source' | 'confidence'>[]) {
  return { mid: list.filter((i) => i.source === 'ai' && i.confidence === 'mid').length, low: list.filter((i) => i.source === 'ai' && i.confidence === 'low').length };
}

function Warning({ list }: { list: Pick<FridgeDraft, 'source' | 'confidence'>[] }) {
  const u = unsure(list);
  const exact = list.filter(isExact).length;
  if (!list.length) return null;
  return (
    <div className="added-box" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, fontWeight: 500 }} role="note">
      <span style={{ fontWeight: 600 }}>
        {exact === list.length ? 'Всё КБЖУ — с этикеток или введено вами.' : exact ? `Точное КБЖУ — у ${exact} из ${list.length}. У остальных это оценка ИИ по названию, не с упаковки.` : 'КБЖУ — оценка ИИ по названию из чека, а не с упаковки.'}
      </span>
      {(u.low > 0 || u.mid > 0) && (
        <span>
          {u.low > 0 && `Не уверен — ${plural(u.low, 'продукт', 'продукта', 'продуктов')}. `}
          {u.mid > 0 && `Примерно (±20–30%) — ${u.mid}. `}
          Для точных цифр сфотографируйте этикетку — запомню для следующих покупок.
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- чек

function ReceiptReview({ items, onDone }: { items: FridgeDraft[]; onDone: () => void }) {
  const { reload, toast } = useApp();
  const [pick, setPick] = useState(() => items.map((i) => i.food));
  const [busy, setBusy] = useState(false);
  const chosen = items.filter((_, n) => pick[n]);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api<{ added: number }>('kitchen/fridge', 'POST', { items: chosen, bought: localDay() });
      await reload();
      toast(`В холодильнике: +${r.added}`);
      onDone();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="receipt-title" style={{ gap: 10 }}>
      <h2 className="card-title display" id="receipt-title">
        <Icon name="receipt" />
        Нашёл в чеке — отметьте, что положить
      </h2>
      <Warning list={chosen.filter((i) => i.food)} />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {items.map((i, n) => (
          <label key={n} className="check" style={{ alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
            <input type="checkbox" checked={pick[n]} onChange={(e) => setPick(pick.map((x, k) => (k === n ? e.target.checked : x)))} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>{i.title}</span>
                <span className="mono" style={small}>
                  {amountLabel(i)}
                </span>
                {i.food ? <Trust i={i} /> : <span style={small}>не еда</span>}
              </span>
              {i.title !== i.name && <span style={small}>в чеке: {i.name}</span>}
              {i.nutr && <NutrLine n={i.nutr} per={per100(i)} />}
              {i.food && i.note && i.source === 'ai' && i.confidence !== 'high' && <span style={{ ...small, color: 'var(--warn-ink, var(--muted))' }}>{i.note}</span>}
            </span>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" type="button" disabled={busy || !chosen.length} onClick={save}>
          {busy ? 'Кладу…' : `В холодильник (${chosen.length})`}
        </button>
        <button className="btn btn-ghost" type="button" onClick={onDone}>
          Отмена
        </button>
      </div>
    </section>
  );
}

function ReceiptInput({ onFound }: { onFound: (items: FridgeDraft[]) => void }) {
  const { toast } = useApp();
  const ready = useAiReady();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState<string | null>(null);

  const send = async (body: { image?: string; text?: string }) => {
    setBusy(true);
    try {
      const r = await api<{ items: FridgeDraft[] }>('kitchen/fridge/receipt', 'POST', body);
      onFound(r.items);
      setPaste(null);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  if (!ready) return <p style={{ margin: 0, ...small }}>Чтобы загружать чеки, нужен ИИ — он пока не подключён.</p>;
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="Фото чека"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) send({ image: await compressImage(f, 2048) });
        }}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <AiButton busy={busy} onClick={() => input.current?.click()}>
          {busy ? 'Читаю чек…' : 'Загрузить чек'}
        </AiButton>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => setPaste(paste === null ? '' : null)}>
          Вставить текст чека
        </button>
      </div>
      {paste !== null && (
        <form
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (paste.trim()) send({ text: paste });
          }}
        >
          <label className="sr-only" htmlFor="receipt-text">
            Текст чека
          </label>
          <textarea
            id="receipt-text"
            className="field"
            rows={6}
            autoFocus
            placeholder="Например, из приложения «Проверка чеков ФНС» или с proverkacheka.com"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={busy || !paste.trim()} style={{ alignSelf: 'flex-start' }}>
            {busy ? 'Читаю…' : 'Разобрать'}
          </button>
        </form>
      )}
    </>
  );
}

// ---------------------------------------------------------------- продукт

function NutrForm({ init, onSave, onCancel }: { init: Nutrition | null; onSave: (n: Nutrition) => Promise<void>; onCancel: () => void }) {
  const [v, setV] = useState(() => ({
    kcal: init ? String(init.kcal) : '',
    protein: init ? fmt(init.protein) : '',
    fat: init ? fmt(init.fat) : '',
    carbs: init ? fmt(init.carbs) : '',
  }));
  const fields: [keyof typeof v, string][] = [
    ['kcal', 'Ккал'],
    ['protein', 'Белки'],
    ['fat', 'Жиры'],
    ['carbs', 'Углеводы'],
  ];
  const n = (s: string) => Number(s.replace(',', '.'));
  const ok = fields.slice(1).every(([k]) => v[k].trim() !== '' && Number.isFinite(n(v[k])));
  return (
    <form
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSave({ kcal: v.kcal.trim() ? n(v.kcal) : NaN, protein: n(v.protein), fat: n(v.fat), carbs: n(v.carbs) });
      }}
    >
      <span style={small}>С упаковки, на 100 г. Ккал можно не писать — посчитаю по БЖУ.</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
        {fields.map(([k, label]) => (
          <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2, ...small }}>
            {label}
            <input className="field" inputMode="decimal" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" type="submit" disabled={!ok}>
          Сохранить
        </button>
        <button className="btn btn-ghost" type="button" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}

function FridgeRow({ i }: { i: FridgeItem }) {
  const { mutate, reload, toast } = useApp();
  const ready = useAiReady();
  const input = useRef<HTMLInputElement>(null);
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const total = totalOf(i);

  const setQty = (qty: number) =>
    mutate(
      (d) => ({
        ...d,
        kitchen: {
          ...d.kitchen,
          fridge: qty > 0 ? d.kitchen.fridge.map((x) => (x.id === i.id ? { ...x, qty } : x)) : d.kitchen.fridge.filter((x) => x.id !== i.id),
          // Последний такой продукт кончился — и «есть дома» больше нет (так же делает сервер).
          pantry:
            qty === 0 && i.product_id && !d.kitchen.fridge.some((x) => x.id !== i.id && x.product_id === i.product_id)
              ? d.kitchen.pantry.filter((p) => p !== i.product_id)
              : d.kitchen.pantry,
        },
      }),
      () => (qty > 0 ? api(`kitchen/fridge/${i.id}`, 'PATCH', { qty }) : api(`kitchen/fridge/${i.id}`, 'DELETE')),
    );

  const label = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      await api(`kitchen/fridge/${i.id}`, 'POST', { image: await compressImage(f, 1600) });
      await reload();
      toast('КБЖУ с этикетки сохранено');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const saveManual = async (n: Nutrition) => {
    try {
      await api(`kitchen/fridge/${i.id}`, 'PATCH', { nutr: Number.isNaN(n.kcal) ? { protein: n.protein, fat: n.fat, carbs: n.carbs } : n });
      await reload();
      setEdit(false);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <details className="fridge-row" style={{ borderBottom: '1px solid var(--line)', padding: '10px 0' }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>{i.title}</span>
          <span className="mono" style={small}>
            {amountLabel(i)}
          </span>
          <Trust i={i} />
        </span>
        {i.nutr ? <NutrLine n={i.nutr} per={per100(i)} /> : <span style={small}>КБЖУ неизвестно</span>}
        {total && (
          <span style={small}>
            {i.qty === 1 ? 'в упаковке' : 'всего'} ≈ {total.kcal} ккал · Б {total.protein} · Ж {total.fat} · У {total.carbs}
          </span>
        )}
      </summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
        {i.source === 'ai' && <span style={{ ...small, color: 'var(--ink)' }}>{i.note ?? trustLabel(i.source, i.confidence).hint}</span>}
        {i.title !== i.name && <span style={small}>В чеке: {i.name}</span>}
        {edit ? (
          <NutrForm init={i.nutr} onSave={saveManual} onCancel={() => setEdit(false)} />
        ) : (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ready && (
              <>
                <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" aria-label={`Фото этикетки: ${i.title}`} onChange={(e) => label(e.target.files?.[0])} />
                <AiButton busy={busy} onClick={() => input.current?.click()}>
                  {busy ? 'Читаю…' : i.source === 'label' ? 'Переснять этикетку' : 'Фото этикетки'}
                </AiButton>
              </>
            )}
            <button className="btn btn-ghost" type="button" onClick={() => setEdit(true)}>
              <Icon name="edit" size={16} />
              Ввести КБЖУ
            </button>
            {i.qty > 1 && (
              <button className="btn btn-ghost" type="button" onClick={() => setQty(Math.round((i.qty - 1) * 1000) / 1000)}>
                Съели одну
              </button>
            )}
            <button className="btn btn-ghost" type="button" onClick={() => setQty(0)}>
              <Icon name="trash" size={16} />
              Кончилось
            </button>
          </div>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- экран

export default function Fridge() {
  const { data } = useApp();
  const list = data.kitchen.fridge;
  const [draft, setDraft] = useState<FridgeDraft[] | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
      {draft ? (
        <ReceiptReview items={draft} onDone={() => setDraft(null)} />
      ) : (
        <section className="card" aria-labelledby="fridge-title">
          <div className="card-head">
            <h2 className="card-title display" id="fridge-title">
              Холодильник
            </h2>
            {list.length > 0 && (
              <span className="card-link" style={{ color: 'var(--muted)', fontWeight: 500 }}>
                {plural(list.length, 'продукт', 'продукта', 'продуктов')}
              </span>
            )}
          </div>
          <p style={{ margin: '-8px 0 0', ...small }}>
            Загрузите чек — продукты появятся здесь с КБЖУ на 100 г и попадут в «Есть дома». Если КБЖУ — догадка, а не с упаковки, так и напишу.
          </p>
          <ReceiptInput onFound={setDraft} />
          {list.length > 0 && <Warning list={list} />}
          {list.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: 'calc(14px * var(--fs))' }}>Пока пусто.</p>
          ) : (
            <div>
              {list.map((i) => (
                <FridgeRow key={i.id} i={i} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
