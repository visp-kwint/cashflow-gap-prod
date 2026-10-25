import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Select,
  Skeleton,
  Textarea,
} from '@/components/ui';
import { formatDateTime } from '@/lib/format';

const STATUS_LABELS: Record<string, string> = {
  new: 'Новое',
  in_progress: 'В работе',
  resolved: 'Решено',
  closed: 'Закрыто',
};

export default function Support() {
  const [subject, setSubject] = useState('');
  const [kind, setKind] = useState<'problem' | 'question'>('problem');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const tickets = useAsync(() => api.support.listTickets(), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) {
      setError('Заполните тему и сообщение');
      return;
    }
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      await api.support.createTicket({ subject: subject.trim(), kind, message: message.trim() });
      setSubject('');
      setMessage('');
      setSent(true);
      tickets.refetch();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card title="Новое обращение">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Тема">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Коротко о сути" />
          </Field>
          <Field label="Тип">
            <Select value={kind} onChange={(e) => setKind(e.target.value as 'problem' | 'question')}>
              <option value="problem">Проблема</option>
              <option value="question">Вопрос</option>
            </Select>
          </Field>
          <Field label="Сообщение">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Опишите, что случилось или что нужно уточнить"
            />
          </Field>
          {sent && <p className="text-xs text-emerald-400">Обращение отправлено и сохранено в БД.</p>}
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <Button type="submit" loading={busy}>
            Отправить
          </Button>
        </form>
      </Card>

      <Card title="Мои обращения">
        {tickets.error ? (
          <ErrorState error={tickets.error} onRetry={tickets.refetch} />
        ) : tickets.loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : !tickets.data || tickets.data.length === 0 ? (
          <EmptyState title="Обращений пока нет" hint="Здесь появятся ваши заявки в поддержку" />
        ) : (
          <ul className="divide-y divide-slate-800">
            {tickets.data.map((t) => (
              <li key={t.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-200">{t.subject}</p>
                  <div className="flex gap-1.5">
                    <Badge tone={t.kind === 'problem' ? 'amber' : 'blue'}>
                      {t.kind === 'problem' ? 'Проблема' : 'Вопрос'}
                    </Badge>
                    <Badge tone="gray">{STATUS_LABELS[t.status] ?? t.status}</Badge>
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDateTime(t.createdAt)} · {t.message}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
