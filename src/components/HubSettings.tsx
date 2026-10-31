'use client';

import Link from 'next/link';
import { api } from '@/lib/api';
import { arrangeTiles, BAR_CHOICES, DEFAULT_BAR, DEFAULT_HUB, parseHub, SHORTCUT_SLOTS, SHORTCUTS, type HubPrefs } from '@/lib/hub';
import { useApp } from './AppShell';
import { Icon } from './icons';

/**
 * Настройки → «Главная»: нижнее меню главной (четыре места вокруг «+»),
 * быстрые действия и плитки — порядок, размер, что показывать.
 */
export default function HubSettings() {
  const { data, mutate } = useApp();
  const p = parseHub(data.settings.hub);
  const save = (next: HubPrefs) =>
    mutate(
      (d) => ({ ...d, settings: { ...d.settings, hub: next } }),
      () => api('settings', 'PATCH', { hub: next }),
    );
  return (
    <>
      <BarCard p={p} save={save} />
      <ShortcutsCard p={p} save={save} />
      <TilesCard p={p} save={save} />
    </>
  );
}

type CardProps = { p: HubPrefs; save: (next: HubPrefs) => void };
const hint = { margin: 0, fontSize: 'calc(14px * var(--fs))', color: 'var(--muted)' } as const;
const small = { minHeight: 36, padding: '4px 10px', fontSize: 'calc(13px * var(--fs))' } as const;

