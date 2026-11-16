import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError, IS_DEMO } from "../api/client";
import { DemoLogin } from "../demo/DemoUi";
import { Ambient, useAmbient } from "../components/Ambient";
import { LogoMark } from "../components/Logo";
import { useAuth } from "../lib/auth";

export function LoginPage() {
  useAmbient("high");
  const { me, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = (loc.state as { from?: string } | null)?.from ?? "/overview";

  if (me) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      nav(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Ambient />
      <main className="relative z-10 flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm fade-in">
          <div className="mb-8 flex flex-col items-center text-center">
            <LogoMark size={52} />
            <h1 className="mt-5 font-mono text-sm font-semibold tracking-[0.3em] text-fg text-glow">ЛИЧНОСТИ</h1>
            <p className="mt-2 text-sm text-muted">Внутренняя платформа аналитических персон и контекста</p>
          </div>
          {IS_DEMO ? (
            <DemoLogin
              onLogin={async (demoEmail) => {
                await login(demoEmail, "");
                nav(from, { replace: true });
              }}
            />
          ) : (
          <form onSubmit={submit} className="panel space-y-4 bg-surface/80 p-6 backdrop-blur" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium text-fg-soft">
                Рабочий email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium text-fg-soft">
                Пароль
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p className="rounded-ui border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn-primary w-full" disabled={busy || !email || !password}>
              {busy ? "Вход…" : "Войти"}
            </button>
          </form>
          )}
          <p className="mt-6 text-center text-xs text-muted">
            Учётные записи создаёт администратор. Персоны — вымышленные внутренние модели, не реальные люди.
          </p>
          <p className="mt-3 text-center text-xs">
            <Link to="/about" className="text-fg-soft underline decoration-line-strong underline-offset-4 hover:text-accent">
              О проекте
            </Link>
          </p>
        </div>
      </main>
    </>
  );
}
