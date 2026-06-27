import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  FileSpreadsheet,
  FileText,
  History,
  KeyRound,
  Save,
  Trash2,
  Users,
  AlertTriangle,
} from "lucide-react";
import { Card, PageHeader, Tag } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
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
} from "@/lib/store";
import { NotificationsPrefsCard } from "@/components/notifications-prefs-card";

const dangerCatalog: Record<
  DangerAction,
  { title: string; description: string; cta: string }
> = {
  deleteImportedData: {
    title: "Excluir dados importados",
    description:
      "Remove o histórico de importações. Clientes e produtos permanecem intactos.",
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
    description:
      "Remove permanentemente todos os produtos cadastrados. Os clientes permanecem.",
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
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
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
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(",")),
  ].join("\n");
}

export function ConfiguracoesSection() {
  const preferences = useStore((s) => s.preferences);
  const rules = useStore((s) => s.rules);
  const security = useStore((s) => s.security);
  const importHistory = useStore((s) => s.importHistory);
  const clients = useStore((s) => s.clients);
  const products = useStore((s) => s.products);
  const setPreferences = useStore((s) => s.setPreferences);
  const setRules = useStore((s) => s.setRules);
  const setSecurity = useStore((s) => s.setSecurity);
  const executeDangerAction = useStore((s) => s.executeDangerAction);

  const [prefDraft, setPrefDraft] = useState(preferences);
  const [rulesDraft, setRulesDraft] = useState(rules);

  // Mantém os drafts sincronizados com o store — se a Zona de Perigo resetar
  // o sistema, os formulários refletem na hora e não regravam dados antigos.
  useEffect(() => { setPrefDraft(preferences); }, [preferences]);
  useEffect(() => { setRulesDraft(rules); }, [rules]);

  const [dangerOpen, setDangerOpen] = useState(false);
  const [dangerAction, setDangerAction] = useState<DangerAction | null>(null);
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
      csv = toCSV(clients.map((c) => ({ id: c.id, nome: c.name, telefone: c.phone, observacoes: c.notes ?? "" })));
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
    const headers = "nome,telefone,produto,plataforma,valor_total,valor_pago,status_financeiro,situacao,data_cadastro,data_vencimento";
    if (kind === "csv") {
      downloadFile("modelo_importacao.csv", headers + "\n", "text/csv;charset=utf-8");
    } else {
      downloadFile("modelo_importacao.xlsx.csv", headers + "\n", "text/csv;charset=utf-8");
    }
    toast.success("Modelo baixado.");
  };

  const scrollToHistory = () => {
    document.getElementById("import-history")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section id="configuracoes" className="one-page-section">
      <PageHeader
        title="Configurações"
        description="Gerencie preferências, regras operacionais, importações, segurança e manutenção do sistema."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Preferências */}
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

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Moeda padrão</Label>
                <Select
                  value={prefDraft.currency}
                  onValueChange={(v) => setPrefDraft({ ...prefDraft, currency: v as typeof prefDraft.currency })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
                  onValueChange={(v) => setPrefDraft({ ...prefDraft, dateFormat: v as typeof prefDraft.dateFormat })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DD/MM/AAAA">DD/MM/AAAA</SelectItem>
                    <SelectItem value="AAAA-MM-DD">AAAA-MM-DD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-background/40 px-3">
              <FieldRow label="Modo compacto de tabelas" description="Reduz o espaçamento das linhas.">
                <Switch
                  checked={prefDraft.compactTables}
                  onCheckedChange={(v) => setPrefDraft({ ...prefDraft, compactTables: v })}
                />
              </FieldRow>
              <FieldRow label="Exibir alertas no Dashboard" description="Mostra avisos operacionais no topo.">
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
                onValueChange={(v) => setPrefDraft({ ...prefDraft, theme: v as typeof prefDraft.theme })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Claro</SelectItem>
                  <SelectItem value="dark">Escuro</SelectItem>
                  <SelectItem value="system">Sistema</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSavePrefs} className="gap-2">
                <Save className="size-4" /> Salvar Preferências
              </Button>
            </div>
          </div>
        </Card>

        {/* Regras Operacionais */}
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
                    setRulesDraft({ ...rulesDraft, reservaDaysDefault: Math.max(1, Number(e.target.value) || 1) })
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
                  onCheckedChange={(v) => setRulesDraft({ ...rulesDraft, blockReserveOnActiveMGMV: v })}
                />
              </FieldRow>
              <FieldRow label="Ocultar desistências da Collection">
                <Switch
                  checked={rulesDraft.hideDesistenciasFromCollection}
                  onCheckedChange={(v) => setRulesDraft({ ...rulesDraft, hideDesistenciasFromCollection: v })}
                />
              </FieldRow>
              <FieldRow label="Ocultar abandonos da Collection">
                <Switch
                  checked={rulesDraft.hideAbandonosFromCollection}
                  onCheckedChange={(v) => setRulesDraft({ ...rulesDraft, hideAbandonosFromCollection: v })}
                />
              </FieldRow>
              <FieldRow label="Calcular vencimento automaticamente para Reserva">
                <Switch
                  checked={rulesDraft.autoCalculateReservaDueDate}
                  onCheckedChange={(v) => setRulesDraft({ ...rulesDraft, autoCalculateReservaDueDate: v })}
                />
              </FieldRow>
              <FieldRow label="Considerar Pendente vencido como inadimplente">
                <Switch
                  checked={rulesDraft.treatOverduePendenteAsDelinquent}
                  onCheckedChange={(v) => setRulesDraft({ ...rulesDraft, treatOverduePendenteAsDelinquent: v })}
                />
              </FieldRow>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSaveRules} className="gap-2">
                <Save className="size-4" /> Salvar Regras
              </Button>
            </div>
          </div>
        </Card>

        {/* Importação e Exportação */}
        <Card title="Importação e Exportação">
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" onClick={() => handleTemplate("csv")} className="justify-start gap-2">
              <FileText className="size-4" /> Baixar modelo CSV
            </Button>
            <Button variant="outline" onClick={() => handleTemplate("excel")} className="justify-start gap-2">
              <FileSpreadsheet className="size-4" /> Baixar modelo Excel
            </Button>
            <Button variant="outline" onClick={() => handleExport("clientes")} className="justify-start gap-2">
              <Download className="size-4" /> Exportar base de clientes
            </Button>
            <Button variant="outline" onClick={() => handleExport("produtos")} className="justify-start gap-2">
              <Download className="size-4" /> Exportar produtos
            </Button>
            <Button variant="outline" onClick={() => handleExport("cobrancas")} className="justify-start gap-2">
              <Download className="size-4" /> Exportar cobranças
            </Button>
            <Button variant="outline" onClick={scrollToHistory} className="justify-start gap-2">
              <History className="size-4" /> Ver histórico de importações
            </Button>
          </div>
        </Card>

        {/* Segurança */}
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

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="gap-2" onClick={() => toast("Gerenciamento de usuários em breve.")}>
                <Users className="size-4" /> Gerenciar usuários
              </Button>
              <Button variant="outline" className="gap-2" onClick={() => toast("Alteração de senha em breve.")}>
                <KeyRound className="size-4" /> Alterar senha administrativa
              </Button>
            </div>
          </div>
        </Card>

        {/* Notificações */}
        <NotificationsPrefsCard />
      </div>

      {/* Histórico de Importações */}
      <div id="import-history" className="mt-6">
        <Card title="Histórico de Importações">
          {importHistory.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma importação registrada ainda.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Arquivo</TableHead>
                    <TableHead className="text-right">Clientes</TableHead>
                    <TableHead className="text-right">Produtos</TableHead>
                    <TableHead className="text-right">Erros</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importHistory.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="whitespace-nowrap">{formatDateBR(h.date)}</TableCell>
                      <TableCell>{h.source}</TableCell>
                      <TableCell className="font-medium">{h.file}</TableCell>
                      <TableCell className="text-right tabular-nums">{h.clientsCreated}</TableCell>
                      <TableCell className="text-right tabular-nums">{h.productsAdded}</TableCell>
                      <TableCell className="text-right tabular-nums">{h.errors}</TableCell>
                      <TableCell>
                        <Tag variant={statusVariant[h.status]}>{h.status}</Tag>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>

      {/* Zona de Perigo */}
      <div className="mt-6">
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5 shadow-xs">
          <div className="mb-4 flex items-start gap-3">
            <div className="grid size-9 place-items-center rounded-full bg-destructive/15 text-destructive">
              <AlertTriangle className="size-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-destructive">Zona de Perigo</h3>
              <p className="text-sm text-muted-foreground">
                Ações irreversíveis que podem apagar dados do sistema. Use com cuidado.
              </p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(dangerCatalog) as DangerAction[]).map((action) => (
              <Button
                key={action}
                variant="destructive"
                onClick={() => openDanger(action)}
                className="justify-start gap-2"
              >
                <Trash2 className="size-4" />
                {dangerCatalog[action].cta}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Modal confirmação */}
      <Dialog open={dangerOpen} onOpenChange={(v) => { if (!v) { setDangerOpen(false); setConfirmText(""); } }}>
        <DialogContent className="sm:max-w-md">
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
              Digite <span className="font-mono font-semibold text-destructive">EXCLUIR</span> para confirmar.
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

          <DialogFooter className="gap-2 sm:gap-2">
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
    </section>
  );
}