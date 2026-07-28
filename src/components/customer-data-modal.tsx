import { useEffect, useMemo, useState } from "react";
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
import { toast } from "sonner";
import { Sparkles, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface CustomerDataModalProps {
  open: boolean;
  onClose: () => void;
  clientName: string;
  initialData?: string;
  onSave: (data: string) => void;
}

export function CustomerDataModal({
  open,
  onClose,
  clientName,
  initialData,
  onSave,
}: CustomerDataModalProps) {
  const [data, setData] = useState(initialData ?? "");
  const [analyzing, setAnalyzing] = useState(false);
  const [fiscal, setFiscal] = useState<CustomerFiscalData | null>(null);
  const analyze = useServerFn(analyzeCustomerData);

  useEffect(() => {
    setData(initialData ?? "");
    setFiscal(null);
  }, [initialData, open]);

  const canAnalyze = useMemo(() => data.trim().length >= 10 && !analyzing, [data, analyzing]);

  async function handleAnalyze() {
    if (!canAnalyze) return;
    setAnalyzing(true);
    try {
      const result = await analyze({ data: { text: data.trim() } });
      setFiscal(result);
      const found = [
        result.fullName && "Nome",
        result.cpfCnpj && "CPF/CNPJ",
        result.email && "E-mail",
        result.cep && "CEP",
        result.street && "Endereço",
      ].filter(Boolean).length;
      toast.success(`IA extraiu ${found} campo(s) para nota fiscal.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao analisar com IA.");
    } finally {
      setAnalyzing(false);
    }
  }

  function appendOrganized() {
    if (!fiscal) return;
    const lines = [
      "",
      "--- Organizado pela IA (nota fiscal) ---",
      fiscal.fullName && `Nome: ${fiscal.fullName}`,
      fiscal.cpfCnpj && `CPF/CNPJ: ${fiscal.cpfCnpj}`,
      fiscal.email && `E-mail: ${fiscal.email}`,
      fiscal.phone && `Telefone: ${fiscal.phone}`,
      fiscal.cep && `CEP: ${fiscal.cep}`,
      fiscal.street && `Endereço: ${fiscal.street}${fiscal.number ? `, ${fiscal.number}` : ""}${fiscal.complement ? ` - ${fiscal.complement}` : ""}`,
      fiscal.neighborhood && `Bairro: ${fiscal.neighborhood}`,
      (fiscal.city || fiscal.state) && `Cidade/UF: ${fiscal.city}${fiscal.state ? `/${fiscal.state}` : ""}`,
      fiscal.notes && `Obs: ${fiscal.notes}`,
    ].filter(Boolean).join("\n");
    setData((prev) => `${prev.trim()}\n${lines}`.trim());
    toast.success("Bloco organizado inserido no campo.");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Preencher Dados do Cliente</DialogTitle>
          <DialogDescription>
            Dados completos de <strong>{clientName}</strong> — campo livre com
            <span className="inline-flex items-center gap-1 mx-1 text-primary">
              <Sparkles className="h-3 w-3" /> IA assistida
            </span>
            para preparar a nota fiscal.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={data}
          onChange={(e) => setData(e.target.value)}
          placeholder="Cole ou digite aqui as informações completas do cliente: Nome, CPF, Endereço, CEP, E-mail, etc."
          className="min-h-64"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            A IA lê o texto acima e estrutura os campos para nota fiscal.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleAnalyze}
            disabled={!canAnalyze}
          >
            {analyzing ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analisando…</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-2" /> Analisar com IA</>
            )}
          </Button>
        </div>

        {fiscal && (
          <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                Campos extraídos pela IA
              </div>
              <Button type="button" variant="outline" size="sm" onClick={appendOrganized}>
                Inserir no campo
              </Button>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              <FiscalField label="Nome" value={fiscal.fullName} />
              <FiscalField label="CPF/CNPJ" value={fiscal.cpfCnpj} />
              <FiscalField label="E-mail" value={fiscal.email} />
              <FiscalField label="Telefone" value={fiscal.phone} />
              <FiscalField label="CEP" value={fiscal.cep} />
              <FiscalField label="Cidade/UF" value={[fiscal.city, fiscal.state].filter(Boolean).join("/")} />
              <FiscalField
                label="Endereço"
                value={[fiscal.street, fiscal.number, fiscal.complement].filter(Boolean).join(", ")}
              />
              <FiscalField label="Bairro" value={fiscal.neighborhood} />
            </dl>
            {fiscal.missing.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-border/60">
                <AlertCircle className="h-3 w-3 text-amber-500" />
                <span className="text-xs text-muted-foreground">Faltando:</span>
                {fiscal.missing.map((m) => (
                  <Badge key={m} variant="outline" className="text-xs">{m}</Badge>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onSave(data);
              onClose();
            }}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FiscalField({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={value ? "text-sm" : "text-sm text-muted-foreground italic"}>
        {value || "—"}
      </dd>
    </>
  );
}
