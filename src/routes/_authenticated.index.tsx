import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { OnePageBody } from "@/components/one-page";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Star Games — Gestão Operacional" },
      { name: "description", content: "Dashboard, clientes, cobranças e importação em uma única página." },
      { property: "og:title", content: "Star Games — Gestão Operacional" },
      { property: "og:description", content: "Sistema operacional one-page." },
    ],
  }),
  component: OnePage,
});

function OnePage() {
  return (
    <AppLayout>
      <div>TESTE</div>
    </AppLayout>
  );
}
