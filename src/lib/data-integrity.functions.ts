import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Validação de integridade de dados acionada pelo Concierge.
 * - Roda no servidor sob RLS do usuário autenticado.
 * - Retorna achados com ação sugerida; o usuário confirma cada correção.
 * - Apenas correções determinísticas e reversíveis são aplicáveis automaticamente.
 */

export type IntegrityFixType =
  | "product_paid_gt_total"
  | "product_total_zero_paid_positive"
  | "product_mgmv_orphan_flag"
  | "client_duplicate"
  | "mgmv_missing_next_due";

export type IntegrityFinding = {
  id: string; // estável: tipo + alvo
  type: IntegrityFixType;
  severity: "info" | "warning" | "danger";
  title: string;
  detail: string;
  fixLabel: string | null; // null = só sinaliza, não tem fix automático
  targetTable: "products" | "clients" | "mgmv_agreements";
  targetId: string;
};

export type ScanResult = {
  scannedAt: string;
  findings: IntegrityFinding[];
  counts: Record<IntegrityFixType, number>;
};

export const scanDataIntegrity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ScanResult> => {
    const { supabase } = context;
    const findings: IntegrityFinding[] = [];

    // 1) Produtos com paid_value > total_value
    const { data: prodPaidOver } = await supabase
      .from("products")
      .select("id, name, total_value, paid_value, client_id")
      .gt("paid_value", 0)
      .limit(500);
    for (const p of (prodPaidOver ?? []) as any[]) {
      if (Number(p.paid_value) > Number(p.total_value)) {
        findings.push({
          id: `product_paid_gt_total:${p.id}`,
          type: "product_paid_gt_total",
          severity: "warning",
          title: `Produto "${p.name}" pago acima do total`,
          detail: `Pago ${p.paid_value} > total ${p.total_value}. Sugestão: igualar total ao pago.`,
          fixLabel: "Igualar total ao valor pago",
          targetTable: "products",
          targetId: p.id,
        });
      }
    }

    // 2) Produtos com total_value <= 0 e paid_value > 0
    const { data: prodZeroTotal } = await supabase
      .from("products")
      .select("id, name, total_value, paid_value")
      .lte("total_value", 0)
      .gt("paid_value", 0)
      .limit(500);
    for (const p of (prodZeroTotal ?? []) as any[]) {
      findings.push({
        id: `product_total_zero_paid_positive:${p.id}`,
        type: "product_total_zero_paid_positive",
        severity: "warning",
        title: `Produto "${p.name}" sem valor total`,
        detail: `Valor total = ${p.total_value}, mas há ${p.paid_value} pago. Sugestão: definir total = pago.`,
        fixLabel: "Definir total = valor pago",
        targetTable: "products",
        targetId: p.id,
      });
    }

    // 3) Produtos marcados em MGMV mas sem agreement_id
    const { data: prodOrphan } = await supabase
      .from("products")
      .select("id, name")
      .eq("included_in_mgmv", true)
      .is("mgmv_agreement_id", null)
      .limit(500);
    for (const p of (prodOrphan ?? []) as any[]) {
      findings.push({
        id: `product_mgmv_orphan_flag:${p.id}`,
        type: "product_mgmv_orphan_flag",
        severity: "warning",
        title: `Produto "${p.name}" marcado em MGMV sem acordo`,
        detail: "Produto está incluso em MGMV mas não tem acordo vinculado. Sugestão: desmarcar.",
        fixLabel: "Desmarcar MGMV deste produto",
        targetTable: "products",
        targetId: p.id,
      });
    }

    // 4) Acordos MGMV ativos sem next_due_date
    const { data: mgmvNoDue } = await supabase
      .from("mgmv_agreements")
      .select("id, client_name")
      .eq("status", "Ativo")
      .is("next_due_date", null)
      .limit(500);
    for (const m of (mgmvNoDue ?? []) as any[]) {
      findings.push({
        id: `mgmv_missing_next_due:${m.id}`,
        type: "mgmv_missing_next_due",
        severity: "info",
        title: `Acordo MGMV de ${m.client_name || "—"} sem próxima parcela`,
        detail: "Acordo ativo sem next_due_date. Revisar manualmente no MGMV.",
        fixLabel: null,
        targetTable: "mgmv_agreements",
        targetId: m.id,
      });
    }

    // 5) Clientes duplicados por nome + telefone normalizado
    const { data: allClients } = await supabase
      .from("clients")
      .select("id, name, phone, created_at")
      .order("created_at", { ascending: true })
      .limit(5000);
    const seen = new Map<string, string>();
    for (const c of (allClients ?? []) as any[]) {
      const key = `${(c.name || "").trim().toLowerCase()}|${(c.phone || "").replace(/\D/g, "")}`;
      if (!key.trim() || key === "|") continue;
      const first = seen.get(key);
      if (first && first !== c.id) {
        findings.push({
          id: `client_duplicate:${c.id}`,
          type: "client_duplicate",
          severity: "info",
          title: `Possível cliente duplicado: ${c.name}`,
          detail: `Outro cadastro com mesmo nome e telefone (id ${first}). Revisar manualmente antes de unir.`,
          fixLabel: null,
          targetTable: "clients",
          targetId: c.id,
        });
      } else if (!first) {
        seen.set(key, c.id);
      }
    }

    const counts: Record<IntegrityFixType, number> = {
      product_paid_gt_total: 0,
      product_total_zero_paid_positive: 0,
      product_mgmv_orphan_flag: 0,
      client_duplicate: 0,
      mgmv_missing_next_due: 0,
    };
    for (const f of findings) counts[f.type]++;

    return { scannedAt: new Date().toISOString(), findings, counts };
  });

const applySchema = z.object({
  type: z.enum([
    "product_paid_gt_total",
    "product_total_zero_paid_positive",
    "product_mgmv_orphan_flag",
  ]),
  targetId: z.string().uuid(),
});

export type ApplyFixResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export const applyIntegrityFix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => applySchema.parse(d))
  .handler(async ({ data, context }): Promise<ApplyFixResult> => {
    const { supabase } = context;
    try {
      if (
        data.type === "product_paid_gt_total" ||
        data.type === "product_total_zero_paid_positive"
      ) {
        const { data: p, error: e1 } = await supabase
          .from("products")
          .select("paid_value, total_value")
          .eq("id", data.targetId)
          .maybeSingle();
        if (e1) return { ok: false, error: e1.message };
        if (!p) return { ok: false, error: "Produto não encontrado." };
        const paid = Number((p as any).paid_value || 0);
        if (paid <= 0) return { ok: false, error: "Valor pago inválido para corrigir." };
        const { error } = await supabase
          .from("products")
          .update({ total_value: paid })
          .eq("id", data.targetId);
        if (error) return { ok: false, error: error.message };
        return { ok: true, message: "Total ajustado para o valor pago." };
      }
      if (data.type === "product_mgmv_orphan_flag") {
        const { error } = await supabase
          .from("products")
          .update({ included_in_mgmv: false })
          .eq("id", data.targetId)
          .is("mgmv_agreement_id", null);
        if (error) return { ok: false, error: error.message };
        return { ok: true, message: "Marcação de MGMV removida." };
      }
      return { ok: false, error: "Tipo de correção sem ação automática." };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Falha ao aplicar correção." };
    }
  });