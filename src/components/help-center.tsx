import { Clock, PlayCircle, CheckCircle2, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/lib/ui-store";
import { TUTORIALS, useTutorialProgress } from "@/lib/tutorials";

export function HelpCenter() {
  const startTutorial = useUiStore((s) => s.startTutorial);
  const closeHelp = useUiStore((s) => s.closeHelp);
  const { progress } = useTutorialProgress();

  const handleStart = (id: string) => {
    closeHelp();
    // pequeno delay para o modal fechar antes do overlay aparecer
    setTimeout(() => startTutorial(id), 80);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Central de Ajuda</h2>
        <p className="text-sm text-muted-foreground">
          Aprenda a usar as principais áreas do sistema com guias visuais passo a passo.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {TUTORIALS.map((t) => {
          const status = progress[t.id]?.status;
          return (
            <div
              key={t.id}
              className="flex flex-col gap-2 rounded-2xl border border-border bg-card/60 p-4 transition hover:border-primary/40 hover:bg-card"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold leading-tight">{t.title}</h3>
                {status === "completed" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
                    <CheckCircle2 className="size-3" /> Concluído
                  </span>
                )}
                {status === "skipped" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    <SkipForward className="size-3" /> Pulado
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t.description}</p>
              <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="size-3" /> {t.estimatedTime}
                </span>
                <Button size="sm" onClick={() => handleStart(t.id)}>
                  <PlayCircle className="size-3.5" /> Iniciar tutorial
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
