import type { Config } from "tailwindcss";

// Farbe aus Token, Deckkraft über Tailwind-Modifikator
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const neutral = Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => [n, v(`n-${n}`)])
);

// Status-Farben: Textstufen aus Tokens, Flächen bleiben fest
const status = (token: string, fixed: Record<number, string>) => ({
  ...fixed,
  200: v(`${token}-300`),
  300: v(`${token}-300`),
  400: v(`${token}-400`),
});

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    // Drei Schriftgrößen plus eine große Zahl
    fontSize: {
      xs: ["13px", "18px"],
      sm: ["15px", "22px"],
      base: ["15px", "22px"],
      lg: ["20px", "26px"],
      xl: ["20px", "26px"],
      "2xl": ["20px", "26px"],
      "3xl": ["34px", "40px"],
      "4xl": ["34px", "40px"],
    },
    // Ein Radius für Karten und Felder, rund für Chips
    borderRadius: {
      none: "0",
      sm: "8px",
      DEFAULT: "8px",
      md: "12px",
      lg: "12px",
      xl: "16px",
      "2xl": "16px",
      full: "9999px",
    },
    extend: {
      colors: {
        black: v("bg"),
        neutral,
        bg: {
          DEFAULT: v("bg"),
          elevated: v("elevated"),
          card: v("card"),
          hover: v("hover"),
        },
        border: {
          DEFAULT: v("border"),
          strong: v("border-strong"),
        },
        "on-accent": v("on-accent"),
        accent: {
          DEFAULT: v("accent"),
          hover: v("accent-hover"),
          subtle: v("accent-subtle"),
        },
        emerald: status("ok", { 500: "#10b981", 600: "#059669", 700: "#047857" }),
        green: status("ok", { 500: "#22c55e", 600: "#16a34a", 700: "#15803d" }),
        amber: status("warn", { 500: "#f59e0b", 600: "#d97706", 700: "#b45309" }),
        yellow: status("warn", { 500: "#eab308", 600: "#ca8a04", 700: "#a16207" }),
        red: status("err", { 500: "#ef4444", 600: "#dc2626", 700: "#b91c1c" }),
        sky: status("info", { 500: "#0ea5e9", 600: "#0284c7", 700: "#0369a1" }),
        blue: status("info", { 500: "#3b82f6", 600: "#2563eb", 700: "#1d4ed8" }),
        fuchsia: status("pink", { 500: "#d946ef", 600: "#c026d3", 700: "#a21caf" }),
        purple: status("pink", { 500: "#a855f7", 600: "#9333ea", 700: "#7e22ce" }),
        violet: status("pink", { 500: "#8b5cf6", 600: "#7c3aed", 700: "#6d28d9" }),
      },
      fontFamily: {
        sans: ["Segoe UI Variable", "Segoe UI", "system-ui", "-apple-system", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
      boxShadow: {
        card: "var(--shadow)",
      },
    },
  },
  plugins: [],
} satisfies Config;
