import type { Config } from "tailwindcss";

// Все цвета — через CSS custom properties (src/styles/tokens.css). Никаких россыпей hex.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: v("canvas"),
        surface: v("surface"),
        elevated: v("elevated"),
        line: v("line"),
        "line-strong": v("line-strong"),
        fg: v("fg"),
        "fg-soft": v("fg-soft"),
        muted: v("muted"),
        accent: v("accent"),
        garnet: v("garnet"),
        success: v("success"),
        warning: v("warning"),
        danger: v("danger"),
        info: v("info"),
      },
      fontFamily: {
        sans: ["Manrope", "system-ui", "Segoe UI", "Arial", "sans-serif"],
        mono: ["'Geist Mono'", "ui-monospace", "Consolas", "monospace"],
      },
      borderRadius: { ui: "12px", card: "16px", hero: "28px" },
      maxWidth: { shell: "1520px" },
    },
  },
  plugins: [],
} satisfies Config;
