// Ist Cloud-Hilfe eingeschaltet und ein Schlüssel da? Einmal laden, überall nutzen
import { useEffect, useState } from "react";
import { api } from "./api";

let cached: Promise<boolean> | null = null;

export function refreshCloud(): void {
  cached = null;
}

export function useCloudReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    cached ??= api.cloud
      .status()
      .then((s) => s.enabled && s.targets.length > 0)
      .catch(() => false);
    void cached.then(setReady);
  }, []);
  return ready;
}
