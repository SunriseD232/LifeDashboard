'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from './AppShell';
import { Icon } from './icons';
import PushPanel from './PushPanel';
import { CityPicker } from './Weather';

const EXAMPLES = ['Позвонить маме', 'Записаться к врачу', 'Купить продукты'];

/**
 * Знакомство при первом входе: город → уведомления → первое дело. Каждый шаг
 * можно пропустить; после — больше не показываем (user_settings.onboarded).
 */
export default function Onboarding() {
  const { data, reload, toast } = useApp();
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    try {
      await api('settings', 'PATCH', { onboarded: true });
    } catch {
      /* не страшно: покажем ещё раз в следующий вход */
    }
    await reload();
  };

  const addFirst = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await api('tasks', 'POST', { title: title.trim() });
      toast('Первая задача добавлена');
      await finish();
    } catch (err) {
      toast((err as Error).message);
      setBusy(false);
    }
  };

  const steps = [
    {
      icon: 'partly',
      title: 'Где вы живёте?',
      text: 'Покажу погоду и подскажу, когда взять зонт.',
      body: <CityPicker onPicked={() => setStep(1)} />,
      done: !!data.settings.city,
    },
    {
      icon: 'bell',
      title: 'Напоминать вовремя',
      text: 'Включите уведомления — напоминания и сроки придут на телефон, даже когда приложение закрыто.',
      body: <PushPanel toast={toast} />,
      done: true,
    },
    {
      icon: 'tasks',
      title: 'Первое дело',
      text: 'Что нужно не забыть? Напишите — дальше разберётесь по ходу.',
      body: (
        <form onSubmit={addFirst} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="sr-only" htmlFor="ob-task">
            Первое дело
          </label>
          <input id="ob-task" className="field" maxLength={200} placeholder="Например, «Позвонить маме»" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {EXAMPLES.map((x) => (
              <button key={x} type="button" className="chip" onClick={() => setTitle(x)}>
                {x}
              </button>
            ))}
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy || !title.trim()}>
            <Icon name="plus" size={18} />
            Добавить и начать
          </button>
        </form>
      ),
      done: false,
    },
  ];
  const s = steps[step];
  const last = step === steps.length - 1;

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-labelledby="ob-title">
      <div className="onboarding-box">
        <div className="onboarding-top">
          <div className="onboarding-dots" aria-label={`Шаг ${step + 1} из ${steps.length}`}>
            {steps.map((_, i) => (
              <i key={i} data-on={i <= step || undefined} />
            ))}
          </div>
          <button className="add-line" type="button" onClick={finish} style={{ padding: 0 }}>
            Пропустить всё
          </button>
        </div>
        <span className="empty-icon" aria-hidden="true">
          <Icon name={s.icon} size={26} />
        </span>
        <h1 id="ob-title" className="display" style={{ margin: 0, fontSize: 26 }}>
          {s.title}
        </h1>
        <p style={{ margin: 0, color: 'var(--muted)' }}>{s.text}</p>
        {s.body}
        <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
          {step > 0 && (
            <button className="btn btn-ghost" type="button" onClick={() => setStep(step - 1)}>
              Назад
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className={`btn ${s.done && !last ? 'btn-primary' : 'btn-ghost'}`} type="button" onClick={() => (last ? finish() : setStep(step + 1))}>
            {last ? 'Пропустить' : s.done ? 'Дальше' : 'Пропустить'}
          </button>
        </div>
      </div>
    </div>
  );
}
