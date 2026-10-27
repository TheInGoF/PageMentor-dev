// Audio-API: Stimmen, Kapitel, Intro, Hörbuch, Dateien
import { Hono } from "hono";
import { voiceRoutes } from "./audio/voices";
import { chapterRoutes } from "./audio/chapters";
import { introRoutes } from "./audio/intro";
import { bookRoutes } from "./audio/book";
import { fileRoutes } from "./audio/files";
import { compareRoutes } from "./audio/compare";

export const audioRoutes = new Hono();
audioRoutes.route("/", voiceRoutes);
audioRoutes.route("/", chapterRoutes);
audioRoutes.route("/", introRoutes);
audioRoutes.route("/", bookRoutes);
audioRoutes.route("/", fileRoutes);
audioRoutes.route("/", compareRoutes);
