// Übungszeit automatisch als Lernzeit buchen: zählt nur, solange die Seite sichtbar ist
import { useEffect, useRef } from "react";
import { api } from "./api";

export function useStudyTimer(moduleId: string | null, kind: "trainer" | "karten" | "lernen", active: boolean) {
  const seconds = useRef(0);
  useEffect(() => {
    if (!active) return;
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") seconds.current += 5;
    }, 5000);
    return () => {
      clearInterval(tick);
      const minutes = Math.round(seconds.current / 60);
      seconds.current = 0;
      if (minutes >= 1) {
        void api.study
          .addTime({ date: new Date().toISOString().slice(0, 10), module_id: moduleId, kind, minutes, origin: "auto" })
          .catch(() => undefined);
      }
    };
  }, [moduleId, kind, active]);
}
