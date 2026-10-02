import type { IconName } from '@/lib/types';

const PATHS: Record<string, JSX.Element> = {
  plus: <path d="M12 5v14M5 12h14" />,
  edit: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16v4z" />
      <path d="M13.5 6.5l4 4" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  reset: <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  bell: (
    <>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  repeat: (
    <>
      <path d="M17 3l3 3-3 3" />
      <path d="M4 12V9a3 3 0 0 1 3-3h13" />
      <path d="M7 21l-3-3 3-3" />
      <path d="M20 12v3a3 3 0 0 1-3 3H4" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  check: <path d="M5 12l5 5 9-10" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  wave: (
    <>
      <path d="M3 10c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
      <path d="M3 16c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
    </>
  ),
  bag: (
    <>
      <path d="M5 8h14l-1 12H6z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </>
  ),
  house: (
    <>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 10v10h12V10" />
    </>
  ),  home: (
    <>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 10v10h12V10" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a7.5 7.5 0 1 0 10.5 10.5z" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  logout: (
    <>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 8l-4 4 4 4M6 12h10" />
    </>
  ),
};

export function Icon({ name, size = 20, strokeWidth = 1.8 }: { name: string; size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

export const LIST_ICONS: { id: IconName; label: string }[] = [
  { id: 'wave', label: 'Вода' },
  { id: 'bag', label: 'Сумка' },
  { id: 'house', label: 'Дом' },
  { id: 'list', label: 'Список' },
];
