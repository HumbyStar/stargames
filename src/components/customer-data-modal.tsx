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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerFn } from "@tanstack/react-start";
import { analyzeCustomerData, type CustomerFiscalData } from "@/lib/customer-data-ai.functions";
import { toast } from "sonner";
import { Sparkles, Loader2, CheckCircle2, AlertCircle, FileText, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  fichaFromTextWithDefaults,
  isFichaComplete,
  renderFichaText,
  type FichaData,
} from "@/lib/ficha-parse";

interface CustomerDataModalProps {
  open: boolean;
  onClose: () => void;
  clientName: string;
  clientPhone?: string;
  initialData?: string;
  onSave: (data: string) => void;
}

export function CustomerDataModal({
  open,
  onClose,
  clientName,
  clientPhone,
  initialData,
  onSave,
}: CustomerDataModalProps) {
  const startsStructured = isFichaComplete(initialData);
  const [mode, setMode] = useState<"text" | "form">(startsStructured ? "form" : "text");
  const [data, setData] = useState(initialData ?? "");
  const [ficha, setFicha] = useState<FichaData>(() =>
    fichaFromTextWithDefaults(initialData, { phone: clientPhone }),
  );
  const [analyzing, setAnalyzing] = useState(false);
  const [fiscal, setFiscal] = useState<CustomerFiscalData | null>(null);
  const analyze = useServerFn(analyzeCustomerData);

  useEffect(() => {
    if (!open) return;
    setData(initialData ?? "");
    setFiscal(null);
    setFicha(fichaFromTextWithDefaults(initialData, { phone: clientPhone }));
    setMode(isFichaComplete(initialData) ? "form" : "text");
  }, [initialData, clientPhone, open]);

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

  function switchToFormWithFiscal() {
    if (!fiscal) return;
    const next: FichaData = {
      fullName: fiscal.fullName,
      cpfCnpj: fiscal.cpfCnpj,
      email: fiscal.email,
      phone: fiscal.phone || (clientPhone ?? "").replace(/\D/g, ""),
      cep: fiscal.cep,
      street: fiscal.street,
      number: fiscal.number,
      complement: fiscal.complement,
      neighborhood: fiscal.neighborhood,
      city: fiscal.city,
      state: fiscal.state,
      notes: fiscal.notes,
    };
    setFicha(next);
    setMode("form");
    toast.success("Ficha estruturada pronta para revisão.");
  }

  function handleSave() {
    if (mode === "form") {
      const text = renderFichaText(ficha, clientPhone);
      onSave(text);
    } else {
      // No modo texto livre, se a IA extraiu campos, já salvamos no formato
      // canônico para virar ficha estruturada na próxima abertura. Senão,
      // preserva o texto bruto que o usuário digitou.
      if (fiscal) {
        const text = renderFichaText(
          {
            fullName: fiscal.fullName,
            cpfCnpj: fiscal.cpfCnpj,
            email: fiscal.email,
            phone: fiscal.phone || (clientPhone ?? "").replace(/\D/g, ""),
            cep: fiscal.cep,
            street: fiscal.street,
            number: fiscal.number,
            complement: fiscal.complement,
            neighborhood: fiscal.neighborhood,
            city: fiscal.city,
            state: fiscal.state,
            notes: fiscal.notes,
          },
          clientPhone,
        );
        onSave(text);
      } else {
        onSave(data);
      }
    }
    onClose();
  }

  function setField<K extends keyof FichaData>(key: K, value: string) {
    setFicha((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "form" ? "Ficha do Cliente" : "Preencher Dados do Cliente"}
          </DialogTitle>
          <DialogDescription>
            {mode === "form" ? (
              <>
                Ficha estruturada de <strong>{clientName}</strong> — todos os
                campos são editáveis manualmente.
              </>
            ) : (
              <>
                Dados completos de <strong>{clientName}</strong> — campo livre com
                <span className="inline-flex items-center gap-1 mx-1 text-primary">
                  <Sparkles className="h-3 w-3" /> IA assistida
                </span>
                para preparar a nota fiscal.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {mode === "text" ? (
          <>
            <Textarea
              value={data}
              onChange={(e) => setData(e.target.value)}
              placeholder="Cole ou digite aqui as informações completas do cliente: Nome, CPF, Endereço, CEP, E-mail, etc."
              className="min-h-64"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                A IA lê o texto acima e estrutura os campos para nota fiscal.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFicha((prev) => ({
                      ...prev,
                      phone: prev.phone || (clientPhone ?? "").replace(/\D/g, ""),
                    }));
                    setMode("form");
                  }}
                >
                  <FileText className="h-4 w-4 mr-2" /> Preencher manualmente
                </Button>
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
            </div>

            {fiscal && (
              <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-medium">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    Campos extraídos pela IA
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={switchToFormWithFiscal}>
                    Abrir ficha estruturada
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
          </>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FichaInput label="Nome" value={ficha.fullName ?? ""} onChange={(v) => setField("fullName", v)} className="sm:col-span-2" />
              <FichaInput label="CPF" value={ficha.cpfCnpj ?? ""} onChange={(v) => setField("cpfCnpj", v)} />
              <FichaInput label="Estado (UF)" value={ficha.state ?? ""} onChange={(v) => setField("state", v.toUpperCase().slice(0, 2))} maxLength={2} />
              <FichaInput label="Cidade" value={ficha.city ?? ""} onChange={(v) => setField("city", v)} />
              <FichaInput label="Bairro" value={ficha.neighborhood ?? ""} onChange={(v) => setField("neighborhood", v)} />
              <FichaInput label="Rua" value={ficha.street ?? ""} onChange={(v) => setField("street", v)} className="sm:col-span-2" />
              <FichaInput label="Número" value={ficha.number ?? ""} onChange={(v) => setField("number", v)} />
              <FichaInput label="CEP" value={ficha.cep ?? ""} onChange={(v) => setField("cep", v)} />
              <FichaInput label="Complemento" value={ficha.complement ?? ""} onChange={(v) => setField("complement", v)} className="sm:col-span-2" />
              <FichaInput label="Telefone" value={ficha.phone ?? ""} onChange={(v) => setField("phone", v)} />
              <FichaInput label="E-mail" value={ficha.email ?? ""} onChange={(v) => setField("email", v)} />
              <div className="sm:col-span-2">
                <Label className="text-xs text-muted-foreground">Observações</Label>
                <Textarea
                  value={ficha.notes ?? ""}
                  onChange={(e) => setField("notes", e.target.value)}
                  className="mt-1 min-h-20"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setData(renderFichaText(ficha, clientPhone));
                  setMode("text");
                }}
              >
                <Pencil className="h-4 w-4 mr-2" /> Editar como texto livre
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave}>Salvar</Button>
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

function FichaInput({
  label,
  value,
  onChange,
  className,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  maxLength?: number;
}) {
  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        className="mt-1"
      />
    </div>
  );
}
