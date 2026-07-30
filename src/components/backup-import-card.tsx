import { useState } from "react";
import { Archive, FlaskConical, ShieldCheck, Upload } from "lucide-react";
import { Card } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RestoreBackupModal } from "@/components/restore-backup-modal";
import { useSandbox } from "@/lib/use-sandbox";

/**
 * Importação exclusiva a partir de um backup Star Games (.zip).
 * O ambiente de destino é decidido no servidor: estando no Modo Teste, todos os
 * registros recebem novos identificadores e ficam isolados da produção.
 */
export function BackupImportCard() {
  const { state } = useSandbox();
  const [open, setOpen] = useState<null | "existing" | "upload">(null);
  const sandbox = state.active;

  return (
    <>
      <Card>
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Archive className="size-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Importar de backup (ZIP)</h3>
                <p className="max-w-prose text-xs text-muted-foreground">
                  Carrega todos os dados a partir de um backup completo do sistema —
                  clientes, produtos, MGMV, parcelas, notas fiscais e equipe.
                </p>
              </div>
            </div>
            <Badge variant={sandbox ? "default" : "secondary"} className="gap-1">
              {sandbox ? <FlaskConical className="size-3" /> : <ShieldCheck className="size-3" />}
              Destino: {sandbox ? "SANDBOX" : "PRODUÇÃO"}
            </Badge>
          </div>

          <div
            className={
              sandbox
                ? "rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300"
                : "rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground"
            }
          >
            {sandbox
              ? "Você está no Modo Teste. Todos os registros importados recebem novos identificadores e ficam isolados — a produção não é alterada em nenhuma hipótese."
              : "Você está na produção. Os dados do backup serão gravados no ambiente real."}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setOpen("upload")}>
              <Upload className="size-4" />
              Enviar ZIP (até 500 MB)
            </Button>
            <Button variant="outline" onClick={() => setOpen("existing")}>
              <Archive className="size-4" />
              Usar backup salvo
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Padrão: mesclar (mantém o que já existe). "Substituir tudo" apaga apenas o
            ambiente de destino. Usuários, papéis e auditoria nunca são alterados em teste.
          </p>
        </div>
      </Card>

      {open && (
        <RestoreBackupModal open onClose={() => setOpen(null)} initialSource={open} />
      )}
    </>
  );
}
