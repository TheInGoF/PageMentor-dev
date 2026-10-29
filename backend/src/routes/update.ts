// Update aus der App
import { Hono } from "hono";
import { checkUpdate, installUpdate, updateState } from "../services/update";
import { quitApp } from "../launch";

export const updateRoutes = new Hono();

updateRoutes.get("/", async (c) => c.json(await checkUpdate(c.req.query("force") === "1")));
updateRoutes.get("/progress", (c) => c.json(updateState()));
updateRoutes.post("/install", async (c) => {
  try {
    void installUpdate(() => quitApp("Update"));
    return c.json(updateState());
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});
