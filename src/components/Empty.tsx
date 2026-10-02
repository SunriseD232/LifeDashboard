'use client';

import { Icon } from './icons';

/**
 * Пустой экран: значок, одна короткая фраза и одна понятная кнопка с
 * примером. Вторая кнопка — по желанию, тихая.
 */
export default function Empty({
  icon,
  title,
  action,
  onAction,
  busy,
  secondary,
  onSecondary,
}: {
  icon: string;
  title: string;
  action: string;
  onAction: () => void;
  busy?: boolean;
  secondary?: string;
  onSecondary?: () => void;
}) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">
        <Icon name={icon} size={26} />
      </span>
      <p className="empty-title">{title}</p>
      <button className="btn btn-primary" type="button" onClick={onAction} disabled={busy}>
        <Icon name="plus" size={18} />
        {action}
      </button>
      {secondary && onSecondary && (
        <button className="add-line" type="button" onClick={onSecondary} style={{ alignSelf: 'center' }}>
          {secondary}
        </button>
      )}
    </div>
  );
}
