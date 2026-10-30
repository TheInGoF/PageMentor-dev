// Einstellungen: Übersicht aus Kacheln, darunter höchstens eine Ebene
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Button } from "./ui/Button";
import { LogsContent } from "./LogsPage";
import { EnginePanel } from "./engine/EnginePanel";
import { setSettings } from "../lib/settings";
import { t, useLocale } from "../lib/i18n";
import { useSettingsCore } from "./settings/useSettingsCore";
import { useVoiceManager } from "./settings/useVoiceManager";
import { usePresetTester } from "./settings/usePresetTester";
import type { SettingsTab } from "./settings/types";
import { AppearanceSection } from "./settings/AppearanceSection";
import { GeneralSection } from "./settings/GeneralSection";
import { StudyImportSection } from "./settings/StudyImportSection";
import { UpdateSection } from "./settings/UpdateSection";
import { AudiobookSection } from "./settings/AudiobookSection";
import { AiExpert, AiSection } from "./settings/AiSection";
import { PromptsSection } from "./settings/PromptsSection";
import { PronunciationSection } from "./settings/PronunciationSection";
import { LanguagesSection } from "./settings/LanguagesSection";
import { KnowledgeEval, KnowledgeSection } from "./settings/KnowledgeSection";
import { DoclingSection } from "./settings/DoclingSection";
import { CloudSection } from "./settings/CloudSection";
import { TtsSection } from "./settings/TtsSection";
import { VoiceSamplesSection } from "./settings/VoiceSamplesSection";
import { VoiceEditModals } from "./settings/VoiceEditModals";

export type { SettingsTab } from "./settings/types";

interface Props {
  // Zurück zur vorigen Ansicht, entscheidet App.tsx
  onBack: () => void;
  // Direkt eine Kachel öffnen, z. B. Engine aus dem Hinweisbalken
  initialTab?: SettingsTab;
}

const TILES: Array<{ id: Exclude<SettingsTab, "home">; icon: string }> = [
  { id: "ai", icon: "✦" },
  { id: "voices", icon: "♪" },
  { id: "engine", icon: "⚙" },
  { id: "general", icon: "☼" },
  { id: "diagnose", icon: "⌁" },
];

export function SettingsPage({ onBack, initialTab }: Props) {
  useLocale();
  const core = useSettingsCore(initialTab);
  const voices = useVoiceManager(core);
  const tester = usePresetTester(core);
  const st = { ...core, ...voices, ...tester };
  const { s, tab, setTab, llmConfig, savedLlmConfigRef, saveLlmConfig } = core;
  // Gewählte Zusatz-Engines: Qwen-Teile nur mit Qwen, eigene Stimmen nur mit einer klonenden Engine
  const [ttsEngines, setTtsEngines] = useState<string[] | null>(null);
  useEffect(() => {
    if (tab !== "voices") return;
    api.engine.ttsEngines().then((i) => setTtsEngines(i.enabled)).catch(() => setTtsEngines(null));
  }, [tab]);
  const qwenOn = !!ttsEngines?.includes("qwen");
  const cloneOn = !ttsEngines || ttsEngines.some((e) => e === "qwen" || e === "f5" || e === "tada");

  // Lokale Werte sofort speichern
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSettings(s);
  }, [s]);

  // Server-Einstellungen und Schlüssel kurz nach der letzten Änderung speichern
  const keys = [core.anthropicKeyInput, core.openaiKeyInput, core.googleKeyInput, core.qwenTtsKeyInput, core.absKeyInput];
  useEffect(() => {
    const dirty = savedLlmConfigRef.current !== null && JSON.stringify(llmConfig) !== savedLlmConfigRef.current;
    if (!dirty && !keys.some((k) => k.trim())) return;
    const timer = setTimeout(() => void saveLlmConfig(), 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llmConfig, ...keys]);

  async function back() {
    if (tab !== "home" && !initialTab) {
      setTab("home");
      return;
    }
    await core.save();
    onBack();
  }

  return (
    <div className="min-h-full bg-bg flex flex-col">
      <header className="sticky top-0 z-30 bg-bg/90 backdrop-blur border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-3">
          <Button variant="ghost" onClick={back} aria-label={t("common.back")}>
            ← {tab === "home" || initialTab ? t("common.back") : t("settings.title")}
          </Button>
          <h1 className="text-lg font-semibold flex-1 truncate">
            {tab === "home" ? t("settings.title") : t(`settings.tile.${tab}`)}
          </h1>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-6 flex flex-col gap-6">
          {tab === "home" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {TILES.map((tile) => (
                <button
                  key={tile.id}
                  type="button"
                  onClick={() => setTab(tile.id)}
                  className="card card-hover p-6 text-left flex flex-col gap-2"
                >
                  <span className="w-10 h-10 rounded-full bg-accent/15 text-accent flex items-center justify-center text-lg">
                    {tile.icon}
                  </span>
                  <span className="text-lg font-semibold">{t(`settings.tile.${tile.id}`)}</span>
                  <span className="text-xs text-neutral-500">{t(`settings.tile.${tile.id}.hint`)}</span>
                </button>
              ))}
            </div>
          )}

          {tab === "ai" && (
            <>
              <AiSection st={st} />
              <DoclingSection st={st} />
              <KnowledgeSection st={st} />
              <CloudSection />
              <AiExpert st={st} />
              <PromptsSection />
              <KnowledgeEval />
            </>
          )}
          {tab === "voices" && (
            <>
              <AudiobookSection st={st} />
              <VoiceSamplesSection st={st} qwenOn={qwenOn} cloneOn={cloneOn} onEngines={() => setTab("engine")} />
              <PronunciationSection />
              <LanguagesSection qwenOn={qwenOn} onEngines={() => setTab("engine")} />
              {qwenOn && <TtsSection st={st} />}
            </>
          )}
          {tab === "engine" && <EnginePanel />}
          {tab === "general" && (
            <>
              <UpdateSection />
              <AppearanceSection />
              <GeneralSection st={st} />
              <StudyImportSection />
            </>
          )}
          {tab === "diagnose" && <LogsContent />}
        </div>
      </main>

      <VoiceEditModals st={st} />
    </div>
  );
}
