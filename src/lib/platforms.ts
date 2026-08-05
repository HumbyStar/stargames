import { useMemo } from "react";
import { useStore } from "@/lib/store";

/** Plataformas padrão sempre disponíveis no sistema. */
export const DEFAULT_PLATFORMS = [
  "PS5",
  "PS4",
  "PS3",
  "PS2",
  "Xbox",
  "Nintendo",
  "Colecionável",
] as const;

export function normalizePlatform(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function platformKey(value: string): string {
  return normalizePlatform(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Combina padrões + plataformas já usadas nos produtos + customizadas. */
export function mergePlatforms(...groups: (readonly string[] | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const group of groups) {
    for (const raw of group ?? []) {
      const value = normalizePlatform(raw ?? "");
      if (!value) continue;
      const key = platformKey(value);
      if (!seen.has(key)) seen.set(key, value);
    }
  }
  return [...seen.values()];
}

/** Lista unificada de plataformas para selects e filtros. */
export function usePlatformOptions(): string[] {
  const products = useStore((s) => s.products);
  const customPlatforms = useStore((s) => s.preferences.customPlatforms);
  return useMemo(
    () =>
      mergePlatforms(
        DEFAULT_PLATFORMS,
        products.map((p) => p.platform ?? ""),
        customPlatforms,
      ),
    [products, customPlatforms],
  );
}

/** Registra uma plataforma nova nas preferências (evita duplicadas). */
export function useAddPlatform() {
  const customPlatforms = useStore((s) => s.preferences.customPlatforms);
  const setPreferences = useStore((s) => s.setPreferences);
  const options = usePlatformOptions();
  return (raw: string): string | null => {
    const value = normalizePlatform(raw);
    if (!value) return null;
    const existing = options.find((o) => platformKey(o) === platformKey(value));
    if (existing) return existing;
    setPreferences({ customPlatforms: mergePlatforms(customPlatforms, [value]) });
    return value;
  };
}