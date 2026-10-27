// Geheimnisse aus Log-Text entfernen

const secrets = new Set<string>();

// Bekannte Werte merken, z. B. API-Keys aus den Einstellungen
export function registerSecret(value: string | null | undefined): void {
  if (value && value.trim().length >= 6) secrets.add(value.trim());
}

export function registerEnvSecrets(): void {
  for (const k of [
    "PM_PASSWORD",
    "PM_DOCLING_API_KEY",
    "PM_QWEN_TTS_API_KEY",
    "PM_ANTHROPIC_API_KEY",
    "PM_OPENAI_API_KEY",
    "PM_GOOGLE_API_KEY",
    "PM_DOCKER_LOG_BRIDGE_TOKEN",
    "HF_TOKEN",
  ]) {
    registerSecret(process.env[k]);
  }
}

const PATTERNS: Array<[RegExp, string]> = [
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1***"],
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{10,}/g, "***"],
  [/\bhf_[A-Za-z0-9]{10,}/g, "***"],
  [/\bAIza[A-Za-z0-9_-]{20,}/g, "***"],
  [
    /((?:api[_-]?key|apikey|token|password|passwort|secret)["']?\s*[:=]\s*["']?)[^"'\s&,}]{4,}/gi,
    "$1***",
  ],
];

export function redact(text: string): string {
  let out = text;
  for (const s of secrets) {
    if (out.includes(s)) out = out.split(s).join("***");
  }
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}
