'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment } from 'react';
import { arrange, HELP, HOME, type NavPref, type Section } from '@/lib/nav';
import { activeIndex, MONEY_BAR } from '@/lib/superapp';
import { Icon } from '../icons';
import ThemeToggle from '../ThemeToggle';

/** Разделы «Денег» в боковом меню: всё, что на телефоне в нижнем меню и в «Ещё». */
const MONEY_NAV = [
  ...MONEY_BAR.slice(1, -1),
  { href: '/money/recurring', label: 'Регулярные', icon: 'repeat' },
  { href: '/money/debts', label: 'Долги', icon: 'users' },
  { href: '/money/goals', label: 'Цели', icon: 'flag' },
  { href: '/money/settings', label: 'Настройки денег', icon: 'settings' },
];

/**
 * Боковое меню «Денег» на компьютере — как у LifeDashboard: те же разделы
 * в том же порядке, а «Деньги» раскрыты своими пунктами. На телефоне его нет
 * (там нижнее меню).
 */
export default function MoneySide({ nav, login }: { nav: NavPref[] | null | undefined; login: string | null }) {
  const path = usePathname();
  const active = activeIndex(MONEY_NAV, path);
  const sections = [HOME, ...arrange(nav).visible] as Section[];
  return (
    <aside className="side">
      <Link className="brand display" href="/">
        <span className="brand-mark">
          <Icon name="bag" size={20} strokeWidth={2} />
        </span>
        LifeDashboard
      </Link>
      <nav aria-label="Разделы" style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 14 }}>
        {sections.map((s) => (
          <Link key={s.href} className="nav" href={s.href}>
            <Icon name={s.icon} />
            {s.label}
          </Link>
        ))}
        <div className="nav-sep">Деньги</div>
        {MONEY_NAV.map((s, i) => (
          <Link key={s.href} className="nav" href={s.href} aria-current={i === active ? 'page' : undefined}>
            <Icon name={s.icon} />
            {s.label}
          </Link>
        ))}
        {HELP.map((s) => (
          <Fragment key={s.href}>
            {s.group && <div className="nav-sep">{s.group}</div>}
            <Link className="nav" href={s.href}>
              <Icon name={s.icon} />
              {s.label}
            </Link>
          </Fragment>
        ))}
      </nav>
      <div className="side-foot">
        <span className="who">{login ?? ''}</span>
        <Link className="icon-btn bare" href="/settings" aria-label="Настройки" title="Настройки">
          <Icon name="settings" />
        </Link>
        <ThemeToggle />
      </div>
    </aside>
  );
}
