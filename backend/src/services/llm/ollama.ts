// Ollama: Erreichbarkeit, Modelle, Pull

export async function pingOllama(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Vorhandene Modelle eines Ollama-Servers
async function ollamaTags(url: string): Promise<string[]> {
  try {
    const res = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

// Embedding-Modelle nie als Textmodell wählen: Ollama antwortet 400
const EMBEDDING_MODEL_PATTERNS = [
  /(^|[\/_-])embed/i,        // nomic-embed-text, mxbai-embed-large, …
  /(^|[\/_-])minilm/i,       // all-minilm
  /^bge[-_]/i,               // bge-* family
];

export function isEmbeddingModel(name: string): boolean {
  return EMBEDDING_MODEL_PATTERNS.some((re) => re.test(name));
}

// Modellname für einen Ollama-Aufruf
// - gewünscht und vorhanden: nehmen
// - gewünscht, fehlt: /api/pull versuchen, sonst klarer Fehler
// - nichts gewünscht: erstes Nicht-Embedding-Modell
// Nie still auf ein anderes Modell ausweichen
export async function resolveOllamaModel(
  url: string,
  requested: string | undefined
): Promise<string> {
  const available = await ollamaTags(url);
  if (requested && available.includes(requested)) {
    console.log(`[llm] using requested model "${requested}" (matched in /api/tags at ${url})`);
    return requested;
  }

  if (requested) {
    // Pull versuchen, bis zu 5 min
    console.log(
      `[llm] requested model "${requested}" not in Ollama /api/tags at ${url}; ` +
        `attempting /api/pull (one-time, may take minutes)`
    );
    const pulled = await tryPullOllamaModel(url, requested);
    if (pulled) {
      console.log(`[llm] pull of "${requested}" succeeded`);
      return requested;
    }
    // Harter Fehler statt heimlich ein anderes Modell
    const generative = available.filter((n) => !isEmbeddingModel(n));
    throw new Error(
      `Requested Ollama model "${requested}" is not available at ${url} ` +
        `and /api/pull failed. Models present: [${generative.join(", ") || "(none)"}]. ` +
        `Either pull the model manually (\`ollama pull ${requested}\`) or pick a different ` +
        `Default Ollama Model in Settings.`
    );
  }

  // Kein Modell gewünscht: laut loggen, erstes Textmodell nehmen
  const generative = available.filter((n) => !isEmbeddingModel(n));
  if (generative.length > 0) {
    console.warn(
      `[llm] no model pinned (Settings → Default Ollama Model is empty), ` +
        `auto-picked "${generative[0]}" from /api/tags at ${url}. ` +
        `Available generative models: [${generative.join(", ")}]. ` +
        `Set the field to suppress this warning.`
    );
    return generative[0];
  }

  console.warn(
    `[llm] no generative models found at ${url}; falling back to "llama3.2:3b"`
  );
  return "llama3.2:3b";
}

async function tryPullOllamaModel(url: string, name: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: name, stream: false }),
      // 5 min Timeout, große Modelle von Hand laden
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
    return res.ok;
  } catch (err) {
    console.warn(`[llm] /api/pull for "${name}" failed:`, err);
    return false;
  }
}
