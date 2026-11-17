import clsx from "clsx";
import * as DM from "@radix-ui/react-dropdown-menu";
import { Bell, Info, LogOut, Menu, Search, Settings, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { IS_DEMO } from "../api/client";
import { DemoBanner } from "../demo/DemoUi";
import { useAuth } from "../lib/auth";
import { ROLE_LABEL } from "../lib/format";
import { Ambient } from "./Ambient";
import { Wordmark } from "./Logo";
import { Avatar } from "./ui";

export const NAV = [
  { to: "/overview", label: "Обзор" },
  { to: "/personas", label: "Личности" },
  { to: "/context", label: "Контекст" },
  { to: "/tasks", label: "Задания" },
  { to: "/lab", label: "Лаборатория" },
];

function GlobalSearch({ onDone }: { onDone?: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    nav(`/personas?q=${encodeURIComponent(q.trim())}`);
    setQ("");
    onDone?.();
  };
  return (
    <form onSubmit={submit} role="search" className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск личностей…"
        aria-label="Глобальный поиск"
        className="input h-9 w-full pl-8 lg:w-56"
      />
    </form>
  );
}

function Notifications() {
  return (
    <DM.Root>
      <DM.Trigger className="btn-ghost h-9 w-9 px-0" aria-label="Уведомления">
        <Bell className="h-[18px] w-[18px]" />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={8} className="panel-elevated z-50 w-80 bg-surface p-4 text-sm shadow-2xl fade-in">
          <div className="font-semibold text-fg">Уведомления</div>
          <p className="mt-2 text-muted">
            Новых уведомлений нет. Уведомления о мониторинге, предложениях и согласованиях появятся вместе с
            соответствующими модулями (итерации 2–4).
          </p>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function UserMenu() {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  if (!me) return null;
  return (
    <DM.Root>
      <DM.Trigger className="flex items-center gap-2 rounded-ui p-1 hover:bg-elevated" aria-label="Меню пользователя">
        <Avatar name={me.display_name} size={30} />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={8} className="panel-elevated z-50 w-64 bg-surface p-1.5 shadow-2xl fade-in">
          <div className="px-2.5 py-2">
            <div className="font-semibold text-fg">{me.display_name}</div>
            <div className="truncate text-xs text-muted">{me.email}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              {me.roles.map((r) => (
                <span key={r} className="chip border-line-strong text-[11px] text-fg-soft">
                  {ROLE_LABEL[r]}
                </span>
              ))}
              {me.roles.length === 0 && <span className="text-xs text-warning">Роли не назначены</span>}
            </div>
          </div>
          <DM.Separator className="my-1 h-px bg-line" />
          <DM.Item
            onSelect={() => nav("/settings")}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-fg-soft outline-none data-[highlighted]:bg-elevated"
          >
            <Settings className="h-4 w-4" /> Настройки и система
          </DM.Item>
          <DM.Item
            onSelect={() => nav("/about")}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-fg-soft outline-none data-[highlighted]:bg-elevated"
          >
            <Info className="h-4 w-4" /> О проекте
          </DM.Item>
          <DM.Item
            onSelect={async () => {
              await logout();
              nav("/login");
            }}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-fg-soft outline-none data-[highlighted]:bg-elevated"
          >
            <LogOut className="h-4 w-4" /> Выйти
          </DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function TopNav() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  return (
    <header className="fixed inset-x-2 top-2 z-40 sm:inset-x-3 sm:top-3">
      <div
        className="mx-auto flex max-w-shell items-center gap-4 rounded-[20px] border border-line bg-canvas/80 pl-4 pr-2 backdrop-blur-xl backdrop-saturate-150"
        style={{ height: "var(--nav-height)" }}
      >
        <Link to="/overview" className="shrink-0 rounded-ui" aria-label="Личности — на главную">
          <Wordmark />
        </Link>
        <nav className="mx-auto hidden items-center gap-1 md:flex" aria-label="Основная навигация">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                clsx(
                  "rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors duration-150",
                  isActive ? "bg-fg text-canvas" : "text-fg-soft hover:bg-elevated",
                )
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 md:ml-0">
          <div className="hidden lg:block">
            <GlobalSearch />
          </div>
          <Notifications />
          <UserMenu />
          <button
            className="btn-ghost h-9 w-9 px-0 md:hidden"
            aria-label={open ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-2 rounded-[20px] border border-line bg-canvas/95 backdrop-blur-xl md:hidden fade-in" key={loc.pathname}>
          <nav className="flex flex-col gap-1 p-3" aria-label="Мобильная навигация">
            <div className="mb-2">
              <GlobalSearch onDone={() => setOpen(false)} />
            </div>
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  clsx("rounded-xl px-3 py-2.5 text-[15px] font-semibold", isActive ? "bg-fg text-canvas" : "text-fg-soft")
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}

export function AppLayout() {
  return (
    <>
      <Ambient />
      <TopNav />
      <main className="relative z-10 pb-16" style={{ paddingTop: "calc(var(--nav-height) + 40px)" }}>
        {IS_DEMO && <DemoBanner />}
        <Outlet />
      </main>
    </>
  );
}
