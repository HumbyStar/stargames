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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface CustomerDataModalProps {
  open: boolean;
  onClose: () => void;
  clientName: string;
  initialData?: string;
  onSave: (data: string) => void;
}

const FIELDS = [
  { key: "nome", label: "Nome completo", placeholder: "Nome completo do cliente" },
  { key: "cpf", label: "CPF", placeholder: "000.000.000-00" },
  { key: "email", label: "E-mail", placeholder: "cliente@email.com" },
  { key: "cep", label: "CEP", placeholder: "00000-000" },
  { key: "endereco", label: "Endereço", placeholder: "Rua / Avenida" },
  { key: "numero", label: "Número", placeholder: "123" },
  { key: "complemento", label: "Complemento", placeholder: "Apto, bloco, referência" },
  { key: "bairro", label: "Bairro", placeholder: "Bairro" },
  { key: "cidade", label: "Cidade", placeholder: "Cidade" },
  { key: "estado", label: "Estado", placeholder: "UF" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];
type FieldState = Record<FieldKey, string> & { observacoes: string };

const EMPTY: FieldState = {
  nome: "", cpf: "", email: "", cep: "", endereco: "", numero: "",
  complemento: "", bairro: "", cidade: "", estado: "", observacoes: "",
};

const LABEL_TO_KEY: Record<string, keyof FieldState> = {
  "nome": "nome", "nome completo": "nome",
  "cpf": "cpf",
  "e-mail": "email", "email": "email",
  "cep": "cep",
  "endereço": "endereco", "endereco": "endereco", "rua": "endereco",
  "número": "numero", "numero": "numero", "nº": "numero", "n°": "numero",
  "complemento": "complemento",
  "bairro": "bairro",
  "cidade": "cidade",
  "estado": "estado", "uf": "estado",
  "observações": "observacoes", "observacoes": "observacoes", "obs": "observacoes",
};

function parse(text: string): FieldState {
  const state: FieldState = { ...EMPTY };
  if (!text) return state;
  const extras: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) {
      const key = LABEL_TO_KEY[m[1].trim().toLowerCase()];
      if (key) { state[key] = m[2].trim(); continue; }
    }
    extras.push(line);
  }
  if (extras.length) {
    state.observacoes = [state.observacoes, ...extras].filter(Boolean).join("\n");
  }
  return state;
}

function serialize(state: FieldState): string {
  const lines: string[] = [];
  for (const f of FIELDS) {
    const v = state[f.key].trim();
    if (v) lines.push(`${f.label}: ${v}`);
  }
  const obs = state.observacoes.trim();
  if (obs) lines.push(`Observações: ${obs}`);
  return lines.join("\n");
}

export function CustomerDataModal({
  open,
  onClose,
  clientName,
  initialData,
  onSave,
}: CustomerDataModalProps) {
  const [state, setState] = useState<FieldState>(() => parse(initialData ?? ""));

  useEffect(() => {
    setState(parse(initialData ?? ""));
  }, [initialData, open]);

  const update = (key: keyof FieldState, value: string) =>
    setState((prev) => ({ ...prev, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Preencher Dados do Cliente</DialogTitle>
          <DialogDescription>
            Dados completos de <strong>{clientName}</strong> — este campo é livre
            e não substitui nome e telefone.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
          {FIELDS.map((f) => (
            <div
              key={f.key}
              className={
                f.key === "nome" || f.key === "endereco" || f.key === "complemento"
                  ? "sm:col-span-2 space-y-1.5"
                  : "space-y-1.5"
              }
            >
              <Label htmlFor={`cd-${f.key}`}>{f.label}</Label>
              <Input
                id={`cd-${f.key}`}
                value={state[f.key]}
                onChange={(e) => update(f.key, e.target.value)}
                placeholder={f.placeholder}
              />
            </div>
          ))}
          <div className="sm:col-span-2 space-y-1.5">
            <Label htmlFor="cd-observacoes">Observações</Label>
            <Textarea
              id="cd-observacoes"
              value={state.observacoes}
              onChange={(e) => update("observacoes", e.target.value)}
              placeholder="Informações adicionais"
              className="min-h-24"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onSave(serialize(state));
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
