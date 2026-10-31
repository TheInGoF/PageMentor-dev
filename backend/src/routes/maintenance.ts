// Wissenspflege: Stand (Countdown, Lauf, Ruhe), jetzt starten, abbrechen
import { Hono } from "hono";
import { cancelMaintenance, maintenanceState, startNow } from "../services/maintenance";

export const maintenanceRoutes = new Hono();

maintenanceRoutes.get("/", (c) => c.json(maintenanceState()));
maintenanceRoutes.post("/start", async (c) => c.json(await startNow()));
maintenanceRoutes.post("/cancel", (c) => c.json(cancelMaintenance()));
