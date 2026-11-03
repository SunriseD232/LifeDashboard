/**
 * Заглушка раздела, пока не пришёл его код: заголовок и несколько строк.
 * Показывается сразу по нажатию в меню (src/app/loading.tsx) — экран не
 * стоит на месте, пока грузится следующий.
 */
export default function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skel" role="status" aria-busy="true" aria-label="Загружаем">
      <div className="page-head">
        <span className="skel-bar skel-title" />
      </div>
      <div className="skel-list">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skel-row">
            <span className="skel-bar skel-dot" />
            <span className="skel-bar" style={{ width: `${[72, 54, 64, 46, 60, 40, 68, 50][i % 8]}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
