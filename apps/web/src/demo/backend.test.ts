import { beforeEach, describe, expect, it } from "vitest";
import type { PersonaDetail, Page, PersonaListItem, VersionDetail } from "../api/types";
import { demoRequest, resetDemo } from "./backend";

const call = <T,>(m: string, p: string, body?: unknown, q: Record<string, string> = {}) => demoRequest(m, p, q, body) as Promise<T>;
const loginAs = (email: string) => call("POST", "/auth/demo-login", { email });

describe("демо-backend повторяет правила API", () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetDemo();
  });

  it("стартует с семи черновиков из легенд и требует входа", async () => {
    await expect(call("GET", "/personas")).rejects.toMatchObject({ status: 401 });
    await loginAs("editor@demo.local");
    const list = await call<Page<PersonaListItem>>("GET", "/personas");
    expect(list.total).toBe(7);
    expect(list.items.every((p) => p.status === "draft" && p.active_version === null)).toBe(true);
  });

  it("правка: происхождение ставит «сервер», ревизия растёт, устаревшая ревизия — 409", async () => {
    await loginAs("editor@demo.local");
    const p = await call<PersonaDetail>("POST", "/personas", { display_name: "Тест", mode: "manual" });
    const url = `/personas/${p.id}/versions/${p.draft_version!.id}`;
    const v = await call<VersionDetail>("GET", url);
    const passport = structuredClone(v.passport);
    passport.sections.legend.fields.occupation = { value: "Учитель", certainty: "hypothesis", source_kind: "ai_suggestion", editor_approved: false, dependencies: [] };
    const saved = await call<VersionDetail>("PUT", url, { passport, expected_revision: v.revision });
    expect(saved.revision).toBe(2);
    expect(saved.passport.sections.legend.fields.occupation.source_kind).toBe("editor");
    expect(saved.content_hash).not.toBe(v.content_hash);
    await expect(call("PUT", url, { passport, expected_revision: 1 })).rejects.toMatchObject({ status: 409, code: "revision_conflict" });
  });

  it("значение с «неизвестно» отклоняется", async () => {
    await loginAs("editor@demo.local");
    const p = await call<PersonaDetail>("POST", "/personas", { display_name: "Тест" });
    const url = `/personas/${p.id}/versions/${p.draft_version!.id}`;
    const v = await call<VersionDetail>("GET", url);
    v.passport.sections.legend.fields.occupation = { value: "X", certainty: "unknown", source_kind: "editor", editor_approved: false, dependencies: [] };
    await expect(call("PUT", url, { passport: v.passport, expected_revision: 1 })).rejects.toMatchObject({ status: 422 });
  });

  it("активация: editor — 409 с блокерами, admin и author — 403", async () => {
    await loginAs("editor@demo.local");
    const p = await call<PersonaDetail>("POST", "/personas", { display_name: "Тест" });
    const body = { version_id: p.draft_version!.id };
    await expect(call("POST", `/personas/${p.id}/activate`, body)).rejects.toMatchObject({ status: 409, code: "activation_blocked" });
    await loginAs("admin@demo.local");
    await expect(call("POST", `/personas/${p.id}/activate`, body)).rejects.toMatchObject({ status: 403 });
    await expect(call("POST", "/personas", { display_name: "X" })).rejects.toMatchObject({ status: 403 });
    await loginAs("author@demo.local");
    await expect(call("POST", `/personas/${p.id}/activate`, body)).rejects.toMatchObject({ status: 403 });
  });

  it("оператор не видит черновики; ИИ-черновик честно недоступен", async () => {
    await loginAs("operator@demo.local");
    expect((await call<Page<PersonaListItem>>("GET", "/personas")).total).toBe(0);
    await loginAs("editor@demo.local");
    await expect(call("POST", "/personas", { display_name: "X", mode: "ai_draft" })).rejects.toMatchObject({ status: 503, code: "llm_not_configured" });
  });

  it("интервью и предложения в демо: пустые списки и честное «не подключено»", async () => {
    await loginAs("editor@demo.local");
    const first = (await call<Page<PersonaListItem>>("GET", "/personas")).items[0]!;
    const d = await call<{ ai_configured: boolean; pending_proposals: number }>("GET", `/personas/${first.id}`);
    expect(d.ai_configured).toBe(false);
    expect(d.pending_proposals).toBe(0);
    expect(await call("GET", `/personas/${first.id}/proposals`)).toEqual([]);
    expect(await call("GET", `/personas/${first.id}/interviews`)).toEqual([]);
    await expect(call("POST", `/personas/${first.id}/interviews`)).rejects.toMatchObject({ status: 503, code: "llm_not_configured" });
    await expect(call("POST", `/personas/${first.id}/proposals/deepen`, { section: "legend" })).rejects.toMatchObject({ status: 503 });
    expect(await call("GET", `/personas/${first.id}/validations`)).toEqual([]);
    await expect(call("POST", `/personas/${first.id}/validations`, { kind: "check" })).rejects.toMatchObject({ status: 503 });
    expect(await call<{ status: string }>("GET", `/personas/${first.id}/consistency`)).toMatchObject({ status: "unavailable" });
  });
});
