import { createFileRoute, Outlet, redirect, isRedirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { PermissionsProvider } from "@/lib/use-permissions";
import { SessionGuard } from "@/components/session-guard";
import { getMaintenanceState } from "@/lib/maintenance.functions";
import {
  BACKUP_LOCK_ACTIVE,
  BackupLockModal,
  isBackupLockAllowed,
} from "@/components/backup-lock-modal";

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
      if (isRedirect(err)) throw err;
    }

    const backupLocked = BACKUP_LOCK_ACTIVE && !isBackupLockAllowed(data.user.email);
    return { user: data.user, backupLocked };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { backupLocked } = Route.useRouteContext();
  // Bloqueado: não monta o painel (nenhum dado é carregado).
  if (backupLocked) return <BackupLockModal />;
  return (
    <PermissionsProvider>
      <SessionGuard>
        <Outlet />
      </SessionGuard>
    </PermissionsProvider>
  );
}
