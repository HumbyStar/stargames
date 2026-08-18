import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStore } from "@/lib/store";
import { defaultShipOrigin, isShipOriginComplete, type ShipOrigin } from "@/lib/ship-origin";
import { useSuperfreteBalance } from "@/lib/use-superfrete-balance";
import { formatCents } from "@/lib/shipping-quotes";

const FIELDS: Array<[keyof ShipOrigin, string]> = [
  ["name", "Nome do remetente"],
  ["document", "CPF/CNPJ"],
  ["phone", "Telefone"],
  ["email", "E-mail"],
  ["postalCode", "CEP de origem"],
  ["street", "Endereço"],
  ["number", "Número"],
  ["complement", "Complemento"],
  ["district", "Bairro"],
  ["city", "Cidade"],
  ["state", "UF"],
];

/** Origem usada nas cotações e etiquetas da SuperFrete. */
export function ShippingOriginCard() {
  const origin = useStore((s) => s.preferences.shipOrigin) ?? defaultShipOrigin;
  const setPreferences = useStore((s) => s.setPreferences);
  const [draft, setDraft] = useState<ShipOrigin>({ ...defaultShipOrigin, ...origin });
  const { balance, loading, refresh } = useSuperfreteBalance(true);

  useEffect(() => {
    setDraft({ ...defaultShipOrigin, ...origin });
  }, [origin]);

  const complete = isShipOriginComplete(draft);

  return (
    <Card
      title="Origem do envio (SuperFrete)"
      action={
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            Saldo SuperFrete:{" "}
            <strong className="tabular-nums">
              {loading && !balance
                ? "…"
                : balance?.balanceCents != null
                  ? formatCents(balance.balanceCents)
                  : "indisponível"}
            </strong>
          </span>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void refresh()}>
            Atualizar
          </Button>
        </span>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">
        Estes dados são enviados como remetente nas cotações e etiquetas da SuperFrete.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map(([key, label]) => (
          <div key={key}>
            <Label className="text-xs">{label}</Label>
            <Input
              value={draft[key]}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
              className="h-9"
            />
          </div>
        ))}
      </div>
      {!complete && (
        <p className="mt-3 text-xs text-destructive">
          Preencha nome, telefone, CEP, endereço, número, cidade e UF para liberar o cálculo de
          frete.
        </p>
      )}
      <div className="mt-4 flex justify-end">
        <Button
          onClick={() => {
            setPreferences({ shipOrigin: draft });
            toast.success("Origem de envio salva.");
          }}
        >
          Salvar origem
        </Button>
      </div>
    </Card>
  );
}
