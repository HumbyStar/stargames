import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useServerFn } from "@tanstack/react-start";
import { analyzeCustomerData, type CustomerFiscalData } from "@/lib/customer-data-ai.functions";
import { classifyProductsForNf } from "@/lib/nf-format.functions";
import { saveNfInvoice } from "@/lib/nf-history.functions";
import {
  buildFiscalHeader,
  groupByNcm,
  missingFiscalFields,
  renderNfText,
  type NfProduct,
} from "@/lib/nf-format";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Sparkles, AlertCircle } from "lucide-react";
import type { Client } from "@/lib/store";

interface Props {
  open: boolean;
  onClose: () => void;
  client: Client | null;
  products: NfProduct[];
}

export function NfFormatModal({ open, onClose, client, products }: Props) {
  const analyze = useServerFn(analyzeCustomerData);
  const classify = useServerFn(classifyProductsForNf);
  const save = useServerFn(saveNfInvoice);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [totalCents, setTotalCents] = useState(0);

  useEffect(() => {
    if (!open || !client) return;
    setError(null);
    setMissing([]);
    setText("");
    setTotalCents(0);
    const raw = (client.customerData ?? "").trim();
    if (!raw) {
      setError(
        "Cadastro fiscal ausente. Preencha em 'Preencher Dados do Cliente' (Nome, CPF, Endereço, Nº, Bairro, Cidade, UF, CEP).",
      );
      return;
    }
    if (products.length === 0) {
      setError("Selecione ao menos 1 produto.");
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const fiscal: CustomerFiscalData = await analyze({ data: { text: raw } });
        if (cancelled) return;
        const miss = missingFiscalFields(fiscal);
        if (miss.length > 0) {
          setMissing(miss);
          setError(
            "Cadastro fiscal incompleto — complete em 'Preencher Dados do Cliente'.",
          );
          return;
        }
        const classifications = await classify({
          data: {
            products: products.map((p) => ({
              id: p.id,
              name: p.name,
              platform: p.platform ?? "",
              totalValue: p.totalValue,
            })),
          },
        });
        if (cancelled) return;
        const header = buildFiscalHeader(fiscal);
        const groups = groupByNcm(products, classifications);
        setText(renderNfText(header, groups));
        const total = groups.reduce((s, g) => s + g.subtotal, 0);
        setTotalCents(Math.round(total * 100));
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Falha ao gerar formato NF.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, client, products, analyze, classify]);

  async function confirmNota() {
    if (!client || !text) return;
    setSaving(true);
    try {
      await save({
        data: {
          clientId: client.id,
          content: text,
          totalCents,
          productIds: products.map((p) => p.id),
        },
      });
      toast.success("Nota registrada no histórico do cliente.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar nota.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Formato para Nota Fiscal
          </DialogTitle>
          <DialogDescription>
            {client
              ? `${products.length} produto(s) selecionado(s) — ${client.name}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-4 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Classificando NCM via IA e montando lotes…
          </div>
        )}

        {!loading && error && (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 text-amber-600" />
              <p>{error}</p>
            </div>
            {missing.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Faltando: <strong>{missing.join(", ")}</strong>
              </p>
            )}
          </div>
        )}

        {!loading && !error && text && (
          <>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-72 font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Texto pronto para envio ao contador. Você pode ajustar antes de copiar.
            </p>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={confirmNota} disabled={!text || loading || saving}>
            {saving ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando…</>
            ) : (
              <><CheckCircle2 className="mr-2 h-4 w-4" /> Confirmar Nota</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}