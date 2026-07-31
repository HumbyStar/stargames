import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { PermissionsProvider } from "@/lib/use-permissions";
import { SessionGuard } from "@/components/session-guard";
import { getMaintenanceState } from "@/lib/maintenance.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth" });
    }

    // Modo Manutenção: bloqueia usuários que não sejam admin / admin_master.
    // Fail-open em caso de erro de rede — o SessionGuard reconfirma em 30s.
    try {
      const maintenance = await getMaintenanceState();
      if (maintenance.active && !maintenance.isAdmin) {
        throw redirect({ to: "/manutencao" });
      }
    } catch (err) {
      // Redirecionamentos (redirect para /manutencao) lançam — devemos propagar.
      const isRedirect =
        err instanceof Error &&
        (err.message.includes("redirect") || (err as any)?.status === 300);
      if (isRedirect) throw err;
      // erro transient: segue o fluxo normal, guard revalida depois.
    }

    return { user: data.user };
  },
  component: () => (
    <PermissionsProvider>
      <SessionGuard>
        <Outlet />
      </SessionGuard>
    </PermissionsProvider>
  ),
});
