import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { Card, PageHeader } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Configurações — Star Games" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <AppLayout>
      <PageHeader title="Configurações" description="Preferências do sistema." />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Dados locais">
          <p className="text-sm text-muted-foreground">
            Os dados são armazenados localmente no navegador. Você pode limpar tudo abaixo.
          </p>
          <div className="mt-4">
            <Button
              variant="destructive"
              onClick={() => {
                localStorage.removeItem("star-games-store");
                useStore.persist?.clearStorage?.();
                toast.success("Dados locais limpos. Recarregue a página.");
              }}
            >
              Limpar dados
            </Button>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}