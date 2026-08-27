import { PageHeader } from "@/components/ui-bits";
import { TeamPunch } from "@/components/team-punch";
import { usePermissions } from "@/lib/use-permissions";

/**
 * Seção Equipe — enxuta para o MVP.
 * O quadro Kanban, tarefas e o painel de desempenho foram removidos para
 * reduzir consultas ao banco. As tabelas e dados continuam intactos.
 */
export function EquipeSection() {
  const { hasPermission, access } = usePermissions();

  if (!hasPermission("team.view") && !access?.roles.length) {
    return (
      <section id="equipe" className="one-page-section">
        <PageHeader title="Equipe" description="Você não tem permissão para visualizar esta seção." />
      </section>
    );
  }

  return (
    <section id="equipe" className="one-page-section">
      <PageHeader title="Equipe" description="Registro de ponto da equipe." />
      <div className="mt-4">
        <TeamPunch />
      </div>
    </section>
  );
}
