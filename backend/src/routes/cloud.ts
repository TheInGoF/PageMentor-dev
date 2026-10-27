// Cloud-Hilfe: Schalter, Vorschau mit Zustimmung, Versand, Übernehmen der Ergebnisse
import { Hono } from "hono";
import { db } from "../db";
import { cloudEnabled, cloudTargets, type CloudProvider } from "../services/cloud/client";
import { cloudLog, preview, send } from "../services/cloud/consent";
import { listFailures } from "../services/cloud/failures";
import type { CloudTask } from "../services/cloud/tasks";
import { setProfileValue } from "../study/progress";
import { buildItems, parseJson, storeItems } from "../study/material/extract";

export const cloudRoutes = new Hono();

const fail = (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) });

cloudRoutes.get("/status", (c) => c.json({ enabled: cloudEnabled(), targets: cloudTargets(), log: cloudLog() }));
cloudRoutes.post("/enabled", async (c) => {
  const { enabled } = (await c.req.json()) as { enabled: boolean };
  setProfileValue("cloud_enabled", enabled ? "1" : null);
  return c.json({ enabled: cloudEnabled() });
});
cloudRoutes.get("/failures", (c) => c.json({ failures: listFailures() }));

cloudRoutes.post("/preview", async (c) => {
  const body = (await c.req.json()) as { task: CloudTask; provider?: CloudProvider; params?: Record<string, unknown> };
  try {
    return c.json(preview(body.task, body.provider, body.params ?? {}));
  } catch (err) {
    return c.json(fail(err), 400);
  }
});

// Senden nur mit der ID einer Vorschau: es geht genau der gezeigte Text raus
cloudRoutes.post("/send/:id", async (c) => {
  try {
    const r = await send(c.req.param("id"));
    if (r.task === "rezepte" && r.ref) {
      const data = parseJson(r.answer);
      const mod = db().prepare("SELECT code FROM modules WHERE id = ?").get(r.ref) as { code: string | null } | null;
      if (!data || !mod?.code) return c.json({ ...r, applied: 0, error: "Antwort ohne gültiges JSON" });
      const items = buildItems("rezept", [data], `${mod.code}-R`);
      storeItems("rezept", items, r.ref, null);
      return c.json({ ...r, applied: items.length });
    }
    if (r.task === "lektorat") return c.json({ ...r, parsed: parseJson(r.answer) });
    return c.json(r);
  } catch (err) {
    return c.json(fail(err), 400);
  }
});

// Lektorat übernehmen: Text ersetzen, als geprüft markieren
cloudRoutes.post("/lektorat/:itemId/apply", async (c) => {
  const { body_md } = (await c.req.json()) as { body_md?: string };
  if (!body_md?.trim()) return c.json({ error: "Text fehlt" }, 400);
  const r = db()
    .prepare("UPDATE material_items SET body_md = ?, uncertain = 0, checked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .run(body_md, c.req.param("itemId"));
  return c.json({ updated: r.changes > 0 });
});
