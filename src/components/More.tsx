'use client';

import Link from 'next/link';
import { SECTIONS, useApp } from './AppShell';
import { Icon } from './icons';

/** «Ещё» на телефоне: разделы, которым не хватило места в нижней панели, и настройки. */
export default function More() {
  const { data } = useApp();
  const rest = SECTIONS.filter((s) => !s.phone);
  return (
    <>
      <div className="page-head">
        <h1 className="h1 display">Ещё</h1>
      </div>
      <nav aria-label="Другие разделы" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rest.map((s) => (
          <Link key={s.href} className="list-card" href={s.href} style={{ flexDirection: 'row', alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>
            <span className="list-icon">
              <Icon name={s.icon} />
            </span>
            <span style={{ flex: 1, fontWeight: 600 }}>{s.label}</span>
            <Icon name="arrow" size={18} />
          </Link>
        ))}
        <Link className="list-card" href="/settings" style={{ flexDirection: 'row', alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>
          <span className="list-icon">
            <Icon name="settings" />
          </span>
          <span style={{ flex: 1, fontWeight: 600 }}>Настройки</span>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{data.login}</span>
        </Link>
      </nav>
    </>
  );
}
