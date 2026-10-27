/**
 * Tutor — module-scoped chat over the user's learning materials.
 *
 * The user picks a module (or "all modules") when starting a session,
 * pastes a question, and the backend RAGs over the chunks of the
 * relevant documents. The assistant answers in three sections
 * (Kurzlösung / Lösungsweg / Quellen) with page-level citations. Each
 * source pill opens the source PDF at the right page in a new tab so
 * the chat stays visible.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { TopBar } from "./TopBar";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import {
  api,
  type ModuleListItem,
  type TutorSession,
  type TutorMessage,
  type TutorAnswer,
  type TutorSource,
} from "../lib/api";
import { t } from "../lib/i18n";
import { cn } from "../lib/cn";
import { renderMarkdown } from "../lib/markdown";

interface Props {
  onGoDashboard: () => void;
  onGoLibrary: () => void;
  onGoModules: () => void;
  onOpenSettings: () => void;
  /** SearchOverlay in the TopBar uses this to navigate to a learning
   *  menu when the user picks a document from the full-text search. */
  onOpenDocument: (docId: string) => void;
  /** Open the source document at a specific page in a new browser
   *  tab — keeps the chat visible while the user reads. */
  onOpenDocumentSource: (docId: string, page: number) => void;
}

export function TutorPage(props: Props) {
  const [modules, setModules] = useState<ModuleListItem[]>([]);
  const [sessions, setSessions] = useState<TutorSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [pendingModuleId, setPendingModuleId] = useState<string>("");
  const toast = useToast();
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load module list + sessions on mount.
  useEffect(() => {
    api.modules
      .list()
      .then(setModules)
      .catch(() => setModules([]));
    refreshSessions();
  }, []);

  function refreshSessions() {
    api.tutor
      .listSessions()
      .then((r) => setSessions(r.sessions))
      .catch(() => {});
  }

  // When activeId changes, fetch its messages.
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    api.tutor
      .getSession(activeId)
      .then((r) => setMessages(r.messages))
      .catch(() => setMessages([]));
  }, [activeId]);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // No explicit "new session" function — handleAsk lazily creates one
  // when the user sends the first message of a fresh chat, using the
  // currently selected module. Avoids two side-by-side code paths for
  // "create then send" vs "send".

  async function handleAsk(e: FormEvent) {
    e.preventDefault();
    const q = draft.trim();
    if (!q) return;

    // If no active session, create one (with currently selected
    // module) and use it immediately.
    let sessionId = activeId;
    if (!sessionId) {
      try {
        const r = await api.tutor.createSession(pendingModuleId || null);
        setSessions((cur) => [r.session, ...cur]);
        sessionId = r.session.id;
        setActiveId(sessionId);
      } catch (err) {
        toast.show((err as Error).message, "error");
        return;
      }
    }

    setBusy(true);
    // Optimistic: append the user message so the user sees feedback
    // while the LLM thinks (could be 30+ s on large contexts).
    const tempUserMsg: TutorMessage = {
      id: `temp-${Date.now()}`,
      session_id: sessionId,
      role: "user",
      content: q,
      created_at: new Date().toISOString(),
    };
    setMessages((cur) => [...cur, tempUserMsg]);
    setDraft("");

    try {
      await api.tutor.ask(sessionId, q);
      // Reload from server — replaces the temp message with the
      // canonical row and adds the assistant response.
      const fresh = await api.tutor.getSession(sessionId);
      setMessages(fresh.messages);
      refreshSessions();
    } catch (err) {
      toast.show((err as Error).message, "error");
      // Roll back the optimistic user message.
      setMessages((cur) => cur.filter((m) => m.id !== tempUserMsg.id));
      setDraft(q);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSession(id: string) {
    if (!confirm(t("tutor.confirmDelete"))) return;
    try {
      await api.tutor.remove(id);
      setSessions((cur) => cur.filter((s) => s.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
    } catch (err) {
      toast.show((err as Error).message, "error");
    }
  }

  const activeSession = activeId
    ? sessions.find((s) => s.id === activeId) ?? null
    : null;
  const activeModuleId = activeSession?.module_id ?? null;
  const activeModule = activeModuleId
    ? modules.find((m) => m.id === activeModuleId)
    : null;

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar
        currentView="tutor"
        onGoDashboard={props.onGoDashboard}
        onGoLibrary={props.onGoLibrary}
        onGoModules={props.onGoModules}
        onGoTutor={() => {}}
        onOpenSettings={props.onOpenSettings}
        onOpenDocument={props.onOpenDocument}
      />
      <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-4 grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 min-h-0">
        {/* Session list */}
        <aside className="bg-neutral-950 border border-border rounded-lg p-3 flex flex-col gap-2 min-h-0">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t("tutor.sessions")}</h2>
            <Button
              variant="ghost"
              onClick={() => {
                setActiveId(null);
                setMessages([]);
              }}
              className="!px-2 !py-1 text-xs"
            >
              + {t("tutor.newChat")}
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto flex flex-col gap-1">
            {sessions.length === 0 && (
              <p className="text-xs text-neutral-500 italic px-2 py-3">
                {t("tutor.noSessions")}
              </p>
            )}
            {sessions.map((s) => {
              const mod = s.module_id
                ? modules.find((m) => m.id === s.module_id)
                : null;
              return (
                <div
                  key={s.id}
                  className={cn(
                    "group flex items-center gap-1 rounded px-2 py-1.5 cursor-pointer hover:bg-neutral-900",
                    activeId === s.id && "bg-neutral-900"
                  )}
                  onClick={() => setActiveId(s.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">
                      {s.title || t("tutor.untitled")}
                    </div>
                    <div className="text-xs text-neutral-500 truncate">
                      {mod
                        ? `${mod.icon ?? ""} ${mod.name}`.trim()
                        : t("tutor.allModules")}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSession(s.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-xs text-neutral-500 hover:text-accent"
                    aria-label={t("tutor.delete")}
                    title={t("tutor.delete")}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Chat panel */}
        <section className="flex flex-col gap-3 min-h-0">
          {/* Module selector — visible only when no session is active,
              otherwise we show the locked module label */}
          {!activeId && (
            <div className="bg-neutral-950 border border-border rounded-lg p-3 flex flex-col gap-2">
              <label className="text-xs font-medium text-neutral-400">
                {t("tutor.scopeModule")}
              </label>
              <select
                className="input"
                value={pendingModuleId}
                onChange={(e) => setPendingModuleId(e.target.value)}
              >
                <option value="">{t("tutor.allModules")}</option>
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.icon ? `${m.icon} ${m.name}` : m.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-neutral-500">
                {t("tutor.scopeHint")}
              </p>
            </div>
          )}

          {activeSession && (
            <div className="bg-neutral-950 border border-border rounded-lg px-3 py-2 text-xs text-neutral-400 flex items-center justify-between">
              <span>
                {t("tutor.scopeLabel")}{" "}
                <strong className="text-neutral-200">
                  {activeModule
                    ? `${activeModule.icon ?? ""} ${activeModule.name}`.trim()
                    : t("tutor.allModules")}
                </strong>
              </span>
              <Button
                variant="ghost"
                onClick={() => {
                  setActiveId(null);
                  setMessages([]);
                }}
                className="!px-2 !py-0 text-xs"
              >
                + {t("tutor.newChat")}
              </Button>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto bg-neutral-950 border border-border rounded-lg p-4 flex flex-col gap-3">
            {messages.length === 0 && (
              <div className="text-center text-neutral-500 italic py-8">
                {t("tutor.emptyHint")}
              </div>
            )}
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                msg={m}
                onOpenSource={props.onOpenDocumentSource}
              />
            ))}
            {busy && (
              <div className="text-xs text-neutral-500 italic">
                {t("tutor.thinking")}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={handleAsk} className="flex gap-2">
            <textarea
              className="input flex-1 min-h-[60px] max-h-40 resize-y"
              placeholder={t("tutor.askPlaceholder")}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  void handleAsk(e as unknown as FormEvent);
                }
              }}
              disabled={busy}
            />
            <Button
              variant="primary"
              disabled={busy || !draft.trim()}
              onClick={handleAsk as never}
            >
              {busy ? t("tutor.sending") : t("tutor.send")}
            </Button>
          </form>
          <p className="text-xs text-neutral-500">{t("tutor.sendHint")}</p>
        </section>
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  onOpenSource,
}: {
  msg: TutorMessage;
  onOpenSource: (docId: string, page: number) => void;
}) {
  if (msg.role === "user") {
    return (
      <div className="self-end max-w-[85%] bg-neutral-800 border border-border-strong rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
        {msg.content}
      </div>
    );
  }
  // Assistant — try to parse the JSON wrapper.
  const answer = parseAnswer(msg.content);
  if (!answer) {
    return (
      <div className="self-start max-w-[95%] bg-neutral-900 border border-border rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
        {msg.content}
      </div>
    );
  }
  return (
    <div className="self-start max-w-[95%] bg-neutral-900 border border-border rounded-lg px-4 py-3 flex flex-col gap-3">
      <section>
        <h3 className="text-xs font-semibold text-accent uppercase tracking-wide mb-1">
          {t("tutor.section.shortAnswer")}
        </h3>
        <div className="text-sm">{renderMarkdown(answer.shortAnswer)}</div>
      </section>
      {answer.reasoning && (
        <section>
          <h3 className="text-xs font-semibold text-accent uppercase tracking-wide mb-1">
            {t("tutor.section.reasoning")}
          </h3>
          <div className="text-sm">{renderMarkdown(answer.reasoning)}</div>
        </section>
      )}
      {answer.sources.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-accent uppercase tracking-wide mb-1">
            {t("tutor.section.sources")}
          </h3>
          <div className="flex flex-col gap-1">
            {answer.sources.map((s) => (
              <SourcePill
                key={s.n}
                source={s}
                onOpen={() => onOpenSource(s.docId, s.startPage)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SourcePill({
  source,
  onOpen,
}: {
  source: TutorSource;
  onOpen: () => void;
}) {
  const heft = source.docShortCode
    ? `${source.docTitle} (${source.docShortCode})`
    : source.docTitle;
  const kapitel = source.chapterNumber
    ? `Kap. ${source.chapterNumber}${
        source.chapterTitle ? ` „${source.chapterTitle}"` : ""
      }`
    : null;
  const pages =
    source.startPage === source.endPage
      ? `S. ${source.startPage}`
      : `S. ${source.startPage}–${source.endPage}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left text-xs bg-neutral-800 hover:bg-neutral-700 border border-border rounded px-2 py-1.5"
      title={t("tutor.openSource")}
    >
      <span className="font-semibold text-accent">[{source.n}]</span>{" "}
      <span className="text-neutral-200">{heft}</span>
      {kapitel && <span className="text-neutral-400"> — {kapitel}</span>}
      <span className="text-neutral-400">, {pages}</span>
    </button>
  );
}

function parseAnswer(content: string): TutorAnswer | null {
  try {
    const v = JSON.parse(content) as Partial<TutorAnswer>;
    if (typeof v.shortAnswer !== "string") return null;
    return {
      shortAnswer: v.shortAnswer,
      reasoning: typeof v.reasoning === "string" ? v.reasoning : "",
      sources: Array.isArray(v.sources) ? v.sources : [],
      model: typeof v.model === "string" ? v.model : "",
    };
  } catch {
    return null;
  }
}
