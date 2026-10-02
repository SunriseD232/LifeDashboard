'use client';

import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { plural } from '@/lib/dates';
import type { Checklist, ChecklistItem, IconName } from '@/lib/types';
import { useApp, type AppData, type Mutate } from './AppShell';
import Confirm from './Confirm';
import { Icon, LIST_ICONS } from './icons';
import TemplatePicker from './TemplatePicker';

interface Props {
  data: AppData;
  mutate: Mutate;
  reload: () => Promise<void>;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  toast: (m: string) => void;
}

/** Пункты списка, разложенные по группам в порядке их первого появления. */
function groupItems(items: ChecklistItem[]): { name: string | null; items: ChecklistItem[] }[] {
  const out: { name: string | null; items: ChecklistItem[] }[] = [];
  for (const it of [...items].sort((a, b) => a.position - b.position)) {
    let g = out.find((x) => x.name === it.group_name);
    if (!g) {
      g = { name: it.group_name, items: [] };
      out.push(g);
    }
    g.items.push(it);
  }
  return out;
}

export default function Checklists({ data, mutate, reload, openId, setOpenId, toast }: Props) {
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const picker = picking && (
    <TemplatePicker
      onClose={() => setPicking(false)}
      onCreated={(id) => {
        setPicking(false);
        setOpenId(id);
      }}
    />
  );

  const lists = useMemo(() => [...data.checklists].sort((a, b) => a.position - b.position), [data.checklists]);
  // На компьютере всегда открыт какой-то список; на телефоне — только выбранный
  // явно (иначе виден перечень списков).
  const selected = lists.find((l) => l.id === openId) ?? lists[0] ?? null;

  const createList = async (title: string, icon: IconName = 'bag', items?: { title: string; group_name: string }[]) => {
    setBusy(true);
    try {
      const { id } = await api<{ id: string }>('checklists', 'POST', { title, icon, items });
      await reload();
      return id;
    } catch (e) {
      toast((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const newListForm = (
    <form
      className="panel"
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}
      onSubmit={async (e) => {
        e.preventDefault();
        const title = newTitle.trim();
        if (!title) return;
        const id = await createList(title);
        if (id) {
          setNewTitle('');
          setCreating(false);
          setOpenId(id);
          setEditId(id);
        }
      }}
    >
      <label className="label" htmlFor="new-list">
        Название чек-листа
      </label>
      <input
        id="new-list"
        className="field"
        autoFocus
        maxLength={80}
        placeholder="Например, «Поездка на дачу»"
        value={newTitle}
        onChange={(e) => setNewTitle(e.target.value)}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" type="submit" disabled={busy || !newTitle.trim()} style={{ flex: 1 }}>
          Создать
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => setCreating(false)}>
          Отмена
        </button>
      </div>
    </form>
  );

  if (lists.length === 0) {
    return (
      <section className="panel" style={{ maxWidth: 560, margin: '24px auto', padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 className="display" style={{ margin: 0, fontSize: 30 }}>
          Чек-листов пока нет
        </h1>
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          Начните с готового — бассейн, работа, путешествие, командировка, переезд, поход — и поправьте под себя. Или создайте свой.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" type="button" onClick={() => setPicking(true)}>
            <Icon name="plus" size={18} />
            Выбрать шаблон
          </button>
          {!creating && (
            <button className="btn btn-ghost" type="button" onClick={() => setCreating(true)}>
              Свой чек-лист
            </button>
          )}
        </div>
        {creating && newListForm}
        {picker}
      </section>
    );
  }

  return (
    <div className="lists-layout" data-detail={openId && selected ? 'true' : 'false'}>
      <aside className="lists-aside" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h1 className="display" style={{ margin: 0, fontSize: 22 }}>
            Мои чек-листы
          </h1>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{plural(lists.length, 'список', 'списка', 'списков')}</span>
        </div>
        {lists.map((l) => {
          const items = data.items.filter((i) => i.checklist_id === l.id);
          const done = items.filter((i) => i.done).length;
          const all = items.length > 0 && done === items.length;
          return (
            <button
              key={l.id}
              type="button"
              className="list-card"
              aria-current={selected?.id === l.id ? 'true' : undefined}
              onClick={() => {
                setOpenId(l.id);
                if (editId !== l.id) setEditId(null);
                // На телефоне список открывается вместо перечня — с начала.
                if (window.matchMedia('(max-width: 860px)').matches) window.scrollTo({ top: 0 });
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                <span className="list-icon">
                  <Icon name={l.icon} size={22} />
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontWeight: 600, overflowWrap: 'anywhere' }}>{l.title}</span>
                  <span style={{ display: 'block', fontSize: 13, color: 'var(--muted)' }}>
                    {plural(items.length, 'вещь', 'вещи', 'вещей')}
                  </span>
                </span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                <span className="bar" style={{ flex: 1 }}>
                  <i style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
                </span>
                {all ? (
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-ink)', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    <Icon name="check" size={16} />
                    Всё собрано
                  </span>
                ) : (
                  <span className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>
                    {done} из {items.length}
                  </span>
                )}
              </span>
            </button>
          );
        })}
        {creating ? (
          newListForm
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-dashed" type="button" style={{ flex: 1 }} onClick={() => setCreating(true)}>
              <Icon name="plus" size={18} />
              Новый
            </button>
            <button className="btn btn-ghost" type="button" style={{ flex: 1 }} onClick={() => setPicking(true)}>
              Из шаблона
            </button>
          </div>
        )}
        {picker}
      </aside>

      <section className="lists-main">
        {selected && (
          <ChecklistDetail
            key={selected.id}
            list={selected}
            items={data.items.filter((i) => i.checklist_id === selected.id)}
            editing={editId === selected.id}
            setEditing={(on) => setEditId(on ? selected.id : null)}
            mutate={mutate}
            reload={reload}
            toast={toast}
            onBack={() => setOpenId(null)}
            onDeleted={() => {
              setOpenId(null);
              setEditId(null);
            }}
          />
        )}
      </section>
    </div>
  );
}

function ChecklistDetail({
  list,
  items,
  editing,
  setEditing,
  mutate,
  reload,
  toast,
  onBack,
  onDeleted,
}: {
  list: Checklist;
  items: ChecklistItem[];
  editing: boolean;
  setEditing: (on: boolean) => void;
  mutate: Mutate;
  reload: () => Promise<void>;
  toast: (m: string) => void;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const { data } = useApp();
  const groups = groupItems(items);
  const done = items.filter((i) => i.done).length;
  const [newItem, setNewItem] = useState('');
  const [newItemGroup, setNewItemGroup] = useState<string>(groups[groups.length - 1]?.name ?? '');
  const [confirm, setConfirm] = useState<null | { kind: 'list' } | { kind: 'group'; name: string | null }>(null);
  const [newGroup, setNewGroup] = useState<{ name: string; item: string } | null>(null);

  const patchItem = (id: string, patch: Partial<ChecklistItem>) =>
    mutate(
      (d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }),
      () => api(`items/${id}`, 'PATCH', patch),
    );

  const addItem = async (title: string, group: string | null) => {
    try {
      const { id, position } = await api<{ id: string; position: number }>(`checklists/${list.id}/items`, 'POST', {
        title,
        group_name: group,
      });
      mutate(
        (d) => ({
          ...d,
          items: [...d.items, { id, checklist_id: list.id, title, group_name: group, note: null, done: false, position }],
        }),
        async () => {},
      );
    } catch (e) {
      toast((e as Error).message);
    }
  };

  /** Сдвиг пункта на одну позицию внутри его группы. */
  const move = (item: ChecklistItem, dir: -1 | 1) => {
    const ordered = [...items].sort((a, b) => a.position - b.position);
    const sameGroup = ordered.filter((i) => i.group_name === item.group_name);
    const idx = sameGroup.findIndex((i) => i.id === item.id);
    const other = sameGroup[idx + dir];
    if (!other) return;
    const ids = ordered.map((i) => i.id);
    const a = ids.indexOf(item.id);
    const b = ids.indexOf(other.id);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    mutate(
      (d) => ({ ...d, items: d.items.map((i) => (ids.includes(i.id) ? { ...i, position: ids.indexOf(i.id) } : i)) }),
      () => api(`checklists/${list.id}/reorder`, 'POST', { ids }),
    );
  };

  const groupLabel = (name: string | null) => name ?? 'Без группы';

  return (
    <article className="panel" style={{ padding: 'clamp(18px, 3vw, 28px) clamp(16px, 3vw, 32px)', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <button className="icon-btn bare only-mobile" type="button" aria-label="Назад к чек-листам" onClick={onBack}>
          <Icon name="back" size={22} />
        </button>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          {editing ? (
            <>
              <label className="sr-only" htmlFor="list-title">
                Название чек-листа
              </label>
              <input
                id="list-title"
                className="field display"
                defaultValue={list.title}
                maxLength={80}
                style={{ fontSize: 26, fontWeight: 700 }}
                onBlur={(e) => {
                  const t = e.target.value.trim();
                  if (t && t !== list.title) {
                    mutate(
                      (d) => ({ ...d, checklists: d.checklists.map((c) => (c.id === list.id ? { ...c, title: t } : c)) }),
                      () => api(`checklists/${list.id}`, 'PATCH', { title: t }),
                    );
                  } else e.target.value = list.title;
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </>
          ) : (
            <h2 className="display" style={{ margin: 0, fontSize: 'clamp(28px, 4vw, 40px)', lineHeight: 1.1, overflowWrap: 'anywhere' }}>
              {list.title}
            </h2>
          )}
          <p style={{ margin: '6px 0 0', color: 'var(--muted)' }}>
            {plural(items.length, 'вещь', 'вещи', 'вещей')}
            {items.length > 0 && done === items.length ? ' · всё собрано' : ''}
            {list.household_id ? ` · общий${list.author ? `, завёл(а) ${list.author}` : ''}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!editing && (
            <button
              className="btn btn-ghost"
              type="button"
              disabled={done === 0}
              onClick={() =>
                mutate(
                  (d) => ({ ...d, items: d.items.map((i) => (i.checklist_id === list.id ? { ...i, done: false } : i)) }),
                  () => api(`checklists/${list.id}/reset`, 'POST', {}),
                )
              }
            >
              <Icon name="reset" size={18} />
              Снять отметки
            </button>
          )}
          {editing ? (
            <button className="btn btn-primary" type="button" onClick={() => setEditing(false)}>
              <Icon name="check" size={18} />
              Готово
            </button>
          ) : (
            <button className="btn btn-ghost" type="button" onClick={() => setEditing(true)}>
              <Icon name="edit" size={18} />
              Изменить
            </button>
          )}
          {!list.author && (
            <button className="icon-btn" type="button" aria-label={`Удалить чек-лист «${list.title}»`} onClick={() => setConfirm({ kind: 'list' })}>
              <Icon name="trash" size={18} />
            </button>
          )}
        </div>
      </div>

      {editing && (
        <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <legend className="label" style={{ float: 'left', marginRight: 8 }}>
            Значок
          </legend>
          {LIST_ICONS.map((ic) => (
            <button
              key={ic.id}
              type="button"
              className="icon-btn"
              aria-label={ic.label}
              aria-pressed={list.icon === ic.id}
              style={list.icon === ic.id ? { borderColor: 'var(--accent)', color: 'var(--accent-ink)' } : undefined}
              onClick={() =>
                mutate(
                  (d) => ({ ...d, checklists: d.checklists.map((c) => (c.id === list.id ? { ...c, icon: ic.id } : c)) }),
                  () => api(`checklists/${list.id}`, 'PATCH', { icon: ic.id }),
                )
              }
            >
              <Icon name={ic.id} size={20} />
            </button>
          ))}
        </fieldset>
      )}

      {editing && data.household && !list.author && (
        <label className="check" style={{ padding: 0, alignSelf: 'flex-start' }}>
          <input
            type="checkbox"
            checked={!!list.household_id}
            onChange={(e) => {
              const shared = e.target.checked;
              mutate(
                (d) => ({ ...d, checklists: d.checklists.map((c) => (c.id === list.id ? { ...c, household_id: shared ? data.household!.id : null } : c)) }),
                () => api(`checklists/${list.id}`, 'PATCH', { shared }),
              );
            }}
          />
          <span className="check-text">Общий для семьи — видят и отмечают все</span>
        </label>
      )}

      {items.length > 0 && !editing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className="bar" style={{ flex: 1, height: 10 }}>
            <i style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
          <span className="mono" style={{ fontWeight: 500 }}>
            {done} / {items.length}
          </span>
        </div>
      )}

      {items.length === 0 && !editing && (
        <p style={{ margin: 0, color: 'var(--muted)' }}>В списке пока пусто — добавьте первую вещь ниже.</p>
      )}

      <div className="groups-grid">
        {groups.map((g) =>
          editing ? (
            <section key={g.name ?? '__none'} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label className="sr-only" htmlFor={`g-${g.name ?? 'none'}`}>
                  Название группы
                </label>
                <input
                  id={`g-${g.name ?? 'none'}`}
                  className="field display"
                  defaultValue={g.name ?? ''}
                  placeholder="Без группы"
                  maxLength={60}
                  style={{ fontWeight: 700 }}
                  onBlur={(e) => {
                    const to = e.target.value.trim() || null;
                    if (to === g.name) return;
                    mutate(
                      (d) => ({
                        ...d,
                        items: d.items.map((i) => (i.checklist_id === list.id && i.group_name === g.name ? { ...i, group_name: to } : i)),
                      }),
                      () => api(`checklists/${list.id}/rename-group`, 'POST', { from: g.name, to }),
                    );
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <button
                  className="icon-btn"
                  type="button"
                  aria-label={`Удалить группу «${groupLabel(g.name)}»`}
                  onClick={() => setConfirm({ kind: 'group', name: g.name })}
                >
                  <Icon name="trash" size={18} />
                </button>
              </div>
              {g.items.map((it, idx) => (
                <div key={it.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <label className="sr-only" htmlFor={`it-${it.id}`}>
                    Название пункта
                  </label>
                  <input
                    id={`it-${it.id}`}
                    className="field"
                    defaultValue={it.title}
                    maxLength={120}
                    onBlur={(e) => {
                      const t = e.target.value.trim();
                      if (t && t !== it.title) patchItem(it.id, { title: t });
                      else e.target.value = it.title;
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                  <button className="icon-btn bare" type="button" aria-label={`Выше: ${it.title}`} disabled={idx === 0} onClick={() => move(it, -1)}>
                    <Icon name="up" size={16} />
                  </button>
                  <button
                    className="icon-btn bare"
                    type="button"
                    aria-label={`Ниже: ${it.title}`}
                    disabled={idx === g.items.length - 1}
                    onClick={() => move(it, 1)}
                  >
                    <Icon name="down" size={16} />
                  </button>
                  <button
                    className="icon-btn bare"
                    type="button"
                    aria-label={`Удалить «${it.title}»`}
                    onClick={() =>
                      mutate(
                        (d) => ({ ...d, items: d.items.filter((i) => i.id !== it.id) }),
                        () => api(`items/${it.id}`, 'DELETE'),
                      )
                    }
                  >
                    <Icon name="x" size={18} />
                  </button>
                </div>
              ))}
              <AddInline label={`Пункт в «${groupLabel(g.name)}»`} onAdd={(t) => addItem(t, g.name)} />
            </section>
          ) : (
            <section key={g.name ?? '__none'} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {(g.name || groups.length > 1) && <h3 className="group-title">{groupLabel(g.name)}</h3>}
              {g.items.map((it) => (
                <label key={it.id} className={`check${it.done ? ' done' : ''}`}>
                  <input type="checkbox" checked={it.done} onChange={(e) => patchItem(it.id, { done: e.target.checked })} />
                  <span className="check-text">{it.title}</span>
                  {it.note && <em style={{ marginLeft: 'auto', fontStyle: 'normal', fontSize: 13, color: 'var(--muted)' }}>{it.note}</em>}
                </label>
              ))}
            </section>
          ),
        )}
      </div>

      {editing ? (
        newGroup ? (
          <form
            className="panel"
            style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, alignItems: 'end' }}
            onSubmit={(e) => {
              e.preventDefault();
              const name = newGroup.name.trim();
              const item = newGroup.item.trim();
              if (!name || !item) return;
              addItem(item, name);
              setNewGroup(null);
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label className="label" htmlFor="ng-name">
                Новая группа
              </label>
              <input id="ng-name" className="field" autoFocus maxLength={60} placeholder="Например, «Еда»" value={newGroup.name} onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label className="label" htmlFor="ng-item">
                Первая вещь в ней
              </label>
              <input id="ng-item" className="field" maxLength={120} value={newGroup.item} onChange={(e) => setNewGroup({ ...newGroup, item: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" type="submit" disabled={!newGroup.name.trim() || !newGroup.item.trim()}>
                Добавить
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setNewGroup(null)}>
                Отмена
              </button>
            </div>
          </form>
        ) : (
          <button className="btn btn-ghost btn-dashed" type="button" style={{ alignSelf: 'flex-start' }} onClick={() => setNewGroup({ name: '', item: '' })}>
            <Icon name="plus" size={18} />
            Новая группа
          </button>
        )
      ) : (
        <form
          style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 20, flexWrap: 'wrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            const t = newItem.trim();
            if (!t) return;
            addItem(t, newItemGroup || null);
            setNewItem('');
          }}
        >
          <label className="sr-only" htmlFor="add-item">
            Новая вещь
          </label>
          <input
            id="add-item"
            className="field"
            style={{ flex: '1 1 220px' }}
            maxLength={120}
            placeholder="Добавить вещь"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
          />
          {groups.some((g) => g.name) && (
            <>
              <label className="sr-only" htmlFor="add-item-group">
                Группа
              </label>
              <select id="add-item-group" className="field" style={{ flex: '0 1 180px' }} value={newItemGroup} onChange={(e) => setNewItemGroup(e.target.value)}>
                {groups
                  .filter((g) => g.name)
                  .map((g) => (
                    <option key={g.name!} value={g.name!}>
                      {g.name}
                    </option>
                  ))}
                <option value="">Без группы</option>
              </select>
            </>
          )}
          <button className="btn btn-primary" type="submit" disabled={!newItem.trim()}>
            <Icon name="plus" size={18} />
            Добавить
          </button>
        </form>
      )}

      {confirm?.kind === 'list' && (
        <Confirm
          title={`Удалить чек-лист «${list.title}»?`}
          text={`${plural(items.length, 'вещь', 'вещи', 'вещей')} удалятся вместе с ним. Отменить это нельзя.`}
          action="Удалить"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            setConfirm(null);
            try {
              await api(`checklists/${list.id}`, 'DELETE');
              onDeleted();
              await reload();
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        />
      )}
      {confirm?.kind === 'group' && (
        <Confirm
          title={`Удалить группу «${groupLabel(confirm.name)}»?`}
          text="Все вещи в этой группе удалятся. Отменить это нельзя."
          action="Удалить группу"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const name = confirm.name;
            setConfirm(null);
            mutate(
              (d) => ({ ...d, items: d.items.filter((i) => !(i.checklist_id === list.id && i.group_name === name)) }),
              () => api(`checklists/${list.id}/delete-group`, 'POST', { from: name }),
            );
          }}
        />
      )}
    </article>
  );
}

/** «+ Пункт» в режиме правки: кнопка превращается в поле по нажатию. */
function AddInline({ label, onAdd }: { label: string; onAdd: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  if (!open) {
    return (
      <button className="btn btn-ghost btn-dashed" type="button" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
        <Icon name="plus" size={18} />
        {label}
      </button>
    );
  }
  return (
    <form
      style={{ display: 'flex', gap: 6 }}
      onSubmit={(e) => {
        e.preventDefault();
        const t = value.trim();
        if (!t) return;
        onAdd(t);
        setValue('');
      }}
    >
      <label className="sr-only" htmlFor={`add-${label}`}>
        {label}
      </label>
      <input
        id={`add-${label}`}
        className="field"
        autoFocus
        maxLength={120}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <button className="icon-btn" type="submit" aria-label="Добавить" disabled={!value.trim()}>
        <Icon name="plus" size={18} />
      </button>
    </form>
  );
}
