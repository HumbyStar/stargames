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
import type { CustomerFiscalData } from "@/lib/customer-data-ai.functions";
import { fiscalDataFromFichaText } from "@/lib/ficha-parse";
import { classifyProductsForNf } from "@/lib/nf-format.functions";
import { saveNfInvoice } from "@/lib/nf-history.functions";
import {
  buildFiscalHeader,
  missingFiscalFields,
  renderAccountantNfText,
  formatNcm,
  type NfProduct,
} from "@/lib/nf-format";
import { toast } from "sonner";
import { CheckCircle2, Download, Loader2, Sparkles, AlertCircle } from "lucide-react";
import { downloadNfPdf } from "@/lib/nf-pdf";
import type { Client } from "@/lib/store";

interface Props {
  open: boolean;
  onClose: () => void;
  client: Client | null;
  products: NfProduct[];
  onSaved?: () => void;
}

export function NfFormatModal({ open, onClose, client, products, onSaved }: Props) {
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
        const fiscal: CustomerFiscalData = fiscalDataFromFichaText(raw, {
          phone: client.phone,
        });
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
        const byId = new Map(classifications.map((c) => [c.id, c]));
        const items = products.map((p) => {
          const c = byId.get(p.id);
          return {
            name: p.name,
            platform: p.platform ?? "",
            totalValue: p.totalValue,
            ncm: c?.ncm ? formatNcm(c.ncm) : "—",
            category: c?.category?.trim() || "Sem classificação (revisar)",
          };
        });
        setText(renderAccountantNfText(header, items));
        const total = items.reduce((s, i) => s + i.totalValue, 0);
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
  }, [open, client, products, classify]);

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
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar nota.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePdf() {
    if (!client || !text) return;
    try {
      await downloadNfPdf({ clientName: client.name, content: text, totalCents });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar PDF.");
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
            Aplicando regra de NCM e montando os itens…
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
              Texto editável e pronto para envio ao contador. Ajuste antes de
              confirmar ou baixar em PDF.
            </p>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button variant="outline" onClick={handlePdf} disabled={!text || loading}>
            <Download className="mr-2 h-4 w-4" /> Baixar PDF
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