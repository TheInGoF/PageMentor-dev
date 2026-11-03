// „Stück 7 und 8 von 12 · 2 gleichzeitig“ bzw. „Stück 7 bis 9 von 12 · 3 gleichzeitig“ beim Qwen-Batching
import { t } from "./i18n";

export function partsBatchLabel(from: number, n: number, total: number): string {
  const to = from + n - 1;
  const list = n === 2 ? `${from} ${t("parts.and")} ${to}` : `${from} ${t("parts.to")} ${to}`;
  return t("parts.batch", { list, total, n });
}
