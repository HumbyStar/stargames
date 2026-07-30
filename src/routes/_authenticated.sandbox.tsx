import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { FlaskConical, Loader2, ShieldCheck } from "lucide-react";
import { AppLayout } from "@/components/app-layout";
import { OnePageBody } from "@/components/one-page";
import { useSandbox } from "@/lib/use-sandbox";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/sandbox")({
  head: () => ({
    meta: [
      { title: "Modo Teste (Sandbox) — Star Games" },
      {
        name: "description",
        content:
          "Ambiente isolado de testes com uma cópia dos dados. Nada feito aqui altera a produção.",
      },
      { property: "og:title", content: "Modo Teste (Sandbox) — Star Games" },
      {
        property: "og:description",
        content: "Ambiente isolado para testar importações, backups e edições sem risco.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SandboxPage,
});

function SandboxPage() {
  return (
    <AppLayout>
      <SandboxGate />
    </AppLayout>
  );
}

function SandboxGate() {
  const { state, loading, setActive } = useSandbox();
  const navigate = useNavigate();
  const [entering, setEntering] = useState(false);
  const enteredRef = useRef(false);

  // Ao abrir a página, o ambiente de teste é ativado. Ao sair, é desligado —
  // assim nunca fica ligado por acidente na navegação normal.
  useEffect(() => {
    if (loading || !state.isAdmin || state.active || enteredRef.current) return;
    enteredRef.current = true;
    setEntering(true);
    void setActive(true).finally(() => setEntering(false));
  }, [loading, state.isAdmin, state.active, setActive]);

  useEffect(() => {
    return () => {
      if (enteredRef.current) void setActive(false);
    };
  }, [setActive]);

  if (loading || entering) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        Preparando o ambiente de teste…
      </div>
    );
  }

  if (!state.isAdmin) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 text-center">
        <ShieldCheck className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          O ambiente de teste está disponível apenas para administradores.
        </p>
        <Button variant="outline" onClick={() => void navigate({ to: "/" })}>
          Voltar para a produção
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-dashed border-amber-500/50 bg-amber-500/[0.03] p-3 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-500/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400">
            <FlaskConical className="size-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
              MODO TESTE — produção intocada
            </p>
            <p className="text-xs text-muted-foreground">
              Importar, editar, apagar e gerar backup aqui não altera nenhum dado real.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void navigate({ to: "/" })}>
          Sair do Modo Teste
        </Button>
      </div>
      <OnePageBody />
    </div>
  );
}
