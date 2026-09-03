/**
 * Conferência assistida da criação de acordos MGMV.
 *
 * Regras puras (sem IA e sem acesso a rede) executadas ANTES de gravar,
 * para que a criação nunca dependa de descobrir o problema pelo erro do banco.
 */

export type PreflightLevel = "ok" | "warn" | "block";

export interface PreflightCheck {
  id: string;
  label: string;
  level: PreflightLevel;
  detail: string;
}

export interface PreflightInput {
  /** Produtos selecionados para entrar no acordo. */
  selected: { id: string; name: string; financialStatus: string; totalValue: number; paidValue: number }[];
  /** Cliente já possui acordo MGMV ativo (não quitado)? */
  hasActiveAgreement: boolean;
  /** Cliente possui acordo já quitado (arquivado)? */
  hasCompletedAgreement: boolean;
  /** Total combinado do acordo. */
  total: number;
  /** Entrada paga no ato. */
  entry: number;
  /** Parcelas geradas (valor e vencimento em ISO). */
  installments: { number: number; value: number; dueDate: string }[];
  /** Usuário atual tem permissão de gravar clientes/acordos. */
  canWrite: boolean;
}

const money = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Diferença tolerada por arredondamento de centavos por parcela. */
export function installmentsTolerance(count: number): number {
  return Math.max(0.01, count * 0.01);
}

export function runMgmvPreflight(input: PreflightInput): PreflightCheck[] {
  const checks: PreflightCheck[] = [];

  // 1. Permissão
  checks.push(
    input.canWrite
      ? { id: "perm", label: "Permissão de gravação", level: "ok", detail: "Seu usuário pode criar acordos." }
      : {
          id: "perm",
          label: "Permissão de gravação",
          level: "block",
          detail: "Seu usuário não tem permissão para criar acordos MGMV.",
        },
  );

  // 2. Produtos selecionados
  if (input.selected.length === 0) {
    checks.push({
      id: "produtos",
      label: "Produtos do acordo",
      level: "block",
      detail: "Selecione ao menos um produto para compor o acordo.",
    });
  } else {
    const alreadyMgmv = input.selected.filter((p) => p.financialStatus === "MGMV");
    checks.push(
      alreadyMgmv.length > 0
        ? {
            id: "produtos",
            label: "Produtos do acordo",
            level: "warn",
            detail: `${alreadyMgmv.length} produto(s) vêm de um acordo anterior e serão migrados para o novo: ${alreadyMgmv
              .map((p) => p.name)
              .join(", ")}.`,
          }
        : {
            id: "produtos",
            label: "Produtos do acordo",
            level: "ok",
            detail: `${input.selected.length} produto(s) em aberto serão vinculados ao acordo.`,
          },
    );
  }

  // 3. Acordo existente
  if (input.hasActiveAgreement) {
    checks.push({
      id: "acordo",
      label: "Acordo existente",
      level: "block",
      detail: "Este cliente já possui um acordo MGMV ativo. Edite o acordo atual em vez de criar outro.",
    });
  } else if (input.hasCompletedAgreement) {
    checks.push({
      id: "acordo",
      label: "Acordo existente",
      level: "warn",
      detail: "Existe um acordo quitado no histórico. O novo acordo não altera o anterior.",
    });
  } else {
    checks.push({
      id: "acordo",
      label: "Acordo existente",
      level: "ok",
      detail: "Cliente sem acordo MGMV ativo.",
    });
  }

  // 4. Valores
  const sum = input.installments.reduce((s, i) => s + i.value, 0);
  const financed = Math.max(0, input.total - input.entry);
  const diff = Math.abs(sum - financed);
  if (input.total <= 0) {
    checks.push({
      id: "valores",
      label: "Valores do acordo",
      level: "block",
      detail: "Informe um valor total maior que zero.",
    });
  } else if (input.entry > input.total) {
    checks.push({
      id: "valores",
      label: "Valores do acordo",
      level: "block",
      detail: "A entrada não pode ser maior que o total do acordo.",
    });
  } else if (diff > installmentsTolerance(input.installments.length)) {
    checks.push({
      id: "valores",
      label: "Valores do acordo",
      level: "warn",
      detail: `Soma das parcelas (${money(sum)}) difere do valor financiado (${money(financed)}) em ${money(diff)}.`,
    });
  } else {
    checks.push({
      id: "valores",
      label: "Valores do acordo",
      level: "ok",
      detail: `${input.installments.length}x totalizando ${money(sum)} (financiado ${money(financed)}).`,
    });
  }

  // 5. Datas
  if (input.installments.length === 0) {
    checks.push({
      id: "datas",
      label: "Vencimentos",
      level: "block",
      detail: "O acordo precisa ter ao menos uma parcela.",
    });
  } else {
    const times = input.installments.map((i) => new Date(i.dueDate).getTime());
    const invalid = times.some((t) => Number.isNaN(t));
    const ordered = times.every((t, i) => i === 0 || t > times[i - 1]);
    if (invalid) {
      checks.push({
        id: "datas",
        label: "Vencimentos",
        level: "block",
        detail: "Há parcelas com data de vencimento inválida.",
      });
    } else if (!ordered) {
      checks.push({
        id: "datas",
        label: "Vencimentos",
        level: "block",
        detail: "As datas das parcelas precisam estar em ordem crescente.",
      });
    } else {
      const first = new Date(times[0]);
      checks.push({
        id: "datas",
        label: "Vencimentos",
        level: "ok",
        detail: `Primeira parcela em ${first.toLocaleDateString("pt-BR")}, uma por mês.`,
      });
    }
  }

  return checks;
}

export function preflightBlocked(checks: PreflightCheck[]): boolean {
  return checks.some((c) => c.level === "block");
}
