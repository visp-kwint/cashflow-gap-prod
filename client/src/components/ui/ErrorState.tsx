import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-center">
      <AlertTriangle size={20} className="text-rose-400" />
      <p className="text-sm text-rose-300">{error.message || 'Что-то пошло не так'}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Повторить
        </Button>
      )}
    </div>
  );
}
