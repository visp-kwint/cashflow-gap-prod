import { Badge } from '@/components/ui/Badge';
import type { CounterpartyRisk } from '@/types/api';
import { cn } from '@/lib/cn';

const RISK_TONE: Record<CounterpartyRisk, 'green' | 'amber' | 'red'> = {
  low: 'green',
  medium: 'amber',
  high: 'red',
};

const LABEL: Record<CounterpartyRisk, string> = {
  low: 'Надёжный',
  medium: 'Средний риск',
  high: 'Высокий риск',
};

/** Бейдж статуса контрагента из открытых реестров (ТЗ-доп. §2): low/medium/high.
 *  rose — только для high (опасность), amber — средний. */
export function CounterpartyShield({
  risk,
  badgeText,
  detailsText,
  className,
}: {
  risk: CounterpartyRisk;
  /** Короткий текст из реестра (например, "Долг перед ФНС > 100 тыс. ₽") */
  badgeText?: string;
  /** Полное описание — показывается в тултипе на hover */
  detailsText?: string;
  className?: string;
}) {
  const text = badgeText ?? LABEL[risk];
  return (
    <span
      className={cn('relative inline-flex cursor-default', className)}
      title={detailsText}
      aria-label={text}
    >
      <Badge tone={RISK_TONE[risk]}>{text}</Badge>
    </span>
  );
}
