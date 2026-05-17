import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
// KaTeX stylesheet — loaded once globally so the math fragments
// rendered inside Cards / Tutor / CardReview display correctly.
import "katex/dist/katex.min.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
