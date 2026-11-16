import { useQuery } from "@tanstack/react-query";
import { FlaskConical, RotateCcw } from "lucide-react";
import { useState } from "react";
import { ApiError, get } from "../api/client";
import type { Role } from "../api/types";
import { ROLE_LABEL } from "../lib/format";

const ROLE_HINT: Record<Role, string> = {
  editor: "создаёт и правит паспорта, архивирует, пытается активировать",
  author: "создаёт и правит черновики, без архива и активации",
  admin: "сотрудники, роли, аудит; контент только читает",
  operator: "видит только утверждённые персоны (пока их нет)",
};

/** Вход в демо: выбор роли без пароля. */
export function DemoLogin({ onLogin }: { onLogin: (email: string) => Promise<void> }) {
  const users = useQuery({
    queryKey: ["demo-users"],
    queryFn: () => get<{ email: string; display_name: string; roles: Role[] }[]>("/auth/demo-users"),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="panel space-y-3 bg-surface/80 p-6 backdrop-blur">
      <div className="flex items-start gap-2 rounded-ui border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-fg-soft">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <span>
          Демо-версия на GitHub Pages: без сервера и общей базы. Всё, что вы создадите, хранится только в этом браузере.
        </span>
      </div>
      <div className="text-sm font-medium text-fg-soft">Войти как</div>
      {users.isLoading && <div className="skeleton h-40" />}
      {users.data?.map((u) => (
        <button
          key={u.email}
          className="flex w-full flex-col items-start rounded-ui border border-line-strong px-3 py-2.5 text-left transition-colors hover:border-accent/60 hover:bg-accent/5 disabled:opacity-50"
          disabled={busy !== null}
          onClick={async () => {
            setBusy(u.email);
            setError(null);
            try {
              await onLogin(u.email);
            } catch (e) {
              setError(e instanceof ApiError ? e.message : "Не удалось войти");
              setBusy(null);
            }
          }}
        >
          <span className="text-sm font-semibold text-fg">
            {u.roles.map((r) => ROLE_LABEL[r]).join(", ")}
            {busy === u.email && <span className="ml-2 text-xs font-normal text-muted">вход…</span>}
          </span>
          <span className="text-xs text-muted">{u.roles[0] ? ROLE_HINT[u.roles[0]] : u.display_name}</span>
        </button>
      ))}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Постоянная пометка демо-режима в рабочем интерфейсе. */
export function DemoBanner() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="shell mb-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-ui border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-fg-soft" role="note">
        <FlaskConical className="h-4 w-4 shrink-0 text-warning" />
        <span className="flex-1">
          <b className="text-fg">Демо-режим.</b> Данные хранятся только в этом браузере, сервера и общей базы нет. ИИ, поиск и
          MAX отключены.
        </span>
        <button
          className="btn-ghost btn-sm"
          disabled={busy}
          onClick={async () => {
            if (!window.confirm("Сбросить демо? Все созданные вами данные в этом браузере будут удалены.")) return;
            setBusy(true);
            const { resetDemo } = await import("./backend");
            await resetDemo();
            window.location.assign(import.meta.env.BASE_URL);
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Сбросить демо
        </button>
      </div>
    </div>
  );
}
