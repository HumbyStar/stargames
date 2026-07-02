import type { Situation, FinancialStatus } from "./store";

export interface NormalizedSituation {
  situation: Situation | null;
  financialStatusOverride?: FinancialStatus;
  unknown: boolean;
  matchedRule?: string;
  raw: string;
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function baseNormalize(raw: string): string {
  let s = String(raw ?? "");
  // remover markdown ~~tachado~~
  s = s.replace(/~~+/g, " ");
  // remover conteúdo entre parênteses (nomes, datas)
  s = s.replace(/\([^)]*\)/g, " ");
  // remover asteriscos e traços decorativos
  s = s.replace(/[*]+/g, " ");
  s = stripAccents(s).toLowerCase();
  // consertos comuns de digitação (aplicados ANTES do colapso de tokens)
  s = s
    .replace(/envaido/g, "enviado")
    .replace(/enviad0/g, "enviado")
    .replace(/removid0/g, "removido")
    .replace(/removdo/g, "removido")
    .replace(/desisistiu|desisitiu|desisitu|desitiu|deisitiu/g, "desistiu")
    .replace(/desistencia/g, "desistiu")
    .replace(/expirou item|item expirado/g, "expirado")
    .replace(/itens? removidos?/g, "removido")
    .replace(/cliente retirou[^-,]*/g, "retirado")
    .replace(/de volta ao estoque/g, "removido")
    .replace(/saiu do grupo|cliente sumiu|sumiu|perdeu/g, "removido")
    .replace(/quer trocar/g, "removido")
    .replace(/nao funcionou|não funcionou/g, "removido")
    .replace(/deu erro( no produto)?/g, "removido")
    .replace(/deixou de credito|credito usado|preferiu ficar de credito/g, "removido")
    .replace(/taxa item nao pago|taxa paga/g, "removido")
    .replace(/reserva expirou/g, "removido")
    .replace(/valor devolvido|valor estornado/g, "removido")
    .replace(/item repetido/g, "removido")
    .replace(/cliente desistiu|desistiu do item|desistencia/g, "desistiu");
  // colapsar múltiplos espaços
  s = s.replace(/\s+/g, " ").trim();
  // remover pontuações e dígitos “colados” tipo "retirado6" → "retirado "
  s = s.replace(/([a-z])(\d)/g, "$1 $2");
  // separar "enviadomateus" ou "enviadonf" quando começa por token conhecido
  s = s.replace(/^(enviado|removido|retirado|retirar|entregue|pago)([a-z])/, "$1 $2");
  return s.trim();
}

interface Rule {
  name: string;
  test: (s: string) => boolean;
  situation: Situation | null;
  financialStatusOverride?: FinancialStatus;
}

const RULES: Rule[] = [
  // MGMV / LOTES → produto vira parte de acordo (situação em aberto + FS MGMV)
  {
    name: "mgmv",
    test: (s) => /\bmgmv\b/.test(s) || /\blote\s*\d+\b/.test(s) || /^lote\b/.test(s),
    situation: "Em Aberto",
    financialStatusOverride: "MGMV",
  },
  // Pago / LOTE PAGO
  {
    name: "pago",
    test: (s) => /\blote pago\b/.test(s) || /^pago\b/.test(s),
    situation: "Enviado",
    financialStatusOverride: "Pago",
  },
  // Enviado (inclui variações, "enviado - ...", "entregue")
  {
    name: "enviado",
    test: (s) => /^enviado\b/.test(s) || /^entregue\b/.test(s) || /^enviou\b/.test(s) || /^m\s+enviado\b/.test(s) || /^m\s*-\s*enviado\b/.test(s),
    situation: "Enviado",
  },
  // Retirar (antes de "retirado" para não colidir)
  {
    name: "retirar",
    test: (s) => /^retirar\b/.test(s),
    situation: "Retirar",
  },
  // Retirado
  {
    name: "retirado",
    test: (s) => /^retirado\b/.test(s),
    situation: "Retirado",
  },
  // Removido / Cancelado / Devolvido / Expirado / Desistências / Erros
  {
    name: "removido",
    test: (s) =>
      /^removido\b/.test(s) ||
      /^cancelado\b/.test(s) ||
      /^devolvido\b/.test(s) ||
      /^expirado\b/.test(s) ||
      /^desistiu\b/.test(s),
    situation: "Removido",
  },
];

/**
 * Normaliza qualquer texto do campo "Situação" (Notion / colada / IA) para os
 * status oficiais do sistema. Retorna `unknown=true` quando nenhum bucket bate,
 * registrando no console + sessionStorage para revisão posterior.
 *
 * @param raw texto bruto
 * @param _currentFinancialStatus status financeiro atual (opcional, hoje não altera decisão)
 */
export function normalizeSituation(raw: string, _currentFinancialStatus?: FinancialStatus): NormalizedSituation {
  const rawStr = String(raw ?? "");
  const trimmed = rawStr.trim();
  if (!trimmed || trimmed === "-") {
    return { situation: "Em Aberto", unknown: false, matchedRule: "empty", raw: rawStr };
  }
  const s = baseNormalize(trimmed);
  for (const rule of RULES) {
    if (rule.test(s)) {
      return {
        situation: rule.situation,
        financialStatusOverride: rule.financialStatusOverride,
        unknown: false,
        matchedRule: rule.name,
        raw: rawStr,
      };
    }
  }
  // fallback: log
  try {
    // eslint-disable-next-line no-console
    console.warn("[situation-normalizer] valor não reconhecido:", rawStr);
    if (typeof sessionStorage !== "undefined") {
      const key = "import.situation.unknown";
      const prev = sessionStorage.getItem(key);
      const list = prev ? (JSON.parse(prev) as string[]) : [];
      if (!list.includes(rawStr)) {
        list.push(rawStr);
        sessionStorage.setItem(key, JSON.stringify(list.slice(-200)));
      }
    }
  } catch {
    // noop
  }
  return { situation: null, unknown: true, raw: rawStr };
}

/**
 * Versão “safe” para o pipeline: se não reconhecer, cai em `"Em Aberto"` para
 * não bloquear a importação. O log ainda é registrado para revisão.
 */
export function normalizeSituationSafe(raw: string, currentFinancialStatus?: FinancialStatus): NormalizedSituation {
  const r = normalizeSituation(raw, currentFinancialStatus);
  if (r.unknown) return { ...r, situation: "Em Aberto" };
  return r;
}