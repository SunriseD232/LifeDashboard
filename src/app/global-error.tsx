'use client';

import Crash from '@/components/Crash';

/** Ошибка выше разделов (в самом каркасе) — свой html, раз каркаса нет. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="ru">
      <body style={{ margin: 0 }}>
        <Crash error={error} />
      </body>
    </html>
  );
}
