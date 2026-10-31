/** Запись голоса в браузере — общее для «Денег» и главной супер-аппа. */

/** Формат записи: iPhone пишет AAC в mp4, Chrome и Firefox — opus в webm. */
export function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m));
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('Не получилось прочитать запись.'));
    r.readAsDataURL(blob);
  });
}

/**
 * Передать файл между экранами одного приложения: «Чек» на главной выбирает
 * фото, а открывает его окно чека в «Деньгах».
 */
let pending: File | null = null;
export function handOffReceipt(f: File) {
  pending = f;
}
export function takeReceipt(): File | null {
  const f = pending;
  pending = null;
  return f;
}