function swap<T>(list: T[], i: number, j: number): T[] {
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function BarCard({ p, save }: CardProps) {
  const bar = p.bar ?? DEFAULT_BAR;
  const byId = new Map(BAR_CHOICES.map((b) => [b.id, b]));
  const SLOT = ['Слева', 'Слева у «+»', 'Справа у «+»', 'Справа'];
  // Выбрали то, что уже стоит в другом месте, — меняем их местами (так и переставляют).
  const pick = (i: number, id: string) => {
    const next = [...bar];
    const j = next.indexOf(id);
    if (j >= 0) next[j] = next[i];
    next[i] = id;
    save({ ...p, bar: next });
  };
  return (
    <section className="card" aria-labelledby="set-hubbar">
      <h2 className="card-title display" id="set-hubbar">
        <Icon name="home" />
        Нижнее меню главной
      </h2>
      <p style={hint}>Четыре кнопки на телефоне, «+» всегда посередине. Выберите кнопку, что уже стоит в другом месте, — они поменяются. Меню «Дашборда» — во вкладке «Меню», у «Денег» оно своё.</p>
      <div className="hubset-preview" aria-hidden="true">
        {bar.map((id, i) => (
          <span key={id} style={{ order: i < 2 ? i : i + 1 }}>
            <Icon name={byId.get(id)!.icon} size={20} />
            {byId.get(id)!.label}
          </span>
        ))}
        <b style={{ order: 2 }}>
          <Icon name="plus" size={22} strokeWidth={2.2} />
        </b>
      </div>
      <ol className="hubset-list">
        {bar.map((id, i) => (
          <li key={i} className="nav-edit">
            <label htmlFor={`hubbar-${i}`} style={{ width: 104, flex: 'none', color: 'var(--muted)', fontSize: 'calc(13px * var(--fs))' }}>
              {SLOT[i]}
            </label>
            <select id={`hubbar-${i}`} className="field" style={{ flex: 1, minWidth: 0 }} value={id} onChange={(e) => pick(i, e.target.value)}>
              {BAR_CHOICES.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                  {b.money && b.id !== 'money' ? ' (Деньги)' : ''}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ol>
      {!bar.includes('settings') && <p style={hint}>Настройки останутся в «Ещё» и по карандашу на главной.</p>}
      {p.bar && (
        <button className="btn btn-ghost" type="button" style={{ alignSelf: 'flex-start' }} onClick={() => save({ ...p, bar: null })}>
          <Icon name="reset" size={16} />
          Как было
        </button>
      )}
    </section>
  );
}

function ShortcutsCard({ p, save }: CardProps) {
  const pinned = (id: string) => p.pins.includes(id);
  const toggle = (id: string) => {
    if (pinned(id)) save({ ...p, pins: p.pins.filter((x) => x !== id) });
    else if (p.pins.length < SHORTCUT_SLOTS) save({ ...p, pins: [...p.pins, id] });
  };
  const byId = new Map(SHORTCUTS.map((s) => [s.id, s]));
  const full = p.pins.length >= SHORTCUT_SLOTS;
  return (
    <section className="card" aria-labelledby="set-hubsc">
      <h2 className="card-title display" id="set-hubsc">
        <Icon name="sparkles" />
        Быстрые действия
      </h2>
      <div className="seg" role="radiogroup" aria-label="Как подбирать">
        <button type="button" role="radio" aria-checked={p.auto} aria-pressed={p.auto} onClick={() => save({ ...p, auto: true })}>
          Подбирать сами
        </button>
        <button type="button" role="radio" aria-checked={!p.auto} aria-pressed={!p.auto} onClick={() => save({ ...p, auto: false })}>
          Только мои
        </button>
      </div>
      <p style={hint}>
        {p.auto
          ? `На главной ${SHORTCUT_SLOTS} действий: сначала закреплённые, остальные — те, что вы чаще нажимаете в это время дня.`
          : `На главной только выбранные — до ${SHORTCUT_SLOTS}, в этом порядке.`}
      </p>
      {p.pins.length > 0 && (
        <ol className="hubset-list">
          {p.pins.map((id, i) => (
            <li key={id} className="nav-edit">
              <Icon name={byId.get(id)!.icon} size={18} />
              <span style={{ flex: 1, minWidth: 0 }}>{byId.get(id)!.label}</span>
              <button className="icon-btn bare" type="button" aria-label={`${byId.get(id)!.label} раньше`} disabled={i === 0} onClick={() => save({ ...p, pins: swap(p.pins, i, i - 1) })}>
                <Icon name="up" size={18} />
              </button>
              <button className="icon-btn bare" type="button" aria-label={`${byId.get(id)!.label} позже`} disabled={i === p.pins.length - 1} onClick={() => save({ ...p, pins: swap(p.pins, i, i + 1) })}>
                <Icon name="down" size={18} />
              </button>
              <button className="btn btn-ghost" type="button" style={small} onClick={() => toggle(id)}>
                {p.auto ? 'Открепить' : 'Убрать'}
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="hubset-chips" role="group" aria-label={p.auto ? 'Закрепить действие' : 'Добавить действие'}>
        {SHORTCUTS.filter((s) => !pinned(s.id)).map((s) => (
          <button key={s.id} type="button" className="chip" disabled={full} onClick={() => toggle(s.id)}>
            <Icon name={s.icon} size={14} />
            {s.label}
          </button>
        ))}
      </div>
      {full && <p style={hint}>Мест больше нет — уберите одно, чтобы добавить другое.</p>}
    </section>
  );
}

function TilesCard({ p, save }: CardProps) {
  const tiles = arrangeTiles(p, true);
  const toPrefs = (list: typeof tiles) => list.map((t) => ({ id: t.id, size: t.size, hidden: t.hidden }));
  const set = (list: typeof tiles) => save({ ...p, tiles: toPrefs(list) });
  return (
    <section className="card" aria-labelledby="set-hubtiles">
      <h2 className="card-title display" id="set-hubtiles">
        <Icon name="list" />
        Плитки
      </h2>
      <p style={hint}>Порядок, размер и что показывать. Плитка без данных сама прячется — например, «Бюджет», пока ни один не близок к пределу.</p>
      <ol className="hubset-list">
        {tiles.map((t, i) => (
          <li key={t.id} className="nav-edit hubset-tile" data-hidden={t.hidden || undefined}>
            <Icon name={t.icon} size={18} />
            <span style={{ flex: 1, minWidth: 0 }}>
              {t.label}
              {t.money && <span className="tag" style={{ marginLeft: 8 }}>Деньги</span>}
              <small>{t.hint}</small>
            </span>
            <span className="hubset-ctl">
              <button className="icon-btn bare" type="button" aria-label={`${t.label} выше`} disabled={i === 0} onClick={() => set(swap(tiles, i, i - 1))}>
                <Icon name="up" size={18} />
              </button>
              <button className="icon-btn bare" type="button" aria-label={`${t.label} ниже`} disabled={i === tiles.length - 1} onClick={() => set(swap(tiles, i, i + 1))}>
                <Icon name="down" size={18} />
              </button>
              {/* «Сегодня» всегда широкая: в половине не помещается неделя. */}
              {t.id !== 'today' && (
                <button
                  className="btn btn-ghost"
                  type="button"
                  style={small}
                  aria-label={`${t.label}: ${t.size === 'w' ? 'широкая' : 'маленькая'}, сменить размер`}
                  disabled={t.hidden}
                  onClick={() => set(tiles.map((x, j) => (j === i ? { ...x, size: x.size === 'w' ? 's' : 'w' } : x)))}
                >
                  {t.size === 'w' ? 'Широкая' : 'Маленькая'}
                </button>
              )}
              <button className="btn btn-ghost" type="button" style={small} aria-pressed={!t.hidden} onClick={() => set(tiles.map((x, j) => (j === i ? { ...x, hidden: !x.hidden } : x)))}>
                {t.hidden ? 'Показать' : 'Скрыть'}
              </button>
            </span>
          </li>
        ))}
      </ol>
      {(p.tiles || p.pins.length > 0 || !p.auto) && (
        <button className="btn btn-ghost" type="button" style={{ alignSelf: 'flex-start' }} onClick={() => save({ ...DEFAULT_HUB, bar: p.bar })}>
          <Icon name="reset" size={16} />
          Плитки и действия как было
        </button>
      )}
      <Link className="card-link" href="/" style={{ marginLeft: 0 }}>
        Посмотреть главную <Icon name="arrow" size={16} />
      </Link>
    </section>
  );
}
