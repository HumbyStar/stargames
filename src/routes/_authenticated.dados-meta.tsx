import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { DadosMetaSection } from "@/sections/dados-meta-section";

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
  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-[1400px] px-4 pb-10 pt-[96px]">
        <DadosMetaSection />
      </div>
    </AppLayout>
  );
}
