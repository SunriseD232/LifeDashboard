import jsQR from 'jsqr';

/**
 * Фото чека с телефона: картинка для ИИ (до 2048 px — мелкий шрифт длинного
 * чека ещё читается) и холст для поиска QR прямо на телефоне.
 */
export interface Photo {
  dataUrl: string;
  canvas: HTMLCanvasElement;
}

export function loadPhoto(file: File, max = 2048): Promise<Photo> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ dataUrl: c.toDataURL('image/jpeg', 0.8), canvas: c });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не получилось открыть фото.'));
    };
    img.src = url;
  });
}

/**
 * Текст QR на фото, который подходит под accept, или null. На чеке бывает
 * несколько QR (кассовый и рекламный «крутите барабан») — поэтому смотрим
 * кадр целиком и по кускам и берём первый подходящий. Куски сверху вниз
 * с перекрытием: кассовый QR обычно в середине или внизу.
 */
export function findQr(c: HTMLCanvasElement, accept: (text: string) => boolean = () => true): string | null {
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const tries: [number, number][] = [
    [0, 1],
    [0.3, 0.7],
    [0.4, 0.8],
    [0.5, 0.9],
    [0.2, 0.6],
    [0.6, 1],
    [0, 0.4],
  ];
  for (const [from, to] of tries) {
    const y = Math.round(c.height * from);
    const h = Math.round(c.height * (to - from));
    if (h < 50) continue;
    const data = ctx.getImageData(0, y, c.width, h);
    const hit = jsQR(data.data, data.width, data.height, { inversionAttempts: 'dontInvert' });
    if (hit?.data && accept(hit.data)) return hit.data;
  }
  return null;
}
