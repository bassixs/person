import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Задайте E2E_EMAIL и E2E_PASSWORD (учётка с ролью editor)");

test("редактор: вход → создать личность → сохранить → перезагрузить → данные на месте", async ({ page }) => {
  const name = `E2E Персона ${Date.now()}`;

  await page.goto("/login");
  await page.getByLabel("Рабочий email").fill(email!);
  await page.getByLabel("Пароль").fill(password!);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/overview/);

  await page.getByRole("navigation", { name: "Основная навигация" }).getByRole("link", { name: "Личности" }).click();
  await page.getByRole("button", { name: "Создать личность" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Имя вымышленной персоны").fill(name);
  await dialog.getByLabel("Краткий контекст").fill("Сквозной e2e-сценарий");
  await dialog.getByRole("button", { name: "Создать черновик" }).click();

  await expect(page).toHaveURL(/\/personas\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  await page.getByLabel("Род занятий", { exact: true }).fill("Библиотекарь");
  await page.getByLabel("Развёрнутое описание раздела").fill("Нарратив, сохранённый e2e-тестом.");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText(/^Сохранено/)).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Род занятий", { exact: true })).toHaveValue("Библиотекарь");
  await expect(page.getByLabel("Развёрнутое описание раздела")).toHaveValue("Нарратив, сохранённый e2e-тестом.");
  await expect(page.getByText(/rev 2/)).toBeVisible();

  // Активация заблокирована сервером без проверок
  await page.getByRole("button", { name: "Активировать" }).click();
  await expect(page.getByText(/Нет актуальной полной проверки согласованности/)).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Активировать" })).toBeDisabled();
});
