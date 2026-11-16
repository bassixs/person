import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ApiError, get, patch, post } from "../api/client";
import type { AuditEvent, Page, Role, UserOut } from "../api/types";
import { useAmbient } from "../components/Ambient";
import { IntegrationsList } from "../components/Integrations";
import { EmptyState, ErrorState, Field, LocalTabs, Modal, PageHeader, Spinner } from "../components/ui";
import { useAuth } from "../lib/auth";
import { ACTION_LABEL, fmtDateTime, ROLE_LABEL } from "../lib/format";

const ROLES: Role[] = ["admin", "editor", "author", "operator"];

function CreateUser({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState<Role[]>(["author"]);
  const m = useMutation({
    mutationFn: () => post<UserOut>("/users", { email, display_name: name, password, roles }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      onOpenChange(false);
      setEmail("");
      setName("");
      setPassword("");
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Новый сотрудник">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" htmlFor="ue">
          <input id="ue" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Имя" htmlFor="un">
          <input id="un" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Временный пароль" hint="Минимум 10 символов. Передайте сотруднику безопасным каналом." htmlFor="up">
          <input id="up" type="password" autoComplete="new-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required />
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg-soft">Роли (можно совмещать)</legend>
          <div className="flex flex-wrap gap-2">
            {ROLES.map((r) => (
              <label key={r} className={clsx("chip cursor-pointer", roles.includes(r) ? "border-accent/60 bg-accent/10 text-fg" : "text-muted")}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={roles.includes(r)}
                  onChange={() => setRoles((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]))}
                />
                {ROLE_LABEL[r]}
              </label>
            ))}
          </div>
        </fieldset>
        {m.error && <p className="text-sm text-danger">{(m.error as ApiError).message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </button>
          <button type="submit" className="btn-primary" disabled={m.isPending}>
            Создать
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Users() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const users = useQuery({ queryKey: ["users"], queryFn: () => get<UserOut[]>("/users") });
  const upd = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<UserOut> }) => patch<UserOut>(`/users/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
  if (users.isLoading) return <Spinner />;
  if (users.error) return <ErrorState error={users.error} onRetry={() => users.refetch()} />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Администратор без роли «Редактор» не может активировать контент. Редактор может утверждать собственную работу.
        </p>
        <button className="btn-primary shrink-0" onClick={() => setOpen(true)}>
          <UserPlus className="h-4 w-4" /> Добавить
        </button>
      </div>
      {upd.error && <p className="text-sm text-danger">{(upd.error as ApiError).message}</p>}
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-line">
            <tr className="label-mono">
              <th className="px-4 py-3 font-normal">Сотрудник</th>
              <th className="px-4 py-3 font-normal">Роли</th>
              <th className="px-4 py-3 font-normal">Статус</th>
              <th className="px-4 py-3 font-normal">Создан</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.data?.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3">
                  <div className="font-medium text-fg">{u.display_name}</div>
                  <div className="text-xs text-muted">{u.email}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {ROLES.map((r) => {
                      const has = u.roles.includes(r);
                      return (
                        <button
                          key={r}
                          aria-pressed={has}
                          disabled={upd.isPending}
                          onClick={() => upd.mutate({ id: u.id, body: { roles: has ? u.roles.filter((x) => x !== r) : [...u.roles, r] } })}
                          className={clsx("chip text-[11px] transition-colors", has ? "border-accent/60 bg-accent/10 text-fg" : "border-line text-muted hover:text-fg-soft")}
                        >
                          {ROLE_LABEL[r]}
                        </button>
                      );
                    })}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      className="accent-[rgb(var(--accent))]"
                      checked={u.is_active}
                      disabled={u.id === me?.id || upd.isPending}
                      onChange={(e) => upd.mutate({ id: u.id, body: { is_active: e.target.checked } })}
                    />
                    {u.is_active ? "активен" : "отключён"}
                  </label>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{fmtDateTime(u.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CreateUser open={open} onOpenChange={setOpen} />
    </div>
  );
}

function Audit() {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["audit", page],
    queryFn: () => get<Page<AuditEvent>>("/audit", { page, page_size: 50 }),
    placeholderData: (prev) => prev,
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / 50));
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-line">
          <tr className="label-mono">
            <th className="px-4 py-3 font-normal">Время (МСК)</th>
            <th className="px-4 py-3 font-normal">Кто</th>
            <th className="px-4 py-3 font-normal">Действие</th>
            <th className="px-4 py-3 font-normal">Объект</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {q.data?.items.map((e) => (
            <tr key={e.id}>
              <td className="px-4 py-2.5 font-mono text-xs text-muted">{fmtDateTime(e.occurred_at)}</td>
              <td className="px-4 py-2.5 text-fg-soft">{e.actor?.display_name ?? "—"}</td>
              <td className="px-4 py-2.5 text-fg-soft">{ACTION_LABEL[e.action] ?? e.action}</td>
              <td className="px-4 py-2.5 font-mono text-xs text-muted">
                {e.entity_type}
                {e.entity_version ? ` v${e.entity_version}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-muted">
        <span>Всего: {q.data?.total}</span>
        <div className="flex gap-2">
          <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Назад
          </button>
          <span className="self-center font-mono">
            {page}/{pages}
          </span>
          <button className="btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Вперёд
          </button>
        </div>
      </div>
    </div>
  );
}

function Profile() {
  const { me } = useAuth();
  if (!me) return null;
  return (
    <div className="panel max-w-xl space-y-3 p-5 text-sm">
      <div>
        <div className="label-mono">Имя</div>
        <div className="text-fg">{me.display_name}</div>
      </div>
      <div>
        <div className="label-mono">Email</div>
        <div className="text-fg">{me.email}</div>
      </div>
      <div>
        <div className="label-mono">Роли</div>
        <div className="text-fg">{me.roles.map((r) => ROLE_LABEL[r]).join(", ") || "не назначены"}</div>
      </div>
      <div>
        <div className="label-mono">Привязка MAX</div>
        <div className="text-muted">Появится в итерации 5 (разовый код подтверждения).</div>
      </div>
    </div>
  );
}

export function SettingsPage() {
  useAmbient("low");
  const { can } = useAuth();
  const tabs = [
    { to: "/settings/profile", label: "Профиль" },
    ...(can("users.manage") ? [{ to: "/settings/users", label: "Сотрудники и роли" }] : []),
    { to: "/settings/integrations", label: "Подключения" },
    ...(can("audit.read") ? [{ to: "/settings/audit", label: "Аудит" }] : []),
  ];
  return (
    <div className="shell">
      <PageHeader eyebrow="Система" title="Настройки" />
      <LocalTabs items={tabs} />
      <Routes>
        <Route index element={<Navigate to="profile" replace />} />
        <Route path="profile" element={<Profile />} />
        <Route path="users" element={can("users.manage") ? <Users /> : <EmptyState title="Нет доступа">Раздел доступен администратору.</EmptyState>} />
        <Route path="integrations" element={<IntegrationsList />} />
        <Route path="audit" element={can("audit.read") ? <Audit /> : <EmptyState title="Нет доступа">Журнал доступен редактору и администратору.</EmptyState>} />
      </Routes>
    </div>
  );
}
