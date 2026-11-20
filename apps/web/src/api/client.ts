/** HTTP-клиент: cookie-сессия + CSRF double-submit. Ошибки — единый формат backend. */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    public requestId?: string,
  ) {
    super(message);
  }
}

/** Демо-сборка (GitHub Pages): нет сервера, данные только в браузере. */
export const IS_DEMO = import.meta.env.VITE_DEMO === "1";

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

function readCsrfCookie(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)lichnosti_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

type Query = Record<string, string | number | boolean | string[] | undefined | null>;

function buildUrl(path: string, query?: Query) {
  const url = new URL(`/api/v1${path}`, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
      else url.searchParams.set(k, String(v));
    }
  }
  return url.pathname + url.search;
}

export async function api<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  opts: { body?: unknown; query?: Query } = {},
): Promise<T> {
  if (IS_DEMO) {
    // Демо-сборка для статического хостинга: запросы обрабатываются в браузере (src/demo/backend.ts).
    const { demoRequest } = await import("../demo/backend");
    const q: Record<string, string | string[] | undefined> = {};
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v === undefined || v === null || v === "") continue;
      q[k] = Array.isArray(v) ? v : String(v);
    }
    return (await demoRequest(method, path, q, opts.body)) as T;
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") {
    const t = csrfToken ?? readCsrfCookie();
    if (t) headers["X-CSRF-Token"] = t;
  }
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      credentials: "same-origin",
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "network", "Сервер недоступен. Проверьте, что API запущен.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(
      res.status,
      e?.code ?? "http_error",
      e?.message ?? `Ошибка ${res.status}`,
      e?.details,
      e?.request_id,
    );
  }
  return data as T;
}

export const get = <T>(path: string, query?: Query) => api<T>("GET", path, { query });
export const post = <T>(path: string, body?: unknown) => api<T>("POST", path, { body });
export const put = <T>(path: string, body?: unknown) => api<T>("PUT", path, { body });
export const patch = <T>(path: string, body?: unknown) => api<T>("PATCH", path, { body });

/** Загрузка файла (multipart). Демо-сборка файлы не принимает. */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  if (IS_DEMO) throw new ApiError(503, "demo_unavailable", "Загрузка файлов работает на рабочем сервере.");
  const headers: Record<string, string> = { Accept: "application/json" };
  const t = csrfToken ?? readCsrfCookie();
  if (t) headers["X-CSRF-Token"] = t;
  let res: Response;
  try {
    res = await fetch(buildUrl(path), { method: "POST", headers, credentials: "same-origin", body: form });
  } catch {
    throw new ApiError(0, "network", "Сервер недоступен. Проверьте, что API запущен.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? "http_error", e?.message ?? `Ошибка ${res.status}`, e?.details, e?.request_id);
  }
  return data as T;
}
