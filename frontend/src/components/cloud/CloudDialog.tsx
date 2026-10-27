// Vor jedem Versand: zeigen, was genau an welche Cloud-KI geht; erst „Senden“ schickt es los
import { useEffect, useState } from "react";
import { api, type CloudPreview, type CloudResult, type CloudTask } from "../../lib/api";
import { renderMarkdown } from "../../lib/markdown";
import { t } from "../../lib/i18n";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";

export function CloudDialog({
  task,
  params,
  onClose,
  onDone,
  onApplied,
}: {
  task: CloudTask | null;
  params: Record<string, unknown>;
  onClose: () => void;
  onDone?: (r: CloudResult) => void;
  // Lektorat übernommen: Liste neu laden
  onApplied?: () => void;
}) {
  const [preview, setPreview] = useState<CloudPreview | null>(null);
  const [result, setResult] = useState<CloudResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPreview(null);
    setResult(null);
    setError(null);
    if (task) api.cloud.preview(task, params).then(setPreview, (e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  async function send() {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await api.cloud.send(preview.id);
      setResult(r);
      onDone?.(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!task}
      onClose={onClose}
      title={preview?.title ?? t("cloud.title")}
      footer={
        result ? (
          <>
            <Button variant={result.parsed?.korrigiert_md ? "ghost" : "primary"} onClick={onClose}>
              {t("common.close")}
            </Button>
            {result.task === "lektorat" && result.ref && result.parsed?.korrigiert_md && (
              <Button
                onClick={async () => {
                  await api.cloud.applyLektorat(result.ref!, result.parsed!.korrigiert_md!);
                  onApplied?.();
                  onClose();
                }}
              >
                {t("cloud.apply")}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button onClick={send} disabled={!preview || busy}>
              {busy ? t("cloud.sending") : t("cloud.send", { provider: preview?.provider === "openai" ? "OpenAI" : "Claude" })}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {error && <div className="rounded-md bg-red-500/10 text-red-600 px-3 py-2">{error}</div>}
        {preview && !result && (
          <>
            <div className="rounded-md bg-amber-500/10 px-3 py-2">
              {t("cloud.consent", { provider: preview.provider === "openai" ? "OpenAI" : "Anthropic", model: preview.model, chars: preview.chars.toLocaleString() })}
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-neutral-500">{t("cloud.instructions")}</summary>
              <pre className="mt-1 text-xs whitespace-pre-wrap max-h-40 overflow-y-auto bg-bg-elevated rounded-md p-2">{preview.system}</pre>
            </details>
            <div className="text-xs text-neutral-500">{t("cloud.payload")}</div>
            <pre className="text-xs whitespace-pre-wrap max-h-72 overflow-y-auto bg-bg-elevated rounded-md p-2">{preview.text}</pre>
          </>
        )}
        {result && (
          <div className="flex flex-col gap-2">
            {result.task === "rezepte" && <div className="text-green-600">{t("cloud.recipesApplied", { n: result.applied ?? 0 })}</div>}
            {result.task === "lektorat" && result.parsed?.korrigiert_md ? (
              <>
                <div className="card p-3 flex flex-col gap-2">{renderMarkdown(result.parsed.korrigiert_md)}</div>
                {result.parsed.hinweise?.length ? (
                  <ul className="list-disc pl-5 text-xs text-neutral-500">
                    {result.parsed.hinweise.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <div className="flex flex-col gap-2">{renderMarkdown(result.answer)}</div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
