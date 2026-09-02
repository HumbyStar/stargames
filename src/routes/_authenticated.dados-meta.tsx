import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { DadosMetaSection } from "@/sections/dados-meta-section";
import { SegmentacaoSection } from "@/sections/segmentacao-section";

export const Route = createFileRoute("/_authenticated/dados-meta")({
  head: () => ({
    meta: [
      { title: "Dados Meta — Extração de leads | Star Games" },
      {
        name: "description",
        content:
          "Filtre a base de clientes por região, valor comprado e perfil e exporte listas prontas para campanhas no Meta Business.",
      },
      { property: "og:title", content: "Dados Meta — Extração de leads | Star Games" },
      {
        property: "og:description",
        content:
          "Extração filtrada de clientes para públicos personalizados do Meta Business, com controle de ficha completa.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DadosMetaPage,
});

function DadosMetaPage() {
  const [mode, setMode] = useState<"meta" | "segmentacao">("meta");

  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-[1400px] px-4 pb-10 pt-[96px]">
        <div className="mb-4 inline-flex rounded-xl border bg-muted/40 p-1">
          {(
            [
              { key: "meta", label: "Dados Meta" },
              { key: "segmentacao", label: "Segmentação de clientes" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setMode(t.key)}
              className={
                "rounded-lg px-3 py-1.5 text-sm font-medium transition " +
                (mode === t.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        {mode === "meta" ? <DadosMetaSection /> : <SegmentacaoSection />}
      </div>
    </AppLayout>
  );
}
