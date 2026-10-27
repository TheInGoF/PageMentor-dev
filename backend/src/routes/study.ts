// Studium: Leistungen, Fortschritt, Lernzeit, Material, Studiengang
import { Hono, type Context } from "hono";
import {
  createAssessment,
  deleteAssessment,
  listAssessments,
  scheduleRetry,
  StudyInputError,
  updateAssessment,
} from "../study/assessments";
import { profileValue, setProfileValue, studyProgress } from "../study/progress";
import { addTime, deleteTime, listTime, minutesPerDay, minutesPerModule } from "../study/time";
import { getMaterial, listMaterial, materialCounts, setUncertain, uncertainItems, type MaterialKind } from "../study/material";

export const studyRoutes = new Hono();

// Eingabefehler als 400, alles andere geht an den globalen Fehler-Handler
async function guard(c: Context, fn: () => unknown | Promise<unknown>) {
  try {
    return c.json(await fn());
  } catch (err) {
    if (err instanceof StudyInputError) return c.json({ error: err.message }, 400);
    throw err;
  }
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

studyRoutes.get("/progress", (c) => c.json(studyProgress()));

studyRoutes.get("/assessments", (c) => c.json({ assessments: listAssessments(c.req.query("module") || undefined) }));
studyRoutes.post("/assessments", (c) => guard(c, async () => createAssessment(await c.req.json())));
studyRoutes.patch("/assessments/:id", (c) => guard(c, async () => updateAssessment(c.req.param("id"), await c.req.json())));
studyRoutes.delete("/assessments/:id", (c) => c.json({ deleted: deleteAssessment(c.req.param("id")) }));
studyRoutes.post("/assessments/:id/retry", (c) => guard(c, () => scheduleRetry(c.req.param("id"))));

studyRoutes.get("/time", (c) => {
  const to = c.req.query("to") || isoDay(new Date());
  const from = c.req.query("from") || isoDay(new Date(Date.now() - 365 * 86_400_000));
  return c.json({ entries: listTime(from, to, c.req.query("module") || undefined), perDay: minutesPerDay(from, to), perModule: minutesPerModule(from, to) });
});
studyRoutes.post("/time", (c) => guard(c, async () => addTime(await c.req.json())));
studyRoutes.delete("/time/:id", (c) => c.json({ deleted: deleteTime(c.req.param("id")) }));

studyRoutes.get("/material/review", (c) => c.json({ items: uncertainItems() }));
studyRoutes.get("/material/item/:id", (c) => {
  const item = getMaterial(c.req.param("id"));
  return item ? c.json(item) : c.json({ error: "nicht gefunden" }, 404);
});
studyRoutes.patch("/material/item/:id", async (c) => {
  const body = (await c.req.json()) as { uncertain?: boolean };
  return c.json({ updated: setUncertain(c.req.param("id"), !!body.uncertain) });
});
studyRoutes.get("/material/:moduleId", (c) => {
  const kind = c.req.query("kind") as MaterialKind | undefined;
  const id = c.req.param("moduleId");
  return c.json({ items: listMaterial(id, kind), counts: materialCounts(id) });
});

const PROFILE_KEYS = ["program", "regulation", "total_cp", "export_dir"] as const;
studyRoutes.get("/profile", (c) => c.json(Object.fromEntries(PROFILE_KEYS.map((k) => [k, profileValue(k)]))));
studyRoutes.patch("/profile", async (c) => {
  const body = (await c.req.json()) as Record<string, string | null>;
  for (const k of PROFILE_KEYS) if (k in body) setProfileValue(k, body[k] === "" ? null : body[k]);
  return c.json(Object.fromEntries(PROFILE_KEYS.map((k) => [k, profileValue(k)])));
});
