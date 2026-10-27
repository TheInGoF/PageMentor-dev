// Trainer-Code läuft abgeschirmt: iframe ohne gleiche Herkunft, ohne Netz, nur Nachrichten mit JSON
export interface TrainerStep {
  label?: string;
  warum?: string;
  body?: string;
  rechnung?: Array<{ tex: string; note?: string; ergebnis?: boolean }>;
  falle?: string;
  heft?: TrainerRef | TrainerRef[];
}

export interface TrainerRef {
  modul?: string;
  heft?: string;
  kap?: string;
  titel?: string;
  gl?: string;
  tex?: string;
  hinweis?: string;
}

export interface TrainerTask {
  title: string;
  prompt: string;
  steps: TrainerStep[];
}

export interface GeneratorInfo {
  id: string;
  name: string;
  topic: string;
  rezept?: string;
  klausur: string[];
}

const RUNNER = `
const send = (id, result, error) => parent.postMessage({ pm: "trainer", id, result, error }, "*");
addEventListener("message", (e) => {
  const { id, cmd, gen, klausur } = e.data || {};
  try {
    const list = window[__G] || [];
    if (cmd === "list") {
      const colors = (__C && window[__C]) || {};
      send(id, { colors, generators: list.map((g) => ({ id: g.id, name: g.name, topic: g.topic || "", rezept: g.rezept, klausur: (g.klausur || []).map((k) => k.quelle || "Klausur") })) });
    } else if (cmd === "task") {
      const g = list.find((x) => x.id === gen);
      if (!g) throw new Error("Generator fehlt: " + gen);
      const params = klausur != null && g.klausur ? g.klausur[klausur].params : undefined;
      const t = g.fn(params);
      send(id, JSON.parse(JSON.stringify({ title: t.title, prompt: t.prompt, steps: t.steps })));
    }
  } catch (err) { send(id, null, String(err && err.message || err)); }
});
parent.postMessage({ pm: "trainer", ready: true }, "*");
`;

export class TrainerHost {
  private frame: HTMLIFrameElement;
  private seq = 0;
  private waiting = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
  private ready: Promise<void>;
  private onMessage = (e: MessageEvent) => {
    if (e.source !== this.frame.contentWindow || e.data?.pm !== "trainer") return;
    if (e.data.ready) return this.markReady();
    const w = this.waiting.get(e.data.id);
    if (!w) return;
    this.waiting.delete(e.data.id);
    if (e.data.error) w.fail(new Error(e.data.error));
    else w.ok(e.data.result);
  };
  private markReady: () => void = () => {};

  constructor(source: string, globalName: string, colorsName: string | null) {
    this.ready = new Promise((ok) => (this.markReady = ok));
    window.addEventListener("message", this.onMessage);
    this.frame = document.createElement("iframe");
    this.frame.setAttribute("sandbox", "allow-scripts");
    this.frame.style.display = "none";
    const safe = (js: string) => js.replace(/<\/script/gi, "<\\/script");
    this.frame.srcdoc =
      `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'">` +
      `<script>${safe(source)}</script><script>const __G = ${JSON.stringify(globalName)}, __C = ${JSON.stringify(colorsName)};${RUNNER}</script>`;
    document.body.appendChild(this.frame);
  }

  private async call<T>(msg: Record<string, unknown>): Promise<T> {
    await Promise.race([this.ready, new Promise((_, no) => setTimeout(() => no(new Error("Trainer startet nicht")), 5000))]);
    const id = ++this.seq;
    return new Promise<T>((ok, fail) => {
      this.waiting.set(id, { ok, fail });
      this.frame.contentWindow?.postMessage({ ...msg, id }, "*");
      setTimeout(() => this.waiting.has(id) && (this.waiting.delete(id), fail(new Error("Trainer antwortet nicht"))), 5000);
    });
  }

  list() {
    return this.call<{ colors: Record<string, string>; generators: GeneratorInfo[] }>({ cmd: "list" });
  }

  task(gen: string, klausur?: number) {
    return this.call<TrainerTask>({ cmd: "task", gen, klausur: klausur ?? null });
  }

  dispose() {
    window.removeEventListener("message", this.onMessage);
    this.frame.remove();
  }
}
