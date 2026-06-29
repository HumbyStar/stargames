import { Brain, Box, CheckCircle2, FileText, Folder, Layers, ShieldCheck, Sparkles, User } from "lucide-react";

const STAGES = [
  { icon: FileText, label: "Arquivo" },
  { icon: Folder, label: "Pasta" },
  { icon: Layers, label: "HTML" },
  { icon: User, label: "Cliente" },
  { icon: Box, label: "Produto" },
  { icon: ShieldCheck, label: "MGMV" },
  { icon: CheckCircle2, label: "Validação" },
  { icon: Brain, label: "IA" },
  { icon: Sparkles, label: "Preview" },
];

/**
 * Esteira contínua: loop infinito enquanto `running`. A animação NÃO para
 * no meio do processamento — só termina ao concluir/cancelar.
 */
export function ImportConveyor({
  running,
  state,
  height = "h-24",
}: {
  running: boolean;
  state: "processing" | "done" | "cancelled";
  height?: string;
}) {
  const items = [...STAGES, ...STAGES, ...STAGES]; // triplo para loop suave
  return (
    <div className={`relative ${height} overflow-hidden rounded-xl border bg-gradient-to-b from-muted/40 to-muted/10`}>
      {/* Trilho */}
      <div className="absolute inset-x-0 bottom-4 h-2 rounded bg-foreground/10" />
      <div className="absolute inset-x-0 bottom-4 h-2 overflow-hidden rounded">
        <div
          className="h-full w-[200%] opacity-60"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, hsl(var(--foreground)/0.15) 0 10px, transparent 10px 20px)",
            animation: running ? "import-belt 1.2s linear infinite" : undefined,
          }}
        />
      </div>

      {/* Ícones em movimento */}
      <div className="absolute inset-x-0 top-3 bottom-9 flex items-center">
        <div
          className="flex gap-8 px-4 will-change-transform motion-reduce:animate-none"
          style={{
            animation: running ? "import-load 18s linear infinite" : undefined,
          }}
        >
          {items.map((s, i) => {
            const Icon = s.icon;
            return (
              <div
                key={i}
                className="flex flex-col items-center gap-1.5 text-xs text-muted-foreground"
              >
                <div className="grid h-14 w-14 place-items-center rounded-lg border bg-card shadow-xs text-primary">
                  <Icon className="h-7 w-7" />
                </div>
                <span className="whitespace-nowrap">{s.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Estado final */}
      {state === "done" && (
        <div className="absolute inset-0 grid place-items-center bg-background/70 backdrop-blur-sm animate-fade-in">
          <div className="flex items-center gap-2 rounded-full border bg-emerald-500/10 px-4 py-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            Importação analisada com sucesso
          </div>
        </div>
      )}
      {state === "cancelled" && (
        <div className="absolute inset-0 grid place-items-center bg-background/70 backdrop-blur-sm animate-fade-in">
          <div className="rounded-full border bg-muted px-4 py-1.5 text-sm text-muted-foreground">
            Importação cancelada
          </div>
        </div>
      )}

      <style>{`
        @keyframes import-belt {
          0% { transform: translateX(0); }
          100% { transform: translateX(-20px); }
        }
        @keyframes import-load {
          0% { transform: translateX(0); }
          100% { transform: translateX(-33.3333%); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="import-load"], [style*="import-belt"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}