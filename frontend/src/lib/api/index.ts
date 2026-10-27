export * from "./types";
export { ApiError } from "./request";
export { subscribeProgress } from "./progress";
import { libraryApi } from "./library";
import { learningApi } from "./learning";
import { settingsApi } from "./settings";
import { voicesApi } from "./voices";
import { audioApi } from "./audio";

export const api = {
  ...libraryApi,
  ...learningApi,
  ...settingsApi,
  ...voicesApi,
  ...audioApi,
};
