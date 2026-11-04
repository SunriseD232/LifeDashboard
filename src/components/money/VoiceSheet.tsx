'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { localDay } from '@/lib/dates';
import type { MoneyDraft } from '@/lib/moneyAi';
import { Icon } from '../icons';
import { useSheet } from '../useModalFocus';
import { useMoney, type Sheet } from './MoneyShell';

const MAX_SECONDS = 60;

/** Черновики от ИИ: одна операция — сразу её окно, несколько — список. */
export function showDrafts(open: (s: Sheet) => void, ops: MoneyDraft[], said?: string) {
  if (ops.length === 1) open({ type: 'op', op: ops[0] });
  else open({ type: 'drafts', ops, said });
}

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  // iPhone пишет AAC в mp4; Chrome и Firefox — opus в webm.
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m));
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('Не получилось прочитать запись.'));
    r.readAsDataURL(blob);
  });
}

/**
 * Ввод голосом: запись сразу при открытии, «Готово» — на сервер. Речь
 * распознаёт и разбирает на траты модель со звуком, одним запросом.
 */
export default function VoiceSheet({ onClose }: { onClose: () => void }) {
  const { open, toast, aiOn } = useMoney();
  const [phase, setPhase] = useState<'start' | 'rec' | 'busy' | 'error'>('start');
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelled = useRef(false);
  // Номер попытки: окно закрыли или начали заново, пока ждали микрофон, —
  // старый поток выключаем.
  const attempt = useRef(0);

  const stopTracks = () => stream.current?.getTracks().forEach((t) => t.stop());

  async function start() {
    const my = ++attempt.current;
    cancelled.current = false;
    setError(null);
    const mime = pickMime();
    if (!navigator.mediaDevices?.getUserMedia || !mime) {
      setPhase('error');
      return setError('Здесь запись не работает. Нажмите на строку ввода и надиктуйте через микрофон на клавиатуре.');
    }
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setPhase('error');
      return setError('Нет доступа к микрофону. Разрешите его: Настройки iPhone → Safari → Микрофон.');
    }
    if (my !== attempt.current || cancelled.current) return s.getTracks().forEach((t) => t.stop());
    stream.current = s;
    chunks.current = [];
    const r = new MediaRecorder(s, { mimeType: mime });
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      s.getTracks().forEach((t) => t.stop());
      if (!cancelled.current && my === attempt.current) send(new Blob(chunks.current, { type: r.mimeType || mime }));
    };
    r.start(1000);
    rec.current = r;
    setSeconds(0);
    setPhase('rec');
  }

  async function send(blob: Blob) {
    if (blob.size < 2000) {
      setPhase('error');
      return setError('Запись получилась пустой. Попробуйте ещё раз.');
    }
    setPhase('busy');
    try {
      // Вопрос голосом («сколько ушло на кафе?») — ответ; трата — черновики, как раньше.
      const res = await api<{ said: string; result?: 'payment' | 'question'; ops?: MoneyDraft[]; answer?: string; search?: string | null }>('money/ai/voice', 'POST', {
        audio: await toDataUrl(blob),
        today: localDay(),
        ask: aiOn(),
      });
      if (res.result === 'question' && res.answer) open({ type: 'answer', q: res.said || 'Вопрос голосом', a: res.answer, search: res.search ?? null });
      else showDrafts(open, res.ops ?? [], res.said);
    } catch (e) {
      setPhase('error');
      setError((e as Error).message);
    }
  }

  const finish = () => rec.current?.state === 'recording' && rec.current.stop();

  useEffect(() => {
    start();
    return () => {
      cancelled.current = true;
      attempt.current++;
      if (rec.current?.state === 'recording') rec.current.stop();
      stopTracks();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'rec') return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(() => {
    if (phase === 'rec' && seconds >= MAX_SECONDS) {
      toast('Минута — записываю, что успели');
      finish();
    }
  }, [seconds, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const box = useRef<HTMLElement>(null);
  useSheet(box, onClose, phase !== 'busy');
  return (
    <div className="sheet-scrim" onClick={(e) => e.target === e.currentTarget && phase !== 'busy' && onClose()}>
      <section ref={box} className="sheet m-sheet m-voice" role="dialog" aria-modal="true" aria-label="Ввод голосом">
        <div className={`m-voice-orb${phase === 'rec' ? ' on' : ''}`} aria-hidden="true">
          <Icon name="mic" size={34} />
        </div>
        <div className="m-voice-t" aria-live="polite">
          <b className="display">{phase === 'rec' ? 'Слушаю…' : phase === 'busy' ? 'Разбираю…' : phase === 'error' ? 'Не получилось' : 'Включаю микрофон…'}</b>
          <span className="muted m-small">
            {phase === 'rec'
              ? `0:${String(seconds).padStart(2, '0')} · можно назвать несколько трат подряд или спросить`
              : phase === 'busy'
                ? 'Слушаем запись и разбираем: трата это или вопрос'
                : 'Например: «кофе триста пятьдесят» или «сколько я потратил на такси?»'}
          </span>
        </div>
        {error && (
          <p className="m-error" role="alert">
            {error}
          </p>
        )}
        <div className="m-actions">
          <button className="btn btn-ghost" type="button" onClick={onClose} disabled={phase === 'busy'}>
            Отмена
          </button>
          {phase === 'error' ? (
            <button className="btn btn-primary" type="button" style={{ flex: 1 }} onClick={start}>
              Ещё раз
            </button>
          ) : (
            <button className="btn btn-primary" type="button" style={{ flex: 1 }} onClick={finish} disabled={phase !== 'rec'}>
              Готово
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
