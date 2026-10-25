import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { api, errorMessage } from '@/api';
import { useAuthStore } from '@/store/auth';
import { Button, Card, Field, Input, Modal } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { AuthResponse } from '@/types/api';

const MAX_FILE_MB = 5;
const ACCEPTED = ['.csv', '.xlsx'];

export default function Auth() {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regCompany, setRegCompany] = useState('');
  const [regInn, setRegInn] = useState('');
  const [regFile, setRegFile] = useState<File | null>(null);
  const [useDemo, setUseDemo] = useState(false);
  /** ТЗ-доработка WP-7 §5: окно «Загружено N, пропущено M» после регистрации с выпиской. */
  const [importResult, setImportResult] = useState<AuthResponse | null>(null);

  function finish(res: AuthResponse) {
    setAuth(res.token, res.user);
    navigate(from, { replace: true });
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      finish(await api.auth.login({ email: loginEmail.trim(), password: loginPassword }));
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function validateRegister(): string | null {
    if (!/^\S+@\S+\.\S+$/.test(regEmail.trim())) return 'Укажите корректный email';
    if (regPassword.length < 8) return 'Пароль — минимум 8 символов';
    if (!regCompany.trim()) return 'Укажите название компании или ИП';
    if (!/^[0-9]{10}$|^[0-9]{12}$/.test(regInn.trim())) return 'ИНН — 10 или 12 цифр';
    if (!useDemo) {
      if (!regFile) return 'Загрузите выписку (CSV/XLSX) или включите демо-данные';
      const ext = `.${regFile.name.split('.').pop()?.toLowerCase()}`;
      if (!ACCEPTED.includes(ext)) return 'Допускаются только файлы .csv или .xlsx';
      if (regFile.size > MAX_FILE_MB * 1024 * 1024) return `Файл больше ${MAX_FILE_MB} МБ`;
    }
    return null;
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    const problem = validateRegister();
    if (problem) {
      setFormError(problem);
      return;
    }
    setBusy(true);
    setFormError(null);
    const fd = new FormData();
    fd.append('email', regEmail.trim());
    fd.append('password', regPassword);
    fd.append('companyName', regCompany.trim());
    fd.append('inn', regInn.trim());
    if (useDemo) fd.append('useDemoData', 'true');
    else if (regFile) fd.append('file', regFile);
    try {
      const res = await api.auth.register(fd);
      // ТЗ-доработка WP-7 §5: сначала показать итог импорта («Загружено N, пропущено M»),
      // «Продолжить» ведёт на главную; закрытие окна тоже входит в приложение.
      if (res.import) setImportResult(res);
      else finish(res);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const imp = importResult?.import;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-5 flex flex-col items-center text-center">
          <div>
            <h1 className="text-lg font-bold text-slate-100">Кассовые разрывы</h1>
            <p className="text-xs text-slate-400">Прогноз кассовых разрывов по банковскому счёту</p>
          </div>
        </div>

        <Card>
          <div className="mb-4 grid grid-cols-2 rounded-lg bg-slate-800 p-0.5 text-sm font-medium">
            <button
              type="button"
              onClick={() => {
                setTab('login');
                setFormError(null);
              }}
              className={cn('rounded-md py-1.5', tab === 'login' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400')}
            >
              Вход
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('register');
                setFormError(null);
              }}
              className={cn('rounded-md py-1.5', tab === 'register' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400')}
            >
              Регистрация
            </button>
          </div>

          {formError && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {tab === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-3">
              <Field label="Email">
                <Input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="you@company.ru"
                  autoComplete="email"
                />
              </Field>
              <Field label="Пароль">
                <Input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </Field>
              <Button type="submit" loading={busy} className="w-full">
                Войти
              </Button>
              <p className="text-center text-xs text-slate-400">
                Демо-вход (после seed): demo@cashflow.ru · demo1234
              </p>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Email">
                  <Input
                    type="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="you@company.ru"
                  />
                </Field>
                <Field label="Пароль (мин. 8)">
                  <Input
                    type="password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </Field>
              </div>
              <Field label="Компания / ИП">
                <Input
                  value={regCompany}
                  onChange={(e) => setRegCompany(e.target.value)}
                  placeholder="ООО «Ромашка» или ИП Иванов"
                />
              </Field>
              <Field label="ИНН (10 или 12 цифр)">
                <Input
                  value={regInn}
                  onChange={(e) => setRegInn(e.target.value)}
                  placeholder="7701234567"
                  inputMode="numeric"
                />
              </Field>

              <div>
                <Field label="Выписка по счёту за 1,5–2 года (CSV/XLSX, до 5 МБ)">
                  <input
                    type="file"
                    accept=".csv,.xlsx"
                    disabled={useDemo}
                    onChange={(e) => setRegFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-slate-400 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-200 hover:file:bg-slate-600 disabled:opacity-50"
                  />
                </Field>
                {regFile && !useDemo && (
                  <p className="mt-1 text-xs text-slate-500">
                    {regFile.name} ({(regFile.size / 1024 / 1024).toFixed(1)} МБ)
                  </p>
                )}
                <a
                  href="/statement-template.csv"
                  download="statement-template.csv"
                  className="mt-2 inline-block text-xs font-medium text-emerald-400 underline underline-offset-2 hover:text-emerald-300"
                >
                  Скачать шаблон выписки (CSV)
                </a>
                <p className="mt-1 text-xs text-slate-400">
                  Формат: Дата (дд.мм.гггг), Контрагент, ИНН контрагента (необязательно), Назначение,
                  Сумма (расходы — отрицательные). Колонки можно переставлять.
                </p>
              </div>

              <Button
                variant={useDemo ? 'primary' : 'secondary'}
                icon={Sparkles}
                className="w-full"
                onClick={() => {
                  setUseDemo(!useDemo);
                  if (!useDemo) setRegFile(null);
                }}
              >
                {useDemo ? 'Выбраны демо-данные' : 'Использовать демо-данные'}
              </Button>

              <Button type="submit" loading={busy} className="w-full">
                Зарегистрироваться
              </Button>
            </form>
          )}
        </Card>

        {/* ТЗ-доработка WP-7 §5: итог импорта после регистрации */}
        <Modal
          open={!!importResult}
          onClose={() => {
            if (importResult) finish(importResult);
            setImportResult(null);
          }}
          title={imp ? `Загружено ${imp.imported}, пропущено ${imp.skipped}` : ''}
          footer={
            <Button
              className="w-full"
              onClick={() => {
                if (importResult) finish(importResult);
                setImportResult(null);
              }}
            >
              Продолжить
            </Button>
          }
        >
          {imp && (
            <div className="space-y-3 text-sm text-slate-300">
              <dl className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                <div>Строк в файле: {imp.rowsTotal}</div>
                <div>Дубли удалено: {imp.duplicatesRemoved}</div>
              </dl>
              {imp.warnings.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-400">
                    Ошибки и предупреждения (первые {Math.min(imp.warnings.length, 10)}):
                  </p>
                  <ul className="max-h-40 space-y-1 overflow-auto rounded-lg bg-slate-950/50 p-2 text-xs text-amber-300">
                    {imp.warnings.slice(0, 10).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {imp.dataQuality?.level === 'insufficient' && (
                <p className="text-xs text-amber-300">
                  История короче 14 дней — прогноз ориентировочный, вероятность разрыва не оценивается.
                </p>
              )}
              {imp.dataQuality?.warnings?.slice(0, 3).map((w, i) => (
                <p key={i} className="text-xs text-slate-400">
                  {w}
                </p>
              ))}
            </div>
          )}
        </Modal>
      </div>
    </div>
  );
}
