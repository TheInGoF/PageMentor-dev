import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
// KaTeX-Styles global für Formeln
import "katex/dist/katex.min.css";
import { App } from "./App";
import { installGlobalErrorHandlers } from "./lib/reportError";
import { initTheme } from "./lib/theme";
import { initDesktop } from "./lib/desktop";

installGlobalErrorHandlers();
initTheme();
initDesktop();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
