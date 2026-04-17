import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#000000",
          elevated: "#111111",
          card: "#161616",
          hover: "#1c1c1c",
        },
        border: {
          DEFAULT: "#262626",
          strong: "#333333",
        },
        accent: {
          DEFAULT: "#ef4444",
          hover: "#dc2626",
          subtle: "#7f1d1d",
        },
      },
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.6), 0 4px 12px rgba(0,0,0,0.4)",
      },
    },
  },
  plugins: [],
} satisfies Config;
