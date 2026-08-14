import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  HardDrive,
  History,
  KeyRound,
  LayoutGrid,
  Navigation,
  Save,
  ShieldCheck,
  ShieldAlert,
  Sliders,
  Sun,
  Trash2,
  Users,
  UserCog,
  AlertTriangle,
  CheckCircle2,
  Brain,
  LogOut,
  HelpCircle,
} from "lucide-react";
import { MonitorDown } from "lucide-react";
import { Activity } from "lucide-react";
import { Github } from "lucide-react";
import { DatabaseZap } from "lucide-react";
import { Card, PageHeader, Tag } from "@/components/ui-bits";
import { AiTrainingModal } from "@/components/ai-training-modal";
import { Button } from "@/components/ui/button";
import { AccessManagementDialog } from "@/components/access-management";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useStore,
  formatDateBR,
  type DangerAction,
  type ImportStatus,
  type ImportDiagnostics,
} from "@/lib/store";
import { useUiStore } from "@/lib/ui-store";
import { NotificationsPrefsCard } from "@/components/notifications-prefs-card";
import { NavbarSettingsCard } from "@/components/navbar-settings-card";
import { BackupsPanel } from "@/components/backups-panel";
import { SandboxSettingsCard } from "@/components/sandbox-settings-card";
import { SandboxAuditCard } from "@/components/sandbox-audit-card";
import { LocalInstallCard } from "@/components/local-install-card";
import { GithubCard } from "@/components/github-card";
import { RestoreBackupModal } from "@/components/restore-backup-modal";
import { DbMigrationCard } from "@/components/db-migration-card";
import { RealtimeUpdatesCard } from "@/components/realtime-updates-card";
import { MaintenanceCard } from "@/components/maintenance-card";
import { ShippingOriginCard } from "@/components/shipping-origin-card";
import { ImportContentModal } from "@/components/import-content-modal";
import type { ImportHistoryEntry } from "@/lib/store";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Wrench } from "lucide-react";
import { Package } from "lucide-react";
import { ProductsCatalogModal } from "@/components/products-catalog-modal";

type View =
  | "home"
  | "import"
  | "rules"
  | "preferences"
  | "security"
  | "notifications"
  | "navbar"
  | "history"
  | "duplicates"
  | "backups"
  | "sandbox"
  | "local"
  | "activity"
  | "github"
  | "migration"
  | "shipping"
  | "maintenance"
  | "danger";

function DiagBox({
  label,
  value,
  status = "default",
}: {
  label: string;
  value: number | string;
  status?: "default" | "warning" | "danger";
}) {
  const ring =
    status === "danger"
      ? "border-destructive/50"
      : status === "warning"
        ? "border-amber-500/40"
        : "border-border/60";
  return (
    <div className={`min-w-0 rounded-md border ${ring} bg-card/50 px-3 py-2`}>
      <div className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

const dangerCatalog: Record<DangerAction, { title: string; description: string; cta: string }> = {
  deleteImportedData: {
    title: "Excluir dados importados",
    description: "Remove o histórico de importações. Clientes e produtos permanecem intactos.",
    cta: "Excluir importações",
  },
  deleteAllClients: {
    title: "Excluir todos os clientes",
    description:
      "Remove permanentemente todos os clientes cadastrados e os produtos vinculados a eles.",
    cta: "Excluir clientes",
  },
  deleteAllProducts: {
    title: "Excluir todos os produtos",
    description: "Remove permanentemente todos os produtos cadastrados. Os clientes permanecem.",
    cta: "Excluir produtos",
  },
  resetSystem: {
    title: "Resetar sistema",
    description:
      "Remove clientes, produtos, importações e restaura todas as configurações para o padrão.",
    cta: "Resetar sistema",
  },
};

const statusVariant: Record<ImportStatus, "success" | "warning" | "danger" | "neutral"> = {
  Concluído: "success",
  "Com avisos": "warning",
  Erro: "danger",
  Cancelado: "neutral",
};

function FieldRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function downloadFile(name: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function toCSV(rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join(
    "\n",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cards do hub
// ─────────────────────────────────────────────────────────────────────────────

function PrimaryCard({
  icon: Icon,
  title,
  description,
  stats,
  actions,
  tone = "primary",
  onOpen,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  stats: Array<{ label: string; value: string | number; tone?: "default" | "warning" | "danger" }>;
  actions: Array<{
    label: string;
    onClick: () => void;
    variant?: "default" | "outline" | "secondary";
  }>;
  tone?: "primary" | "amber";
  onOpen: () => void;
}) {
  const toneRing =
    tone === "amber"
      ? "border-amber-500/30 bg-gradient-to-br from-amber-500/[0.08] via-card to-card"
      : "border-primary/30 bg-gradient-to-br from-primary/[0.08] via-card to-card";
  const toneIcon =
    tone === "amber" ? "bg-amber-500/15 text-amber-500" : "bg-primary/15 text-primary";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex w-full flex-col gap-4 rounded-2xl border p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.99]",
        toneRing,
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("grid size-11 shrink-0 place-items-center rounded-xl", toneIcon)}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {stats.map((s) => (
          <DiagBox key={s.label} label={s.label} value={s.value} status={s.tone} />
        ))}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        {actions.map((a) => (
          <span
            key={a.label}
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              a.onClick();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                a.onClick();
              }
            }}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors cursor-pointer",
              a.variant === "default"
                ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                : a.variant === "secondary"
                  ? "border-border bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  : "border-border bg-background text-foreground hover:bg-accent",
            )}
          >
            {a.label}
          </span>
        ))}
      </div>
    </button>
  );
}

