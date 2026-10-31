'use client';

/**
 * «К содержимому» — первая остановка Tab: мимо бокового меню сразу в main.
 * Видна только в фокусе. Ищем main на месте: у «Денег» он свой на каждой
 * странице, а id одинаковый на всех не повесить.
 */
export default function SkipLink() {
  return (
    <a
      className="skip-link"
      href="#main"
      onClick={(e) => {
        const main = document.querySelector<HTMLElement>('main');
        if (!main) return;
        e.preventDefault();
        if (!main.hasAttribute('tabindex')) main.tabIndex = -1;
        main.focus();
      }}
    >
      К содержимому
    </a>
  );
}
