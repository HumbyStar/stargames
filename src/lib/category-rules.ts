/**
 * Regras determinísticas de categoria por palavras-chave.
 * Mesma ideia da regra de NCM: uma lista ordenada de regras; vence a primeira
 * que casar com o nome da plataforma.
 */
import type { CategoryNode, PlatformStat } from "@/lib/segmentation.functions";

export interface CategoryRule {
  id: string;
  nome: string;
  /** Categoria de destino (id de product_categories) ou null = sem categoria. */
  categoryId: string | null;
  palavras: string[];
}

export interface PlanRow {
  platformKey: string;
  platform: string;
  productsCount: number;
  currentCategoryId: string | null;
  proposedCategoryId: string | null;
  ruleId: string | null;
  ruleName: string | null;
  kind: "new" | "change" | "unmatched" | "same";
}

export interface CategoryPlan {
  rows: PlanRow[];
  analyzed: number;
  newCount: number;
  changeCount: number;
  unmatchedCount: number;
}

export function normalizeText(value: string): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Casa por palavra/expressão contida no nome normalizado da plataforma. */
export function matchCategoryRule(platform: string, rules: CategoryRule[]): CategoryRule | null {
  const text = ` ${normalizeText(platform)} `;
  for (const rule of rules) {
    for (const raw of rule.palavras) {
      const word = normalizeText(raw);
      if (!word) continue;
      if (text.includes(` ${word} `) || text.includes(`${word} `) === false ? text.includes(` ${word} `) : true) {
        if (text.includes(` ${word} `)) return rule;
      }
    }
  }
  return null;
}

export function buildCategoryPlan(
  platforms: PlatformStat[],
  rules: CategoryRule[],
  options: { skipAssigned?: boolean } = {},
): CategoryPlan {
  const skipAssigned = options.skipAssigned ?? true;
  const rows: PlanRow[] = [];
  let newCount = 0;
  let changeCount = 0;
  let unmatchedCount = 0;

  for (const p of platforms) {
    if (skipAssigned && p.categoryId) continue;
    const rule = matchCategoryRule(p.platform, rules);
    const proposed = rule?.categoryId ?? null;
    let kind: PlanRow["kind"];
    if (!rule || !proposed) {
      kind = "unmatched";
      unmatchedCount += 1;
    } else if (!p.categoryId) {
      kind = "new";
      newCount += 1;
    } else if (p.categoryId !== proposed) {
      kind = "change";
      changeCount += 1;
    } else {
      kind = "same";
    }
    rows.push({
      platformKey: p.platformKey,
      platform: p.platform,
      productsCount: p.productsCount,
      currentCategoryId: p.categoryId,
      proposedCategoryId: proposed,
      ruleId: rule?.id ?? null,
      ruleName: rule?.nome ?? null,
      kind,
    });
  }

  return {
    rows,
    analyzed: rows.length,
    newCount,
    changeCount,
    unmatchedCount,
  };
}

/** Caminho completo da categoria (Brinquedos › Figures › Anime). */
export function categoryLabel(id: string | null, categories: CategoryNode[]): string {
  if (!id) return "Sem categoria";
  const byId = new Map(categories.map((c) => [c.id, c]));
  const parts: string[] = [];
  const seen = new Set<string>();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.length ? parts.join(" › ") : "Sem categoria";
}

export const SUGGESTED_KEYWORDS: Record<string, string[]> = {
  Videogame: [
    "playstation",
    "ps1",
    "ps2",
    "ps3",
    "ps4",
    "ps5",
    "psp",
    "ps vita",
    "vita",
    "psone",
    "xbox",
    "360",
    "series x",
    "series s",
    "nintendo",
    "switch",
    "wii",
    "ds",
    "3ds",
    "game boy",
    "gameboy",
    "mega drive",
    "sega",
    "dreamcast",
    "saturn",
    "atari",
    "neo geo",
    "console",
    "jogo",
    "game",
  ],
  "Figures / Colecionáveis": [
    "figure",
    "bandai",
    "banpresto",
    "good smile",
    "kotobukiya",
    "megahouse",
    "nendoroid",
    "funko",
    "pop",
    "action figure",
    "pelucia",
    "3d",
  ],
};

export function makeRuleId(): string {
  return `r_${Math.random().toString(36).slice(2, 10)}`;
}
