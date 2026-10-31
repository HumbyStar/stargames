import { useEffect, useState } from "react";
import { DatabaseBackup, Clock } from "lucide-react";
import { Progress } from "@/components/ui/progress";

/** Bloqueio temporário: só este e-mail entra. Para desativar, mude BACKUP_LOCK_ACTIVE para false. */
export const BACKUP_LOCK_ACTIVE = false;
export const BACKUP_LOCK_ALLOWED = "joaovittormkt";
const STARTED_AT = new Date("2026-10-30T20:20:00Z").getTime();
const DURATION_MS = 60 * 60 * 1000;

export function isBackupLockAllowed(email: string | null | undefined) {
  return Boolean(email && email.toLowerCase().includes(BACKUP_LOCK_ALLOWED));
}

export function BackupLockModal() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = Math.max(0, now - STARTED_AT);
  const pct = Math.min(99, Math.max(3, Math.round((elapsed / DURATION_MS) * 100)));
  const remainingMin = Math.max(1, Math.ceil((DURATION_MS - elapsed) / 60000));

  return (
    <div
      translate="no"
      role="alertdialog"
      aria-modal="true"
      className="fixed inset-0 z-[9999] grid place-items-center bg-background/95 px-4 backdrop-blur"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-xl">
        <DatabaseBackup className="mx-auto mb-3 size-10 animate-pulse text-primary" />
        <h1 className="text-lg font-semibold">Atualizações no banco de dados</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          O sistema está passando por atualizações no banco de dados. O acesso está
          temporariamente bloqueado para garantir a segurança das informações.
        </p>
        <div className="mt-5 text-left">
          <div className="mb-2 flex justify-between text-sm font-medium">
            <span>Backup em progresso</span>
            <span>{pct}%</span>
          </div>
          <Progress value={pct} />
          <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" />
            Tempo estimado: 1 hora · restam cerca de {remainingMin} min
          </div>
        </div>
      </div>
    </div>
  );
}
