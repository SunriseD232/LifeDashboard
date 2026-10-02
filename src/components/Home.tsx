'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { appliesOn, hhmm, localDay } from '@/lib/dates';
import { useApp } from './AppShell';
import { Icon } from './icons';

/**
 * Главная. Пока — то, что уже есть: дела на сегодня и чек-листы. Карточки
 * дел, сроков, погоды, кухни и тренировок появятся вместе с разделами (план —
 * в README).
 */
export default function Home() {
  const { data, mutate, now, setOpenList } = useApp();
  const router = useRouter();

  // Старые ссылки (в том числе из уже присланных push): /task#reminders.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash === '#reminders') router.replace('/reminders');
    else if (hash === '#lists') router.replace('/lists');
  }, [router]);

  const hour = now.getHours();
  const greeting = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  const todays = data.reminders.filter((r) => appliesOn(r, now)).sort((a, b) => a.at_time.localeCompare(b.at_time));
  const done = new Set(data.done);

  const toggle = (id: string, value: boolean) => {
    mutate(
      (d) => ({ ...d, done: value ? [...d.done, id] : d.done.filter((x) => x !== id) }),
      () => api(`reminders/${id}/done`, 'PUT', { day: localDay(now), done: value }),
    );
  };

  const openList = (id: string) => {
    setOpenList(id);
    router.push('/lists');
  };

  return (
    <>
      <div className="page-head">
        <h1 className="h1 display">{greeting}</h1>
      </div>
      <div className="home-grid">
        <section className="card" aria-labelledby="home-today">
          <div className="card-head">
            <h2 className="card-title display" id="home-today">
              <Icon name="bell" />
              Сегодня
            </h2>
            <Link className="card-link" href="/reminders">
              Напоминания <Icon name="arrow" size={16} />
            </Link>
          </div>
          {todays.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--muted)' }}>На сегодня дел нет.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {todays.map((r) => (
                <label key={r.id} className={`check${done.has(r.id) ? ' done' : ''}`}>
                  <input type="checkbox" checked={done.has(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} />
                  <span className="mono" style={{ fontWeight: 500, width: 48, flex: 'none' }}>
                    {hhmm(r.at_time)}
                  </span>
                  <span className="check-text">{r.title}</span>
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="home-lists">
          <div className="card-head">
            <h2 className="card-title display" id="home-lists">
              <Icon name="list" />
              Чек-листы
            </h2>
            <Link className="card-link" href="/lists">
              Все <Icon name="arrow" size={16} />
            </Link>
          </div>
          {data.checklists.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--muted)' }}>Чек-листов пока нет.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.checklists.map((c) => {
                const items = data.items.filter((i) => i.checklist_id === c.id);
                const got = items.filter((i) => i.done).length;
                return (
                  <button key={c.id} type="button" className="list-card" onClick={() => openList(c.id)}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                      <span className="list-icon">
                        <Icon name={c.icon} size={22} />
                      </span>
                      <span style={{ flex: 1, fontWeight: 600 }}>{c.title}</span>
                      <span className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>
                        {got} из {items.length}
                      </span>
                    </span>
                    <span className="bar" style={{ width: '100%' }} aria-hidden="true">
                      <i style={{ width: items.length ? `${(got / items.length) * 100}%` : 0 }} />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
