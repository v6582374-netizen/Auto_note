import type { ExtensionSettings } from "./types";

export const SETTINGS_STORAGE_KEY = "autonote_settings";

export const DEFAULT_SETTINGS: ExtensionSettings = {
  baseUrl: "https://api.openai.com",
  apiKey: "",
  model: "gpt-4.1-mini",
  supabaseUrl: "",
  supabaseAnonKey: "",
  authBridgeUrl: "https://bridge.autonote.app",
  cloudSyncEnabled: true,
  embeddingModel: "text-embedding-3-small",
  embeddingContentMode: "readability_only",
  embeddingMaxChars: 8_000,
  temperature: 0.2,
  maxChars: 50_000,
  preferReuseCategories: true,
  semanticSearchEnabled: true,
  searchFallbackMode: "local_hybrid",
  excludedUrlPatterns: [],
  rankingWeights: {
    semantic: 0.55,
    lexical: 0.25,
    taxonomy: 0.1,
    recency: 0.1
  },
  trashRetentionDays: 30
};

export async function getSettingsFromStorage(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(result[SETTINGS_STORAGE_KEY] ?? {})
  } as ExtensionSettings;
  return normalizeSettings(merged);
}

export async function saveSettingsToStorage(settings: ExtensionSettings): Promise<ExtensionSettings> {
  const normalized = normalizeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: normalized });
  return normalized;
}

function normalizeSettings(settings: ExtensionSettings): ExtensionSettings {
  return {
    ...settings,
    baseUrl: normalizeBaseUrl(settings.baseUrl),
    apiKey: (settings.apiKey ?? "").trim(),
    model: (settings.model ?? DEFAULT_SETTINGS.model).trim() || DEFAULT_SETTINGS.model,
    supabaseUrl: normalizeOptionalUrl(settings.supabaseUrl),
    supabaseAnonKey: (settings.supabaseAnonKey ?? "").trim(),
    authBridgeUrl: normalizeOptionalUrl(settings.authBridgeUrl) || DEFAULT_SETTINGS.authBridgeUrl,
    cloudSyncEnabled: Boolean(settings.cloudSyncEnabled),
    embeddingModel: (settings.embeddingModel ?? DEFAULT_SETTINGS.embeddingModel).trim() || DEFAULT_SETTINGS.embeddingModel,
    embeddingContentMode: settings.embeddingContentMode === "full_capture" ? "full_capture" : "readability_only",
    embeddingMaxChars: Number.isFinite(settings.embeddingMaxChars)
      ? Math.max(1_000, Math.min(120_000, Math.round(settings.embeddingMaxChars)))
      : DEFAULT_SETTINGS.embeddingMaxChars,
    temperature: Number.isFinite(settings.temperature) ? settings.temperature : DEFAULT_SETTINGS.temperature,
    maxChars: Number.isFinite(settings.maxChars) ? Math.max(1_000, Math.min(200_000, settings.maxChars)) : DEFAULT_SETTINGS.maxChars,
    preferReuseCategories: Boolean(settings.preferReuseCategories),
    semanticSearchEnabled: Boolean(settings.semanticSearchEnabled),
    searchFallbackMode: settings.searchFallbackMode === "lexical_only" ? "lexical_only" : "local_hybrid",
    excludedUrlPatterns: normalizeExcludedPatterns(settings.excludedUrlPatterns),
    rankingWeights: normalizeRankingWeights(settings.rankingWeights),
    trashRetentionDays: Number.isFinite(settings.trashRetentionDays)
      ? Math.max(1, Math.min(365, Math.round(settings.trashRetentionDays)))
      : DEFAULT_SETTINGS.trashRetentionDays
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  const fallback = DEFAULT_SETTINGS.baseUrl;
  const trimmed = (baseUrl ?? "").trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/\/+$/, "");
}

function normalizeOptionalUrl(url: string | undefined): string {
  const trimmed = (url ?? "").trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/\/+$/, "");
}

function normalizeExcludedPatterns(patterns: string[] | undefined): string[] {
  if (!Array.isArray(patterns)) {
    return [];
  }
  return Array.from(
    new Set(
      patterns
        .map((entry) => (entry ?? "").trim())
        .filter(Boolean)
        .slice(0, 200)
    )
  );
}

function normalizeRankingWeights(weights: ExtensionSettings["rankingWeights"] | undefined): ExtensionSettings["rankingWeights"] {
  const raw = {
    semantic: Number(weights?.semantic ?? DEFAULT_SETTINGS.rankingWeights.semantic),
    lexical: Number(weights?.lexical ?? DEFAULT_SETTINGS.rankingWeights.lexical),
    taxonomy: Number(weights?.taxonomy ?? DEFAULT_SETTINGS.rankingWeights.taxonomy),
    recency: Number(weights?.recency ?? DEFAULT_SETTINGS.rankingWeights.recency)
  };

  const safe = {
    semantic: clampWeight(raw.semantic),
    lexical: clampWeight(raw.lexical),
    taxonomy: clampWeight(raw.taxonomy),
    recency: clampWeight(raw.recency)
  };

  const total = safe.semantic + safe.lexical + safe.taxonomy + safe.recency;
  if (total <= 0) {
    return { ...DEFAULT_SETTINGS.rankingWeights };
  }

  return {
    semantic: roundWeight(safe.semantic / total),
    lexical: roundWeight(safe.lexical / total),
    taxonomy: roundWeight(safe.taxonomy / total),
    recency: roundWeight(safe.recency / total)
  };
}

function clampWeight(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function roundWeight(value: number): number {
  return Math.round(value * 1000) / 1000;
}
