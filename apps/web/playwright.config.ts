import { defineConfig } from "@playwright/test";

/**
 * E2E против запущенного стека (web + api + PostgreSQL).
 * E2E_BASE_URL (по умолчанию http://localhost:5173), E2E_EMAIL, E2E_PASSWORD — учётка редактора.
 * PW_CHANNEL=msedge|chrome — использовать установленный браузер вместо скачиваемого Chromium.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    channel: process.env.PW_CHANNEL || undefined,
    locale: "ru-RU",
    trace: "retain-on-failure",
  },
  reporter: [["list"]],
});
