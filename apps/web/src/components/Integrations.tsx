import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { PlugZap } from "lucide-react";
import { useState } from "react";
import { get, post } from "../api/client";
import type { IntegrationStatus } from "../api/types";
import { useAuth } from "../lib/auth";
import { ErrorState, Spinner } from "./ui";

function Row({ i }: { i: IntegrationStatus }) {
  const { can } = useAuth();
  const [result, setResult] = useState<IntegrationStatus | null>(null);
  const check = useMutation({
    mutationFn: () => post<IntegrationStatus>(`/integrations/${i.name}/check`),
    onSuccess: setResult,
  });
  const checkable = i.name !== "search" && i.status === "configured" && can("integrations.diagnose");
  const shown = result ?? i;
  const label =
    i.status === "not_configured"
      ? "Не подключено"
      : shown.ok === true
        ? "Подключено и проверено"
        : shown.ok === false
          ? "Ошибка соединения"
          : "Настроено, не проверено";
  const tone = i.status === "not_configured" ? "text-muted" : shown.ok ? "text-success" : shown.ok === false ? "text-danger" : "text-warning";
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-fg">{i.title}</div>
        <div className={clsx("mt-0.5 text-sm", tone)}>{label}</div>
        {result?.error && <div className="mt-1 font-mono text-xs text-danger">{result.error}</div>}
        {result?.latency_ms !== undefined && <div className="mt-1 font-mono text-xs text-muted">задержка {result.latency_ms} мс</div>}
        <p className="mt-2 text-xs text-muted">{i.how_to_connect}</p>
        {Object.entries(i.detail).some(([, v]) => v) && (
          <div className="mt-1 font-mono text-[11px] text-muted">
            {Object.entries(i.detail)
              .filter(([, v]) => v)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" · ")}
          </div>
        )}
      </div>
      {checkable && (
        <button className="btn-secondary btn-sm" onClick={() => check.mutate()} disabled={check.isPending}>
          <PlugZap className="h-4 w-4" /> {check.isPending ? "Проверка…" : "Проверить соединение"}
        </button>
      )}
    </li>
  );
}

export function IntegrationsList() {
  const q = useQuery({ queryKey: ["integrations"], queryFn: () => get<IntegrationStatus[]>("/integrations/status") });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="panel px-5">
      <ul className="divide-y divide-line">{q.data?.map((i) => <Row key={i.name} i={i} />)}</ul>
      <p className="border-t border-line py-3 text-xs text-muted">
        Секреты хранятся только на сервере и не передаются в браузер. «Подключено» показывается лишь после реального
        успешного вызова.
      </p>
    </div>
  );
}
