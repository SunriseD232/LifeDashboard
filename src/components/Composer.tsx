'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { blobToDataUrl, handOffReceipt, pickMime } from '@/lib/audio';
import { money } from '@/lib/currencies';
import { localDay } from '@/lib/dates';
import type { HubItem } from '@/server/api/hub';
import { useApp } from './AppShell';
import { Icon } from './icons';
import { Sheet } from './Phone';
import { quickLabel } from './TaskDialog';

export interface ComposerStart {
  text?: string;
  voice?: boolean;
}

type Phase = 'edit' | 'busy' | 'rec' | 'review';

/**
 * «Записать» с главной: фраза, длинный текст или голос → дела, напоминания,
 * заметки, покупки и траты. Разбирает и сохраняет сервер (src/server/api/hub.ts);
 * здесь — посмотреть, убрать лишнее и сохранить разом.
 */
export default function Composer({ start, onClose, onOpenMoney }: { start: ComposerStart; onClose: (saved: boolean) => void; onOpenMoney: () => void }) {
  const { reload, toast } = useApp();
  const today = localDay();
  const [text, setText] = useState(start.text ?? '');
  const [phase, setPhase] = useState<Phase>(start.voice ? 'rec' : start.text ? 'busy' : 'edit');
  const [items, setItems] = useState<(HubItem & { off?: boolean })[]>([]);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const attempt = useRef(0);
  const photo = useRef<HTMLInputElement>(null);
  const close = useCallback(() => onClose(false), [onClose]);

  async function parse(t: string) {
    if (!t.trim()) return;
    setError(null);
    setPhase('busy');
    try {
      const r = await api<{ items: HubItem[] }>('hub/parse', 'POST', { text: t, today });
      setItems(r.items);
      setSaid(null);
      setPhase('review');
    } catch (e) {
      setError((e as Error).message);
      setPhase('edit');
    }
  }

  async function record() {
    const my = ++attempt.current;
    setError(null);
    const mime = pickMime();
    if (!navigator.mediaDevices?.getUserMedia || !mime) {
      setPhase('edit');
      return setError('Здесь запись не работает — надиктуйте через микрофон на клавиатуре.');
    }
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setPhase('edit');
      return setError('Нет доступа к микрофону. Разрешите его: Настройки iPhone → Safari → Микрофон.');
    }
    if (my !== attempt.current) return s.getTracks().forEach((t) => t.stop());
    const chunks: Blob[] = [];
    const r = new MediaRecorder(s, { mimeType: mime });
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      s.getTracks().forEach((t) => t.stop());
      if (my !== attempt.current) return;
      const blob = new Blob(chunks, { type: r.mimeType || mime });
      if (blob.size < 2000) {
        setPhase('edit');
        return setError('Запись получилась пустой. Попробуйте ещё раз.');
      }
      setPhase('busy');
      try {
        const res = await api<{ said: string; items: HubItem[] }>('hub/voice', 'POST', { audio: await blobToDataUrl(blob), today });
        setItems(res.items);
        setSaid(res.said || null);
        setText(res.said || '');
        setPhase('review');
      } catch (e) {
        setError((e as Error).message);
        setPhase('edit');
      }
    };
    r.start(1000);
    rec.current = r;
    setSeconds(0);
    setPhase('rec');
  }

  useEffect(() => {
    if (start.text) parse(start.text);
    if (start.voice) record();
    return () => {
      attempt.current++;
      if (rec.current?.state === 'recording') rec.current.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'rec') return;
    const t = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(() => {
    if (phase === 'rec' && seconds >= 90) rec.current?.stop();
  }, [seconds, phase]);

  async function save() {
    const chosen = items.filter((i) => !i.off).map(({ off: _o, ...i }) => i);
    if (!chosen.length) return close();
    setPhase('busy');
    let last: string | null = null;
    try {
      last = localStorage.getItem('money:lastAccount');
    } catch {
      /* приватный режим */
    }
    try {
      const r = await api<{ saved: number }>('hub/save', 'POST', { items: chosen, money_account: last });
      await reload();
      toast(r.saved === 1 ? 'Записано' : `Записано: ${r.saved}`);
      onClose(true);
    } catch (e) {
      setError((e as Error).message);
      setPhase('review');
    }
  }

  const on = items.filter((i) => !i.off).length;

  return (
    <Sheet title={phase === 'review' ? `Нашёл ${items.length} ${items.length === 1 ? 'запись' : items.length < 5 ? 'записи' : 'записей'}` : 'Записать'} onClose={close}>
      <input
        ref={photo}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          // Чек читает окно чека «Денег»: отдаём ему фото и переходим.
          handOffReceipt(f);
          onClose(false);
          onOpenMoney();
        }}
      />

      {phase === 'rec' && (
        <div className="cmp-rec" aria-live="polite">
          <span className="cmp-orb" aria-hidden="true">
            <Icon name="mic" size={30} />
          </span>
          <b className="display">Слушаю…</b>
          <span className="muted">
            0:{String(seconds).padStart(2, '0')} · можно надиктовать длинный текст или несколько дел
          </span>
          <div className="cmp-actions">
            <button className="btn btn-ghost" type="button" onClick={close}>
              Отмена
            </button>
            <button className="btn btn-primary" type="button" style={{ flex: 1 }} onClick={() => rec.current?.state === 'recording' && rec.current.stop()}>
              Готово
            </button>
          </div>
        </div>
      )}

      {(phase === 'edit' || phase === 'busy') && (
        <form
          className="cmp-compose"
          onSubmit={(e) => {
            e.preventDefault();
            parse(text);
          }}
        >
          <label htmlFor="cmp-text" className="sr-only">
            Что записать
          </label>
          <textarea
            id="cmp-text"
            className="cmp-text"
            rows={Math.min(10, Math.max(3, Math.ceil(text.length / 38)))}
            placeholder="Кофе 350, завтра в 9 позвонить врачу, купить молоко… Можно длинным текстом."
            value={text}
            disabled={phase === 'busy'}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="cmp-tools">
            <button className="icon-btn bare" type="button" aria-label="Фото чека" disabled={phase === 'busy'} onClick={() => photo.current?.click()}>
              <Icon name="camera" size={22} />
            </button>
            <button className="icon-btn bare" type="button" aria-label="Надиктовать" disabled={phase === 'busy'} onClick={record}>
              <Icon name="mic" size={22} />
            </button>
            <button className="btn btn-primary cmp-go" type="submit" disabled={phase === 'busy' || !text.trim()}>
              {phase === 'busy' ? 'Разбираю…' : 'Разобрать'}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="cmp-error" role="alert">
          {error}
        </p>
      )}

      {phase === 'review' && (
        <>
          {said && (
            <p className="cmp-said">
              <span className="muted">Вы сказали</span> «{said}»
            </p>
          )}
          <ul className="cmp-list">
            {items.map((it, i) => (
              <li key={i} className={`cmp-item${it.off ? ' off' : ''}`}>
                <ItemView it={it} today={today} />
                <button
                  className="icon-btn bare"
                  type="button"
                  aria-label={it.off ? 'Вернуть' : 'Убрать'}
                  aria-pressed={!it.off}
                  onClick={() => setItems((l) => l.map((x, j) => (j === i ? { ...x, off: !x.off } : x)))}
                >
                  <Icon name={it.off ? 'plus' : 'x'} size={18} />
                </button>
              </li>
            ))}
          </ul>
          <div className="cmp-actions">
            <button className="btn btn-ghost" type="button" onClick={() => setPhase('edit')}>
              Изменить текст
            </button>
            <button className="btn btn-primary" type="button" style={{ flex: 1 }} disabled={!on} onClick={save}>
              {on > 1 ? `Сохранить все (${on})` : 'Сохранить'}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/** Одна запись: куда попадёт, название и подробности. */
function ItemView({ it, today }: { it: HubItem; today: string }) {
  if (it.type === 'money') {
    const d = it.draft;
    const sign = d.kind === 'income' ? 1 : -1;
    return (
      <div className="cmp-body">
        <span className="cmp-dest money" aria-hidden="true">
          <Icon name="wallet" size={18} />
        </span>
        <div className="cmp-t">
          <small>Деньги · {d.kind === 'income' ? 'доход' : 'расход'}</small>
          <b>{d.payee || 'Без названия'}</b>
          {d.day && d.day !== today && <span>{new Date(`${d.day}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span>}
        </div>
        <span className="mono cmp-amt">{money(sign * (d.amount_minor ?? 0), d.currency ?? 'RUB', { sign: true })}</span>
      </div>
    );
  }
  const l = quickLabel(it, today);
  const where = it.type === 'note' ? 'Заметки' : it.type === 'shopping' ? 'Кухня · купить' : `Дела · ${it.type === 'task' ? 'дело' : 'напоминание'}`;
  const extra = (it.type === 'task' || it.type === 'reminder') && (it.note || it.subtasks.length) ? it : null;
  return (
    <div className="cmp-body">
      <span className={`cmp-dest${it.type === 'shopping' ? ' warm' : ' blue'}`} aria-hidden="true">
        <Icon name={l.icon} size={18} />
      </span>
      <div className="cmp-t">
        <small>{where}</small>
        <b>{l.text}</b>
        {l.meta && <span>{l.meta}</span>}
        {extra && extra.subtasks.length > 0 && (
          <ul className="cmp-subs">
            {extra.subtasks.slice(0, 6).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
            {extra.subtasks.length > 6 && <li className="muted">и ещё {extra.subtasks.length - 6}</li>}
          </ul>
        )}
        {extra?.note && <span className="cmp-note">Ваш текст целиком — в описании</span>}
      </div>
    </div>
  );
}
