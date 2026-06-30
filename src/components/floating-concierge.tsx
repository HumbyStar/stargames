import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useUiStore } from "@/lib/ui-store";
import { useStore } from "@/lib/store";
import { usePriorityAlert, conciergePrefs } from "@/lib/concierge-priority";
import mascotAsset from "@/assets/tutorial-mascot.svg.asset.json";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const TONE_BADGE: Record<string, string> = {
  danger: "bg-destructive text-destructive-foreground",
  warning: "bg-amber-500 text-white",
  success: "bg-emerald-500 text-white",
  neutral: "bg-muted text-foreground",
};

/**
 * Botão flutuante do Concierge Operacional.
 * - Mostra a logo/mascote
 * - Badge com contagem da prioridade atual
 * - Faz auto-open ao montar (se permitido)
 */
export function FloatingConcierge() {
  const hydrated = useStore((s) => s.hydrated);
  const open = useUiStore((s) => s.openConcierge);
  const conciergeOpen = useUiStore((s) => s.conciergeOpen);
  const importOpen = useUiStore((s) => s.importOpen);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const helpOpen = useUiStore((s) => s.helpOpen);
  const notificationsOpen = useUiStore((s) => s.notificationsOpen);
  const navigate = useNavigate();

  const alert = usePriorityAlert();
  const triedRef = useRef(false);

  // Auto-abre depois que os dados oficiais estiverem prontos (1x por sessão).
  useEffect(() => {
    if (!hydrated) return;
    if (triedRef.current) return;
    if (importOpen) return; // não interromper processo de importação
    triedRef.current = true;
    if (!conciergePrefs.isAutoOpenAllowed()) return;
    // pequena espera para suavizar entrada
    const t = setTimeout(() => {
      open();
      conciergePrefs.markOpened();
    }, 350);
    return () => clearTimeout(t);
  }, [hydrated, importOpen, open]);

  const blocked = importOpen; // não abrir durante importação crítica
  const otherModalOpen =
    settingsOpen || helpOpen || notificationsOpen;

  if (conciergeOpen) return null;

  const tooltip =
    alert.count > 0
      ? `${alert.count} ${alert.cardId === "pending" ? "cobranças" : alert.cardId === "overdue-reservations" ? "reservas" : alert.cardId === "mgmv-overdue" ? "acordos MGMV" : "itens"} precisam de atenção`
      : "Abrir Concierge Operacional";

  const handleClick = () => {
    if (blocked) {
      toast.info("Importação em andamento. Aguarde para abrir o Concierge.");
      return;
    }
    if (otherModalOpen) {
      toast.info("Feche o modal atual para abrir o Concierge.");
      return;
    }
    conciergePrefs.markOpened();
    navigate({ to: "/nikostart" });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Abrir Concierge Operacional"
      title={tooltip}
      style={{
        bottom: "max(16px, env(safe-area-inset-bottom, 16px))",
      }}
      className={cn(
        "fixed right-4 md:right-6 z-40",
        "group transition-all duration-300 hover:-translate-y-1 active:scale-95",
        alert.count > 0 && "animate-pulse-soft",
      )}
    >
      <img
        src={mascotAsset.url}
        alt=""
        draggable={false}
        className="size-12 md:size-14 rounded-full object-cover shadow-xl ring-2 ring-primary/30 transition-all duration-300 group-hover:shadow-2xl group-hover:ring-primary/60"
      />
      {alert.count > 0 && (
        <span
          className={cn(
            "absolute -top-1 -right-1 grid min-w-[20px] h-5 px-1 place-items-center rounded-full text-[11px] font-bold shadow-md ring-2 ring-background",
            TONE_BADGE[alert.tone] ?? TONE_BADGE.danger,
          )}
        >
          {alert.count > 99 ? "99+" : alert.count}
        </span>
      )}
    </button>
  );
}