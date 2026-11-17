// Пересобрать PNG-фавиконы из apps/web/public/mark.svg (нужен установленный Edge).
// Запуск из apps/web:  node scripts/render-mark.mjs
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const [svgPath = "public/mark.svg", outDir = "public"] = process.argv.slice(2);
const svg = readFileSync(svgPath, "utf8");
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "msedge" });
const page = await browser.newPage();

// Рисуем через canvas: page.screenshot в headless Edge зависает на ожидании шрифтов.
const render = (size) =>
  page.evaluate(
    async ({ svg, size }) => {
      const img = new Image();
      img.src = "data:image/svg+xml;base64," + btoa(svg);
      await img.decode();
      const c = document.createElement("canvas");
      c.width = c.height = size;
      c.getContext("2d").drawImage(img, 0, 0, size, size);
      return c.toDataURL("image/png").split(",")[1];
    },
    { svg, size },
  );

for (const [size, name] of [
  [32, "favicon-32.png"],
  [180, "apple-touch-icon.png"],
]) {
  writeFileSync(`${outDir}/${name}`, Buffer.from(await render(size), "base64"));
}
await browser.close();
