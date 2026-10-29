// Engine-Status regelmäßig abfragen; schneller, solange etwas läuft
import { useCallback, useEffect, useState } from "react";
import { api, type EngineStatus } from "../../lib/api";

export function useEngineStatus(): { status: EngineStatus | null; reload: () => void } {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const reload = useCallback(() => {
    api.engine
      .status()
      .then(setStatus)
      .catch(() => {});
  }, []);
  // Nur am Wahrheitswert hängen: task ist bei jeder Antwort ein neues Objekt,
  // sonst startet der Effekt nach jeder Antwort neu und fragt sofort wieder
  const busy = !!(status?.task || status?.checking || status?.autoStart === "läuft");
  useEffect(() => {
    const iv = setInterval(reload, busy ? 2000 : 15000);
    return () => clearInterval(iv);
  }, [reload, busy]);
  useEffect(() => reload(), [reload]);
  return { status, reload };
}
