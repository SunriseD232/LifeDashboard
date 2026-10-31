import Link from 'next/link';
import { Icon } from './icons';

/** Отдельная страница настройки: «назад» туда, откуда обычно приходят, и заголовок. */
export default function SubPage({ title, back, backLabel, children }: { title: string; back: string; backLabel: string; children: React.ReactNode }) {
  return (
    <>
      <Link href={back} className="back-link">
        <Icon name="back" size={18} />
        {backLabel}
      </Link>
      <div className="page-head" style={{ marginTop: 8 }}>
        <h1 className="h1 display">{title}</h1>
      </div>
      <div className="settings-col">{children}</div>
    </>
  );
}
