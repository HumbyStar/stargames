import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import mascotAsset from "@/assets/tutorial-mascot.svg.asset.json";
import { Wrench, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/manutencao")({
  head: () => ({
    meta: [
      { title: "Manutenção — Star Games" },
      {
        name: "description",
        content: "O sistema está em manutenção. Voltaremos em breve.",
      },
    ],
  }),
  component: ManutencaoPage,
});

function ManutencaoPage() {
  // Admins podem voltar ao painel — oferecemos o atalho. Não há gate aqui:
  // a rota é pública propositalmente, só exibe a mensagem.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        // Mantém a sessão aquecida para o admin poder retornar direto.
      }
    });
  }, []);

  return (
    <div
      className="grid min-h-screen place-items-center bg-gradient-to-b from-background via-background to-accent/30 px-4"
      translate="no"
    >
      <div className="w-full max-w-md text-center">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-[-12px] rounded-full bg-[radial-gradient(circle_at_center,color-mix(in_oklch,var(--color-primary)_45%,transparent)_0%,transparent_70%)] blur-xl"
            />
            <img
              src={mascotAsset.url}
              alt="Mascote Star Games"
              draggable={false}
              className="relative size-24 rounded-full object-cover ring-2 ring-primary/40 shadow-xl"
            />
          </div>
          <div className="flex items-center gap-2 text-primary">
            <Wrench className="size-5" />
            <h1 className="text-xl font-semibold tracking-tight">Manutenção em andamento</h1>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card/80 p-6 shadow-xl backdrop-blur">
          <p className="text-sm text-muted-foreground">
            Estamos migrando o banco de dados para servir você melhor. O sistema
            volta em instantes — não é necessário recarregar a página.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Se você é administrador, pode continuar acessando o painel normalmente.
          </p>

          <div className="mt-6">
            <Link
              to="/"
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Tentar entrar no painel
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">Star Games — Gestão Operacional</p>
      </div>
    </div>
  );
}
