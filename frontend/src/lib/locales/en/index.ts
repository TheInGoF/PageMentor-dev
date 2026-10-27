import { settings } from "./settings";
import { audiobook } from "./audiobook";
import { learning } from "./learning";
import { library } from "./library";
import { common } from "./common";

export const en: Record<string, string> = {
  ...settings,
  ...audiobook,
  ...learning,
  ...library,
  ...common,
};