function SecondaryCard({
  icon: Icon,
  title,
  summary,
  status,
  onOpen,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  summary: string;
  status?: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full min-h-[112px] flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md active:scale-[0.99]"
    >
      <div className="flex items-center gap-2">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-4" />
        </div>
        <h4 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h4>
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="text-xs text-muted-foreground">{summary}</p>
      {status ? (
        <p className="mt-auto truncate text-[11px] font-medium text-foreground/70">{status}</p>
      ) : null}
    </button>
  );
}

function DiagChip({
  tone,
  label,
  onClick,
}: {
  tone: "danger" | "warning" | "info";
  label: string;
  onClick: () => void;
}) {
  const cls =
    tone === "danger"
      ? "border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/15"
      : tone === "warning"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300 hover:bg-amber-500/15"
        : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
        cls,
      )}
    >
      <AlertTriangle className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function ConfiguracoesSection() {
  const preferences = useStore((s) => s.preferences);
  const rules = useStore((s) => s.rules);
  const security = useStore((s) => s.security);
  const importHistory = useStore((s) => s.importHistory);
  const [contentEntry, setContentEntry] = useState<ImportHistoryEntry | null>(null);
  const clients = useStore((s) => s.clients);
  const products = useStore((s) => s.products);
  const setPreferences = useStore((s) => s.setPreferences);
  const setRules = useStore((s) => s.setRules);
  const setSecurity = useStore((s) => s.setSecurity);
  const executeDangerAction = useStore((s) => s.executeDangerAction);
  const fetchDiagnostics = useStore((s) => s.fetchDiagnostics);
  const clearImportCache = useStore((s) => s.clearImportCache);
  const findDuplicateClientGroups = useStore((s) => s.findDuplicateClientGroups);
  const mergeDuplicateClients = useStore((s) => s.mergeDuplicateClients);
  const refreshSnapshot = useStore((s) => s.refreshSnapshot);

  const openImportModal = useUiStore((s) => s.openImport);
  const closeSettings = useUiStore((s) => s.closeSettings);
  const openHelp = useUiStore((s) => s.openHelp);
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Sessão encerrada");
    navigate({ to: "/auth", replace: true });
  };

  const [view, setView] = useState<View>("home");
  const [diag, setDiag] = useState<ImportDiagnostics | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [aiTrainingOpen, setAiTrainingOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const duplicateGroups = findDuplicateClientGroups();

  const refreshDiag = async () => {
    setDiagLoading(true);
    try {
      const d = await fetchDiagnostics();
      setDiag(d);
    } catch (err) {
      console.error(err);
      toast.error("Não foi possível carregar o diagnóstico.");
    } finally {
      setDiagLoading(false);
    }
  };

  useEffect(() => {
    void refreshDiag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [prefDraft, setPrefDraft] = useState(preferences);
  const [rulesDraft, setRulesDraft] = useState(rules);
  useEffect(() => {
    setPrefDraft(preferences);
  }, [preferences]);
  useEffect(() => {
    setRulesDraft(rules);
  }, [rules]);

  const [dangerOpen, setDangerOpen] = useState(false);
  const [dangerAction, setDangerAction] = useState<DangerAction | null>(null);

  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreModalSource, setRestoreModalSource] = useState<"existing" | "upload">(
    "existing",
  );
  const [confirmText, setConfirmText] = useState("");

  const handleSavePrefs = () => {
    setPreferences(prefDraft);
    if (prefDraft.theme !== "system") {
      document.documentElement.classList.toggle("dark", prefDraft.theme === "dark");
      localStorage.setItem("theme", prefDraft.theme);
    } else {
      localStorage.removeItem("theme");
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.classList.toggle("dark", prefersDark);
    }
    toast.success("Preferências salvas com sucesso.");
  };

  const handleSaveRules = () => {
    setRules(rulesDraft);
    toast.success("Regras operacionais atualizadas.");
  };

  const openDanger = (action: DangerAction) => {
    setDangerAction(action);
    setConfirmText("");
    setDangerOpen(true);
  };

  const confirmDanger = async () => {
    if (!dangerAction || confirmText !== "EXCLUIR") return;
    await executeDangerAction(dangerAction);
    toast.success(`${dangerCatalog[dangerAction].title} concluída.`);
    setDangerOpen(false);
    setDangerAction(null);
    setConfirmText("");
  };

  const handleExport = (kind: "clientes" | "produtos" | "cobrancas") => {
    let csv = "";
    let filename = "";
    if (kind === "clientes") {
      csv = toCSV(
        clients.map((c) => ({
          id: c.id,
          nome: c.name,
          telefone: c.phone,
          observacoes: c.notes ?? "",
        })),
      );
      filename = "clientes.csv";
    } else if (kind === "produtos") {
      csv = toCSV(
        products.map((p) => ({
          id: p.id,
          cliente_id: p.clientId,
          produto: p.name,
          plataforma: p.platform,
          valor_total: p.totalValue,
          valor_pago: p.paidValue,
          status_financeiro: p.financialStatus,
          situacao: p.situation,
          cadastro: p.registerDate,
          vencimento: p.dueDate,
        })),
      );
      filename = "produtos.csv";
    } else {
      csv = toCSV(
        products
          .filter((p) => p.situation === "Em Aberto" && p.financialStatus !== "Pago")
          .map((p) => ({
            cliente_id: p.clientId,
            produto: p.name,
            valor_em_aberto: p.totalValue - p.paidValue,
            vencimento: p.dueDate,
            status: p.financialStatus,
          })),
      );
      filename = "cobrancas.csv";
    }
    downloadFile(filename, csv, "text/csv;charset=utf-8");
    toast.success(`Exportação de ${kind} iniciada.`);
  };

  const handleTemplate = (kind: "csv" | "excel") => {
    const headers =
      "nome,telefone,produto,plataforma,valor_total,valor_pago,status_financeiro,situacao,data_cadastro,data_vencimento";
    if (kind === "csv") {
      downloadFile("modelo_importacao.csv", headers + "\n", "text/csv;charset=utf-8");
    } else {
      downloadFile("modelo_importacao.xlsx.csv", headers + "\n", "text/csv;charset=utf-8");
    }
    toast.success("Modelo baixado.");
  };

  const lastImport = importHistory[0];
  const hasPreviewActive = (diag?.importProgressRows ?? 0) > 0;
  const hasMgmvInconsistency =
    (diag?.mgmvClientsWithoutAgreement ?? 0) > 0 || (diag?.mgmvProductsWithoutAgreementId ?? 0) > 0;
  const hasDuplicates = duplicateGroups.length > 0;
  const hasImportErrors = (lastImport?.errors ?? 0) > 0;

  const alerts = useMemo(() => {
    const arr: Array<{
      key: string;
      tone: "danger" | "warning";
      label: string;
      onClick: () => void;
    }> = [];
    if (hasPreviewActive)
      arr.push({
        key: "preview",
        tone: "warning",
        label: `Preview temporário de importação ativo (${diag?.importProgressRows ?? 0})`,
        onClick: () => setView("import"),
      });
    if (hasImportErrors)
      arr.push({
        key: "import-errors",
        tone: "danger",
        label: `Última importação com ${lastImport!.errors} erro(s)`,
        onClick: () => setView("history"),
      });
    if (hasDuplicates)
      arr.push({
        key: "dup",
        tone: "warning",
        label: `${duplicateGroups.length} grupo(s) de clientes duplicados`,
        onClick: () => setView("duplicates"),
      });
    if (hasMgmvInconsistency)
      arr.push({
        key: "mgmv",
        tone: "danger",
        label: "Inconsistência em MGMV (clientes/produtos sem acordo)",
        onClick: () => setView("import"),
      });
    return arr;
  }, [
    hasPreviewActive,
    hasImportErrors,
    hasDuplicates,
    hasMgmvInconsistency,
    diag,
    duplicateGroups,
    lastImport,
  ]);

  // Detalhe: header com botão voltar
  const DetailHeader = ({ title, description }: { title: string; description?: string }) => (
    <div className="mb-4 flex items-start gap-3">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setView("home")}
        className="shrink-0 gap-1.5"
      >
        <ArrowLeft className="size-4" /> Voltar
      </Button>
      <div className="min-w-0">
        <h2 className="truncate text-lg font-semibold">{title}</h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );

  return (
    <section id="configuracoes" className="one-page-section">
      {view === "home" && (
        <>
          <PageHeader
            title="Configurações"
            description="Visão operacional. Comece pelas duas configurações mais críticas no topo."
          />

          {/* Diagnóstico rápido */}
          <div className="mb-5 rounded-xl border border-border bg-card/50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <ShieldAlert className="size-4 text-amber-500 shrink-0" />
              <h3 className="text-sm font-semibold">Diagnóstico rápido</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={refreshDiag}
                disabled={diagLoading}
                className="ml-auto h-7 px-2 text-xs"
              >
                {diagLoading ? "Atualizando…" : "Atualizar"}
              </Button>
            </div>
            {alerts.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                Sistema sem alertas críticos de configuração.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {alerts.map((a) => (
                  <DiagChip key={a.key} tone={a.tone} label={a.label} onClick={a.onClick} />
                ))}
              </div>
            )}
          </div>

          {/* Cards principais */}
          <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PrimaryCard
              icon={Database}
              tone="primary"
              title="Importação e Dados"
              description="Base operacional do sistema. Erros aqui quebram Dashboard, MGMV e Collection."
              stats={[
                { label: "Clientes", value: diag?.clientsCount ?? clients.length },
                { label: "Produtos", value: diag?.productsCount ?? products.length },
                {
                  label: "Erros pendentes",
                  value: lastImport?.errors ?? 0,
                  tone: (lastImport?.errors ?? 0) > 0 ? "danger" : "default",
                },
                {
                  label: "Preview temp.",
                  value: hasPreviewActive ? "Ativo" : "Limpo",
                  tone: hasPreviewActive ? "warning" : "default",
                },
              ]}
              actions={[
                {
                  label: "Abrir importação",
                  variant: "default",
                  onClick: () => {
                    closeSettings();
                    setTimeout(() => openImportModal(), 0);
                  },
                },
                {
                  label: "Limpar cache temporário",
                  variant: "outline",
                  onClick: () => {
                    clearImportCache();
                    toast.success("Cache temporário limpo.");
                    void refreshDiag();
                  },
                },
                { label: "Ver diagnóstico", variant: "outline", onClick: () => setView("import") },
                { label: "Histórico", variant: "outline", onClick: () => setView("history") },
              ]}
              onOpen={() => setView("import")}
            />

            <PrimaryCard
              icon={Users}
              tone="amber"
              title="Usuários e Responsabilidades"
              description="Quem acessa, quem é admin e quem recebe tarefas do Concierge."
              stats={[
                { label: "Clientes ativos", value: clients.length },
                {
                  label: "Última importação",
                  value: lastImport ? formatDateBR(lastImport.date) : "—",
                },
                { label: "Auditoria", value: security.enableAuditLog ? "Ativa" : "Desligada" },
                {
                  label: "Confirmação delete",
                  value: security.requireConfirmBeforeDelete ? "Sim" : "Não",
                  tone: security.requireConfirmBeforeDelete ? "default" : "warning",
                },
              ]}
              actions={[
                {
                  label: "Gerenciar usuários",
                  variant: "default",
                  onClick: () => setAccessOpen(true),
                },
                {
                  label: "Definir responsabilidades",
                  variant: "outline",
                  onClick: () => setAccessOpen(true),
                },
                { label: "Ver permissões", variant: "outline", onClick: () => setAccessOpen(true) },
                { label: "Segurança", variant: "outline", onClick: () => setView("security") },
              ]}
              onOpen={() => setAccessOpen(true)}
            />
          </div>

          {/* Cards secundários */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SecondaryCard
              icon={Package}
              title="Produtos"
              summary="Catálogo completo, filtros por plataforma, relatórios e geração de NCM."
              onOpen={() => setProductsOpen(true)}
            />
            <SecondaryCard
              icon={Sun}
              title="Tema e aparência"
              summary="Modo claro/escuro, moeda, formato de data e tabelas compactas."
              status={`Tema: ${prefDraft.theme === "system" ? "Sistema" : prefDraft.theme === "dark" ? "Escuro" : "Claro"}`}
              onOpen={() => setView("preferences")}
            />
            <SecondaryCard
              icon={Sliders}
              title="Regras operacionais"
              summary="Prazo de reserva, bloqueios MGMV e regras de Collection."
              status={`Prazo padrão: ${rulesDraft.reservaDaysDefault} dias`}
              onOpen={() => setView("rules")}
            />
            <SecondaryCard
              icon={ShieldCheck}
              title="Segurança e Auditoria"
              summary="Confirmações, bloqueios em massa e log de auditoria."
              status={security.enableAuditLog ? "Auditoria ativa" : "Auditoria desligada"}
              onOpen={() => setView("security")}
            />
            <SecondaryCard
              icon={Bell}
              title="Notificações"
              summary="Alertas operacionais e preferências de aviso."
              onOpen={() => setView("notifications")}
            />
            <SecondaryCard
              icon={Navigation}
              title="Navbar"
              summary="Ordem dos ícones, ocultar itens e tempos de animação."
              onOpen={() => setView("navbar")}
            />
            <SecondaryCard
              icon={UserCog}
              title="Clientes duplicados"
              summary="Detecta e unifica clientes duplicados preservando produtos."
              status={hasDuplicates ? `${duplicateGroups.length} grupo(s)` : "Nenhum encontrado"}
              onOpen={() => setView("duplicates")}
            />
            <SecondaryCard
              icon={History}
              title="Histórico de importações"
              summary="Veja todas as importações já executadas."
              status={lastImport ? `Última: ${formatDateBR(lastImport.date)}` : "Nenhuma"}
              onOpen={() => setView("history")}
            />
            <SecondaryCard
              icon={LayoutGrid}
              title="Importação e Exportação"
              summary="Baixe modelos e exporte clientes, produtos e cobranças."
              onOpen={() => setView("import")}
            />
            <SecondaryCard
              icon={Trash2}
              title="Zona de perigo"
              summary="Ações irreversíveis: limpar bases, resetar sistema."
              status="Use com cuidado"
              onOpen={() => setView("danger")}
            />
            <SecondaryCard
              icon={HardDrive}
              title="Backups do sistema"
              summary="Snapshot completo (.zip) com todos os dados e arquivos, manual ou agendado."
              status="Portabilidade total"
              onOpen={() => setView("backups")}
            />
            <SecondaryCard
              icon={FlaskConical}
              title="Modo Teste (Sandbox)"
              summary="Ambiente idêntico ao real para testar importações, edições e backups sem afetar a produção."
              status="Somente admin"
              onOpen={() => setView("sandbox")}
            />
            <SecondaryCard
              icon={MonitorDown}
              title="Instalar sistema (Windows)"
              summary="Instala o sistema no computador com uma cópia atualizada dos dados para trabalhar mesmo sem internet."
              status="Offline"
              onOpen={() => setView("local")}
            />
            <SecondaryCard
              icon={Activity}
              title="Atualizações em tempo real"
              summary="Acompanhe ao vivo quem está editando, importando, gerando backups e alterando configurações."
              status="Ao vivo"
              onOpen={() => setView("activity")}
            />
            <SecondaryCard
              icon={Github}
              title="Conectar conta GitHub"
              summary="Publique backups, exports e o changelog do sistema em um repositório e libere acesso a quem precisar."
              status="Somente admin"
              onOpen={() => setView("github")}
            />
            <SecondaryCard
              icon={DatabaseZap}
              title="Migrar banco de dados"
              summary="Exporte estrutura e dados em pacotes prontos para Supabase, Neon, AWS, Firebase ou MongoDB — ideal para clonar o sistema para sócios."
              status="Somente admin"
              onOpen={() => setView("migration")}
            />
            <SecondaryCard
              icon={Truck}
              title="Envio / SuperFrete"
              summary="Remetente usado nas cotações e etiquetas da SuperFrete (ambiente Sandbox)."
              status="Sandbox"
              onOpen={() => setView("shipping")}
            />
            <SecondaryCard
              icon={Wrench}
              title="Modo Manutenção"
              summary="Bloqueia usuários comuns enquanto o banco é migrado para a nova conta Supabase. Admins continuam com acesso total."
              status="Somente admin"
              onOpen={() => setView("maintenance")}
            />
            <SecondaryCard
              icon={Brain}
              title="Treinar I.A"
              summary="Onboarding guiado + análise do sistema para gerar automações Python que reduzem o uso de IA."
              status="Modo CEO"
              onOpen={() => setAiTrainingOpen(true)}
            />
            <SecondaryCard
              icon={HelpCircle}
              title="Tutorial"
              summary="Central de ajuda e tutoriais guiados."
              onOpen={() => {
                closeSettings();
                setTimeout(() => openHelp(), 0);
              }}
            />
            <button
              type="button"
              onClick={handleSignOut}
              className="group flex w-full min-h-[112px] flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-destructive/30 hover:shadow-md active:scale-[0.99]"
            >
              <div className="flex items-center gap-2">
                <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
                  <LogOut className="size-4" />
                </div>
                <h4 className="min-w-0 flex-1 truncate text-sm font-semibold">Sair da conta</h4>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <p className="text-xs text-muted-foreground">Encerra a sessão atual de forma segura.</p>
            </button>
          </div>
        </>
      )}

      {view === "import" && (
        <>
          <DetailHeader title="Importação e Dados" description="Diagnóstico, exportação e cache." />

          <Card title="Diagnóstico da Importação" className="mb-4">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <DiagBox label="Clientes (banco)" value={diag?.clientsCount ?? "—"} />
                <DiagBox label="Produtos (banco)" value={diag?.productsCount ?? "—"} />
                <DiagBox
                  label="Acordos MGMV"
                  value={diag?.agreementsCount ?? "—"}
                  status={diag && diag.agreementsCount === 0 ? "warning" : "default"}
                />
                <DiagBox label="Parcelas MGMV" value={diag?.installmentsCount ?? "—"} />
              </div>

              <div className="grid gap-2 rounded-md border border-border/60 bg-card/50 p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>Clientes MGMV sem acordo oficial</span>
                  <Tag
                    variant={diag && diag.mgmvClientsWithoutAgreement > 0 ? "danger" : "success"}
                  >
                    {diag?.mgmvClientsWithoutAgreement ?? "—"}
                  </Tag>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>Produtos marcados MGMV sem mgmv_agreement_id</span>
                  <Tag
                    variant={diag && diag.mgmvProductsWithoutAgreementId > 0 ? "danger" : "success"}
                  >
                    {diag?.mgmvProductsWithoutAgreementId ?? "—"}
                  </Tag>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>Importações interrompidas (import_progress)</span>
                  <Tag variant={diag && diag.importProgressRows > 0 ? "warning" : "neutral"}>
                    {diag?.importProgressRows ?? "—"}
                  </Tag>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
                  <span>Versão do reset (cache)</span>
                  <code className="text-[10px]">{diag?.resetVersion || "—"}</code>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={refreshDiag} disabled={diagLoading}>
                  {diagLoading ? "Atualizando…" : "Atualizar diagnóstico"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    clearImportCache();
                    toast.success(
                      "Cache temporário da importação limpo. Dados oficiais preservados.",
                    );
                    void refreshDiag();
                  }}
                >
                  Limpar cache temporário
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    closeSettings();
                    setTimeout(() => openImportModal(), 0);
                  }}
                >
                  Abrir importação
                </Button>
              </div>
            </div>
          </Card>

          <Card title="Importação e Exportação">
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
              <Button
                variant="outline"
                onClick={() => handleTemplate("csv")}
                className="justify-start gap-2 min-h-11"
              >
                <FileText className="size-4" /> Baixar modelo CSV
              </Button>
              <Button
                variant="outline"
                onClick={() => handleTemplate("excel")}
                className="justify-start gap-2 min-h-11"
              >
                <FileSpreadsheet className="size-4" /> Baixar modelo Excel
              </Button>
              <Button
                variant="outline"
                onClick={() => handleExport("clientes")}
                className="justify-start gap-2 min-h-11"
              >
                <Download className="size-4" /> Exportar clientes
              </Button>
              <Button
                variant="outline"
                onClick={() => handleExport("produtos")}
                className="justify-start gap-2 min-h-11"
              >
                <Download className="size-4" /> Exportar produtos
              </Button>
              <Button
                variant="outline"
                onClick={() => handleExport("cobrancas")}
                className="justify-start gap-2 min-h-11"
              >
                <Download className="size-4" /> Exportar cobranças
              </Button>
              <Button
                variant="outline"
                onClick={() => setView("history")}
                className="justify-start gap-2 min-h-11"
              >
                <History className="size-4" /> Ver histórico
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setRestoreModalSource("existing");
                  setRestoreModalOpen(true);
                }}
                className="justify-start gap-2 min-h-11"
              >
                <Database className="size-4" /> Importar via backup
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setRestoreModalSource("upload");
                  setRestoreModalOpen(true);
                }}
                className="justify-start gap-2 min-h-11"
              >
                <HardDrive className="size-4" /> Importar ZIP externo
              </Button>
            </div>
          </Card>
        </>
      )}

      {view === "history" && (
        <>
          <DetailHeader title="Histórico de Importações" />
          <Card title="Histórico">
            {importHistory.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhuma importação registrada ainda.
              </p>
            ) : (
              <>
                {/* Mobile: cards */}
                <ul className="space-y-2 sm:hidden">
                  {importHistory.map((h) => (
                    <li key={h.id} className="rounded-lg border border-border bg-card/50 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{h.file}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(h.date).toLocaleString("pt-BR")} · {h.source}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {h.userEmail ?? "Usuário não identificado"}
                          </p>
                        </div>
                        <Tag variant={statusVariant[h.status]}>{h.status}</Tag>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Clientes</span>
                          <div className="font-semibold tabular-nums">{h.clientsCreated}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Produtos</span>
                          <div className="font-semibold tabular-nums">{h.productsAdded}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Erros</span>
                          <div
                            className={cn(
                              "font-semibold tabular-nums",
                              h.errors > 0 && "text-destructive",
                            )}
                          >
                            {h.errors}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 w-full"
                        onClick={() => setContentEntry(h)}
                      >
                        Ver texto
                      </Button>
                    </li>
                  ))}
                </ul>
                {/* Desktop: tabela */}
                <div className="hidden sm:block overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data e hora</TableHead>
                        <TableHead>Usuário</TableHead>
                        <TableHead>Origem</TableHead>
                        <TableHead>Arquivo</TableHead>
                        <TableHead className="text-right">Clientes</TableHead>
                        <TableHead className="text-right">Produtos</TableHead>
                        <TableHead className="text-right">Erros</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importHistory.map((h) => (
                        <TableRow key={h.id}>
                          <TableCell className="whitespace-nowrap">
                            {new Date(h.date).toLocaleString("pt-BR")}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {h.userEmail ?? "—"}
                          </TableCell>
                          <TableCell>{h.source}</TableCell>
                          <TableCell className="font-medium">{h.file}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {h.clientsCreated}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {h.productsAdded}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{h.errors}</TableCell>
                          <TableCell>
                            <Tag variant={statusVariant[h.status]}>{h.status}</Tag>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="outline" size="sm" onClick={() => setContentEntry(h)}>
                              Ver texto
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </Card>
          <ImportContentModal entry={contentEntry} onClose={() => setContentEntry(null)} />
        </>
      )}

      {view === "duplicates" && (
        <>
          <DetailHeader
            title="Clientes duplicados"
            description="Detecta e unifica clientes pelo telefone ou nome."
          />
          <Card title="Clientes duplicados">
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Detecta clientes com o mesmo telefone (ou mesmo nome quando o telefone está vazio) e
                unifica em um único cliente primário, preservando produtos, acordos MGMV e
                observações.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Tag variant={hasDuplicates ? "warning" : "success"}>
                  {duplicateGroups.length} grupo(s) duplicado(s)
                </Tag>
                <Tag variant="neutral">
                  {duplicateGroups.reduce((s, g) => s + g.duplicateIds.length, 0)} cliente(s) a
                  remover
                </Tag>
                <Tag variant="neutral">
                  {duplicateGroups.reduce((s, g) => s + g.productsToReassign, 0)} produto(s) a
                  reatribuir
                </Tag>
              </div>

              {hasDuplicates && (
                <div className="max-h-64 overflow-auto rounded-md border border-border/60 bg-card/50 p-2 text-xs">
                  <ul className="space-y-1">
                    {duplicateGroups.slice(0, 50).map((g) => (
                      <li key={g.key} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 truncate">
                          <strong>{g.name}</strong>{" "}
                          <span className="text-muted-foreground">
                            ({g.phone || "sem telefone"})
                          </span>
                        </span>
                        <span className="text-muted-foreground">
                          remove {g.duplicateIds.length} · move {g.productsToReassign} prod
                        </span>
                      </li>
                    ))}
                    {duplicateGroups.length > 50 && (
                      <li className="text-muted-foreground">
                        … e mais {duplicateGroups.length - 50} grupo(s)
                      </li>
                    )}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={!hasDuplicates || mergeBusy}
                  onClick={async () => {
                    if (!hasDuplicates) return;
                    const total = duplicateGroups.reduce((s, g) => s + g.duplicateIds.length, 0);
                    if (
                      !confirm(
                        `Unificar ${duplicateGroups.length} grupo(s)? ${total} cliente(s) duplicado(s) serão removidos e seus produtos/acordos reatribuídos. Esta ação não pode ser desfeita.`,
                      )
                    )
                      return;
                    setMergeBusy(true);
                    try {
                      const r = await mergeDuplicateClients();
                      toast.success(
                        `Unificação concluída: ${r.groups} grupo(s), ${r.removed} removido(s), ${r.reassignedProducts} produto(s) reatribuído(s).`,
                      );
                      await refreshSnapshot();
                      await refreshDiag();
                    } catch (err) {
                      console.error(err);
                      toast.error("Falha ao unificar duplicados.");
                    } finally {
                      setMergeBusy(false);
                    }
                  }}
                >
                  {mergeBusy ? "Unificando…" : "Unificar duplicados"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void refreshSnapshot()}>
                  Recarregar lista
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}

      {view === "preferences" && (
        <>
          <DetailHeader
            title="Tema e aparência"
            description="Preferências visuais e de formatação."
          />
          <Card title="Preferências do Sistema">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="company-name">Nome da empresa</Label>
                <Input
                  id="company-name"
                  value={prefDraft.companyName}
                  maxLength={80}
                  onChange={(e) => setPrefDraft({ ...prefDraft, companyName: e.target.value })}
                />
              </div>

              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Moeda padrão</Label>
                  <Select
                    value={prefDraft.currency}
                    onValueChange={(v) =>
                      setPrefDraft({ ...prefDraft, currency: v as typeof prefDraft.currency })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BRL">BRL — Real Brasileiro</SelectItem>
                      <SelectItem value="USD">USD — Dólar</SelectItem>
                      <SelectItem value="EUR">EUR — Euro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Formato de data</Label>
                  <Select
                    value={prefDraft.dateFormat}
                    onValueChange={(v) =>
                      setPrefDraft({ ...prefDraft, dateFormat: v as typeof prefDraft.dateFormat })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DD/MM/AAAA">DD/MM/AAAA</SelectItem>
                      <SelectItem value="AAAA-MM-DD">AAAA-MM-DD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background/40 px-3">
                <FieldRow
                  label="Modo compacto de tabelas"
                  description="Reduz o espaçamento das linhas."
                >
                  <Switch
                    checked={prefDraft.compactTables}
                    onCheckedChange={(v) => setPrefDraft({ ...prefDraft, compactTables: v })}
                  />
                </FieldRow>
                <FieldRow
                  label="Exibir alertas no Dashboard"
                  description="Mostra avisos operacionais no topo."
                >
                  <Switch
                    checked={prefDraft.showDashboardAlerts}
                    onCheckedChange={(v) => setPrefDraft({ ...prefDraft, showDashboardAlerts: v })}
                  />
                </FieldRow>
              </div>

              <div className="space-y-1.5">
                <Label>Tema da interface</Label>
                <Select
                  value={prefDraft.theme}
                  onValueChange={(v) =>
                    setPrefDraft({ ...prefDraft, theme: v as typeof prefDraft.theme })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Claro</SelectItem>
                    <SelectItem value="dark">Escuro</SelectItem>
                    <SelectItem value="system">Sistema</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSavePrefs} className="gap-2 min-h-11 w-full sm:w-auto">
                  <Save className="size-4" /> Salvar Preferências
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}

      {view === "rules" && (
        <>
          <DetailHeader
            title="Regras operacionais"
            description="Prazos, bloqueios e regras de Collection."
          />
          <Card title="Regras Operacionais">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reserva-days">Prazo padrão de reserva</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="reserva-days"
                    type="number"
                    min={1}
                    max={365}
                    value={rulesDraft.reservaDaysDefault}
                    onChange={(e) =>
                      setRulesDraft({
                        ...rulesDraft,
                        reservaDaysDefault: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className="w-28"
                  />
                  <span className="text-sm text-muted-foreground">dias</span>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background/40 px-3">
                <FieldRow label="Bloquear nova reserva para cliente com MGMV ativo">
                  <Switch
                    checked={rulesDraft.blockReserveOnActiveMGMV}
                    onCheckedChange={(v) =>
                      setRulesDraft({ ...rulesDraft, blockReserveOnActiveMGMV: v })
                    }
                  />
                </FieldRow>
                <FieldRow label="Ocultar desistências da Collection">
                  <Switch
                    checked={rulesDraft.hideDesistenciasFromCollection}
                    onCheckedChange={(v) =>
                      setRulesDraft({ ...rulesDraft, hideDesistenciasFromCollection: v })
                    }
                  />
                </FieldRow>
                <FieldRow label="Ocultar abandonos da Collection">
                  <Switch
                    checked={rulesDraft.hideAbandonosFromCollection}
                    onCheckedChange={(v) =>
                      setRulesDraft({ ...rulesDraft, hideAbandonosFromCollection: v })
                    }
                  />
                </FieldRow>
                <FieldRow label="Calcular vencimento automaticamente para Reserva">
                  <Switch
                    checked={rulesDraft.autoCalculateReservaDueDate}
                    onCheckedChange={(v) =>
                      setRulesDraft({ ...rulesDraft, autoCalculateReservaDueDate: v })
                    }
                  />
                </FieldRow>
                <FieldRow label="Considerar Pendente vencido como inadimplente">
                  <Switch
                    checked={rulesDraft.treatOverduePendenteAsDelinquent}
                    onCheckedChange={(v) =>
                      setRulesDraft({ ...rulesDraft, treatOverduePendenteAsDelinquent: v })
                    }
                  />
                </FieldRow>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveRules} className="gap-2 min-h-11 w-full sm:w-auto">
                  <Save className="size-4" /> Salvar Regras
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}

      {view === "security" && (
        <>
          <DetailHeader
            title="Segurança e Acesso"
            description="Confirmações, auditoria e gestão de usuários."
          />
          <Card title="Segurança e Acesso">
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-background/40 px-3">
                <FieldRow label="Exigir confirmação antes de excluir dados">
                  <Switch
                    checked={security.requireConfirmBeforeDelete}
                    onCheckedChange={(v) => setSecurity({ requireConfirmBeforeDelete: v })}
                  />
                </FieldRow>
                <FieldRow label="Bloquear exclusão em massa sem senha">
                  <Switch
                    checked={security.blockMassDeleteWithoutPassword}
                    onCheckedChange={(v) => setSecurity({ blockMassDeleteWithoutPassword: v })}
                  />
                </FieldRow>
                <FieldRow label="Ativar log de auditoria">
                  <Switch
                    checked={security.enableAuditLog}
                    onCheckedChange={(v) => setSecurity({ enableAuditLog: v })}
                  />
                </FieldRow>
              </div>

              <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
                <Button
                  variant="outline"
                  className="gap-2 justify-start min-h-11"
                  onClick={() => setAccessOpen(true)}
                >
                  <Users className="size-4" /> Gerenciar usuários
                </Button>
                <Button
                  variant="outline"
                  className="gap-2 justify-start min-h-11"
                  onClick={() => setAccessOpen(true)}
                >
                  <KeyRound className="size-4" /> Alterar senha administrativa
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}

      {view === "notifications" && (
        <>
          <DetailHeader title="Notificações" />
          <NotificationsPrefsCard />
        </>
      )}

      {view === "navbar" && (
        <>
          <DetailHeader
            title="Navbar"
            description="Reordenar ícones, ocultar itens e ajustar animações."
          />
          <NavbarSettingsCard />
        </>
      )}

      {view === "backups" && (
        <>
          <DetailHeader
            title="Backups do sistema"
            description="Gere e agende snapshots completos e portáveis do sistema."
          />
          <BackupsPanel />
        </>
      )}

      {view === "sandbox" && (
        <>
          <DetailHeader
            title="Modo Teste (Sandbox)"
            description="Uma cópia isolada do sistema para testar à vontade."
          />
          <SandboxSettingsCard />
          <SandboxAuditCard />
        </>
      )}

      {view === "local" && (
        <>
          <DetailHeader
            title="Instalar sistema (Windows)"
            description="Cópia local do sistema e dos dados para usar offline."
          />
          <LocalInstallCard />
        </>
      )}

      {view === "activity" && (
        <>
          <DetailHeader
            title="Atualizações em tempo real"
            description="Acompanhamento ao vivo de tudo que acontece no sistema e de quem fez cada ação."
          />
          <RealtimeUpdatesCard />
        </>
      )}

      {view === "github" && (
        <>
          <DetailHeader
            title="Conectar conta GitHub"
            description="Repositório central para backups, exports e histórico de alterações do sistema."
          />
          <GithubCard />
        </>
      )}

      {view === "migration" && (
        <>
          <DetailHeader
            title="Migrar banco de dados"
            description="Pacotes prontos para clonar o sistema em outra conta ou provedor de nuvem."
          />
          <DbMigrationCard />
        </>
      )}

      {view === "shipping" && (
        <>
          <DetailHeader
            title="Envio / SuperFrete"
            description="Dados do remetente enviados à SuperFrete nas cotações e na criação das etiquetas."
          />
          <ShippingOriginCard />
        </>
      )}

      {view === "maintenance" && (
        <>
          <DetailHeader
            title="Modo Manutenção"
            description="Bloqueia o acesso de usuários comuns durante a migração do banco de dados."
          />
          <MaintenanceCard />
        </>
      )}

      {view === "danger" && (
        <>
          <DetailHeader
            title="Zona de perigo"
            description="Ações irreversíveis. Use com cuidado."
          />
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5 shadow-xs">
            <div className="mb-4 flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-destructive/15 text-destructive">
                <AlertTriangle className="size-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-destructive">Zona de Perigo</h3>
                <p className="text-sm text-muted-foreground">
                  Ações irreversíveis que podem apagar dados do sistema.
                </p>
              </div>
            </div>

            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
              {(Object.keys(dangerCatalog) as DangerAction[]).map((action) => (
                <Button
                  key={action}
                  variant="destructive"
                  onClick={() => openDanger(action)}
                  className="justify-start gap-2 min-h-11"
                >
                  <Trash2 className="size-4" />
                  {dangerCatalog[action].cta}
                </Button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Modal confirmação Zona de Perigo */}
      <Dialog
        open={dangerOpen}
        onOpenChange={(v) => {
          if (!v) {
            setDangerOpen(false);
            setConfirmText("");
          }
        }}
      >
 <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              {dangerAction ? dangerCatalog[dangerAction].title : "Confirmar exclusão"}
            </DialogTitle>
            <DialogDescription>
              {dangerAction
                ? dangerCatalog[dangerAction].description
                : "Essa ação não pode ser desfeita."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="confirm-input">
              Digite <span className="font-mono font-semibold text-destructive">EXCLUIR</span> para
              confirmar.
            </Label>
            <Input
              id="confirm-input"
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="EXCLUIR"
              maxLength={20}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDangerOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={confirmText !== "EXCLUIR"}
              onClick={confirmDanger}
            >
              Confirmar Exclusão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AccessManagementDialog open={accessOpen} onOpenChange={setAccessOpen} />
      <ProductsCatalogModal open={productsOpen} onOpenChange={setProductsOpen} />
      <AiTrainingModal open={aiTrainingOpen} onOpenChange={setAiTrainingOpen} />
      <RestoreBackupModal
        open={restoreModalOpen}
        onClose={() => setRestoreModalOpen(false)}
        initialSource={restoreModalSource}
      />
    </section>
  );
}
