'use client';

import Crash from '@/components/Crash';

/** Ошибка в разделе — понятный экран вместо «Application error». */
export default function Error({ error }: { error: Error & { digest?: string } }) {
  return <Crash error={error} />;
}
