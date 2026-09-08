import { describe, expect, it } from "vitest";
import { buildCategoryPlan, matchCategoryRule, normalizeText, type CategoryRule } from "@/lib/category-rules";
import type { PlatformStat } from "@/lib/segmentation.functions";

const CAT_GAME = "11111111-1111-1111-1111-111111111111";
const CAT_FIG = "22222222-2222-2222-2222-222222222222";

const rules: CategoryRule[] = [
  { id: "r1", nome: "Videogame", categoryId: CAT_GAME, palavras: ["psp", "ps vita", "xbox 360", "ps5"] },
  { id: "r2", nome: "Figures", categoryId: CAT_FIG, palavras: ["figure", "funko"] },
];

const platform = (platform: string, categoryId: string | null = null): PlatformStat => ({
  platformKey: normalizeText(platform),
  platform,
  productsCount: 3,
  categoryId,
});

describe("matchCategoryRule", () => {
  it("casa PSP, PS Vita e Xbox 360", () => {
    expect(matchCategoryRule("PSP", rules)?.id).toBe("r1");
    expect(matchCategoryRule("PS Vita", rules)?.id).toBe("r1");
    expect(matchCategoryRule("Xbox 360 Slim", rules)?.id).toBe("r1");
  });

  it("ignora acentos e maiúsculas", () => {
    expect(matchCategoryRule("Funkó POP", rules)?.id).toBe("r2");
  });

  it("respeita a ordem das regras", () => {
    const ordered: CategoryRule[] = [rules[1]!, rules[0]!];
    expect(matchCategoryRule("Figure PS5", ordered)?.id).toBe("r2");
    expect(matchCategoryRule("Figure PS5", rules)?.id).toBe("r1");
  });

  it("não casa quando nenhuma palavra bate", () => {
    expect(matchCategoryRule("Mangá", rules)).toBeNull();
  });
});

describe("buildCategoryPlan", () => {
  const platforms = [platform("PSP"), platform("Funko Pop", CAT_GAME), platform("Mangá")];

  it("ignora plataformas já categorizadas por padrão", () => {
    const plan = buildCategoryPlan(platforms, rules);
    expect(plan.analyzed).toBe(2);
    expect(plan.newCount).toBe(1);
    expect(plan.changeCount).toBe(0);
    expect(plan.unmatchedCount).toBe(1);
  });

  it("propõe mudança quando skipAssigned é falso", () => {
    const plan = buildCategoryPlan(platforms, rules, { skipAssigned: false });
    expect(plan.analyzed).toBe(3);
    expect(plan.changeCount).toBe(1);
    const row = plan.rows.find((r) => r.platform === "Funko Pop");
    expect(row?.proposedCategoryId).toBe(CAT_FIG);
  });
});
