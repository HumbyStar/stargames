import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertOctagon,
  Brain,
  Box,
  CheckCircle2,
  CircleAlert,
  Clock,
  CopyCheck,
  Hash,
  Layers,
  Loader2,
  Pencil,
  Phone,
  PhoneOff,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  Wallet,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ImportCard, ImportCardsGrid } from "@/components/import-cards";
import { ImportProgressModal, type ImportProgressState } from "@/components/import-progress-modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { calculateReservaDueDate, formatBRL, useStore, type FinancialStatus, type Situation } from "@/lib/store";
import {
  buildClientGroups,
  computeTotals,
  parseListText,
  recalcRow,
  type ListImportPreview,
  type ListImportRow,
} from "@/lib/list-import-parser";
import { reviewListImportLine } from "@/lib/list-import-ai.functions";
import { parseClientHtml } from "@/lib/html-client-import-parser";
import { flushAllPendingUpserts } from "@/lib/db-sync";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ZipImportReview } from "@/components/zip-import-review";

type FilterKey =
  | "all"
  | "paid"
  | "reserva"
  | "open"
  | "validPhones"
  | "invalidPhones"
  | "duplicates"
  | "review"
  | "errors";

const SAMPLE = `Grupo 1:
Breno Yano - 11 91194-7693 - Fire Emblem - Super Original - 60 reais - RESERVA (30)
Zeca - 11 97728-4310 - Final Fantasy VI - Super Original - 80 reais - PAGO

Grupo Action Figures:
Guilherme - 31 9943-0297 - Batman - Pop Alternativo - 60 reais - PAGO
Ailton Sobrinho Jr - 16 99771-9038 - Spiderman - Pop Alternativo - 60 reais - RESERVA (30)`;

function statusToFinancial(s: ListImportRow["financialStatus"]): FinancialStatus {
  if (s === "Pago") return "Pago";
  if (s === "Reserva") return "Reserva";
  if (s === "Pendente") return "Pendente";
  return "Pendente";
}

function statusToSituation(s: ListImportRow["financialStatus"]): Situation {
  // Pago => pronto para envio | Reserva => Em Aberto | Pendente => Em Aberto
  return s === "Pago" ? "Em Aberto" : "Em Aberto";
}

/**
 * Uma linha vinda do parser HTML pode carregar a Situação operacional
 * lida da coluna 7 do arquivo (REMOVIDO -> Retirado, ENVIADO -> Enviado).
 * Quando ausente, cai no fluxo padrão do parser de lista colada.
 */
type RowWithSituation = ListImportRow & {
  situation?: "Retirado" | "Enviado" | null;
};

function resolveSituation(r: RowWithSituation): Situation {
  if (r.situation === "Retirado") return "Retirado";
  if (r.situation === "Enviado") return "Enviado";
  return statusToSituation(r.financialStatus);
}

export function ListImportModal({
  open,
  onOpenChange,
  initialText,
  autoAnalyze,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  initialText?: string;
  autoAnalyze?: boolean;
}) {
  const [rawText, setRawText] = useState("");
  const [rawHtml, setRawHtml] = useState("");
  const [mode, setMode] = useState<"text" | "html" | "zip">("text");
  const [htmlFileName, setHtmlFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ListImportPreview | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [filterGroup, setFilterGroup] = useState<string | null>(null);
  const [editing, setEditing] = useState<ListImportRow | null>(null);
  const [aiBusyId, setAiBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Trava síncrona contra duplo clique: `saving` só muda no próximo render,
  // então dois cliques rápidos no mesmo botão passariam pela checagem.
  const savingRef = useRef(false);
  const [progressState, setProgressState] = useState<ImportProgressState | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{
    rows: ListImportRow[];
    suspects: Array<{
      row: ListImportRow;
      kind: "recent-existing" | "duplicate-in-batch";
      when: string;
      note: string;
    }>;
  } | null>(null);
  // Conciliação de identidade: mesmo telefone já cadastrado com outro nome.
  const [nameConflicts, setNameConflicts] = useState<{
    rows: ListImportRow[];
    items: Array<{
      phone: string;
      clientId: string;
      currentName: string;
      incomingName: string;
      decision: "keep" | "update";
    }>;
  } | null>(null);
  // Decisões confirmadas por telefone (usadas em runPersist).
  const nameDecisionsRef = useRef<Map<string, "keep" | "update">>(new Map());

  const reviewFn = useServerFn(reviewListImportLine);
  const addClient = useStore((s) => s.addClient);
  const addProduct = useStore((s) => s.addProduct);
  const findClientByPhone = useStore((s) => s.findClientByPhone);
  const updateClient = useStore((s) => s.updateClient);
  const addImportHistory = useStore((s) => s.addImportHistory);
  const products = useStore((s) => s.products);

  function close() {
    setRawText("");
    setRawHtml("");
    setHtmlFileName(null);
    setMode("text");
    setPreview(null);
    setFilter("all");
    setFilterGroup(null);
    setEditing(null);
    setAiBusyId(null);
    setProgressState(null);
    setDuplicateWarning(null);
    setNameConflicts(null);
    nameDecisionsRef.current = new Map();
    onOpenChange(false);
  }

  function analyze() {
    if (!rawText.trim()) {
      toast.error("Cole uma lista para iniciar a análise.");
      return;
    }
    const out = parseListText(rawText);
    if (out.rows.length === 0) {
      toast.error("Nenhuma linha válida encontrada. Revise o formato da lista.");
    } else {
      toast.success(`${out.rows.length} linha(s) analisada(s) em ${out.groups.length} grupo(s).`);
    }
    setPreview(out);
    setFilter("all");
    setFilterGroup(null);
  }

  function analyzeHtml() {
    if (!rawHtml.trim()) {
      toast.error("Cole ou selecione um arquivo HTML de cliente.");
      return;
    }
    try {
      const out = parseClientHtml(rawHtml);
      if (out.rows.length === 0) {
        toast.error("Nenhuma linha de produto encontrada nas tabelas do HTML.");
      } else {
        toast.success(
          `Cliente ${out.clientHeader.name || "(?)"} · ${out.rows.length} produto(s) em ${out.groups.length || 1} bloco(s).`,
        );
      }
      setPreview(out);
      setFilter("all");
      setFilterGroup(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao ler o HTML.");
    }
  }

  async function onHtmlFile(file: File) {
    try {
      const text = await file.text();
      setRawHtml(text);
      setHtmlFileName(file.name);
      const out = parseClientHtml(text);
      setPreview(out);
      setFilter("all");
      setFilterGroup(null);
      if (out.rows.length === 0) {
        toast.warning("Nenhuma linha detectada no HTML.");
      } else {
        toast.success(
          `${file.name}: ${out.rows.length} produto(s) para revisão.`,
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao ler o arquivo.");
    }
  }

  // Pré-carrega texto vindo da sessão e analisa automaticamente.
  useEffect(() => {
    if (!open) return;
    if (initialText && initialText !== rawText) {
      setRawText(initialText);
      if (autoAnalyze) {
        const out = parseListText(initialText);
        setPreview(out);
        setFilter("all");
        setFilterGroup(null);
        if (out.rows.length === 0) {
          toast.warning("Nenhuma linha válida detectada — revise o texto.");
        } else {
          toast.success(`${out.rows.length} linha(s) prontas para revisão.`);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialText, autoAnalyze]);

  const filteredRows = useMemo(() => {
    if (!preview) return [] as ListImportRow[];
    const base = preview.rows.filter((r) => !r.ignored);
    const byGroup = filterGroup ? base.filter((r) => r.sourceGroup === filterGroup) : base;
    switch (filter) {
      case "paid":
        return byGroup.filter((r) => r.financialStatus === "Pago");
      case "reserva":
        return byGroup.filter((r) => r.financialStatus === "Reserva");
      case "open":
        return byGroup.filter((r) => (r.remainingValue ?? 0) > 0);
      case "validPhones":
        return byGroup.filter((r) => r.phoneValid);
      case "invalidPhones":
        return byGroup.filter((r) => !r.phoneValid);
      case "duplicates":
        return byGroup.filter((r) => r.duplicateCandidate);
      case "review":
        return byGroup.filter((r) => r.reviewStatus === "review_required");
      case "errors":
        return byGroup.filter((r) => r.reviewStatus === "error");
      default:
        return byGroup;
    }
  }, [preview, filter, filterGroup]);

  function updateRow(id: string, patch: Partial<ListImportRow>) {
    setPreview((prev) => {
      if (!prev) return prev;
      const rows = prev.rows.map((r) => (r.id === id ? recalcRow({ ...r, ...patch }) : r));
      const clients = buildClientGroups(rows);
      return { ...prev, rows, clients, totals: computeTotals(rows, clients) };
    });
  }

  function ignoreRow(id: string) {
    setPreview((prev) => {
      if (!prev) return prev;
      const rows = prev.rows.map((r) => (r.id === id ? { ...r, ignored: true } : r));
      const clients = buildClientGroups(rows.filter((r) => !r.ignored));
      return { ...prev, rows, clients, totals: computeTotals(rows, clients) };
    });
  }

  async function reviewWithAI(row: ListImportRow) {
    setAiBusyId(row.id);
    try {
      const result = await reviewFn({
        data: {
          rawLine: row.rawLine,
          sourceGroup: row.sourceGroup,
          warnings: row.warnings,
        },
      });
      updateRow(row.id, {
        clientName: result.clientName ?? row.clientName,
        phone: result.phone ?? row.phone,
        productName: result.productName ?? row.productName,
        platformOrCategory: result.platformOrCategory ?? row.platformOrCategory,
        totalValue: result.totalValue ?? row.totalValue,
        paidValue: result.paidValue ?? row.paidValue,
        financialStatus: result.financialStatus ?? row.financialStatus,
      });
      toast.success(`IA sugeriu correção (confiança ${(result.confidence * 100).toFixed(0)}%).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao revisar com IA.");
    } finally {
      setAiBusyId(null);
    }
  }

  // Janela para considerar "acabou de importar o mesmo produto".
  const DUPLICATE_WINDOW_MINUTES = 15;

  function normalizeKey(s: string) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Nome normalizado para comparação: sem acento, pontuação ou símbolos. */
  function normalizeName(s: string) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Etapa 1: mesmo telefone já cadastrado com nome diferente. Pergunta se é
   * o mesmo cliente e se o nome deve ser atualizado ou mantido.
   */
  async function persist(rowsToSave: ListImportRow[]) {
    if (savingRef.current) return;
    if (!rowsToSave.length) {
      toast.error("Nenhum registro para salvar.");
      return;
    }
    const seen = new Set<string>();
    const items: NonNullable<typeof nameConflicts>["items"] = [];
    for (const r of rowsToSave) {
      if (!r.phone || !r.clientName) continue;
      if (seen.has(r.phone)) continue;
      seen.add(r.phone);
      if (nameDecisionsRef.current.has(r.phone)) continue;
      const existing = findClientByPhone(r.phone);
      if (!existing) continue;
      if (normalizeName(existing.name) === normalizeName(r.clientName)) continue;
      items.push({
        phone: r.phone,
        clientId: existing.id,
        currentName: existing.name,
        incomingName: r.clientName,
        decision: "keep",
      });
    }
    if (items.length > 0) {
      setNameConflicts({ rows: rowsToSave, items });
      return;
    }
    await checkDuplicates(rowsToSave);
  }

  /**
   * Wrapper: detecta duplicidade recente (mesmo cliente + mesmo produto já
   * salvo nos últimos N minutos) e duplicidade dentro do próprio lote antes
   * de gravar. Se houver, abre confirmação; caso contrário grava direto.
   */
  async function checkDuplicates(rowsToSave: ListImportRow[]) {
    if (savingRef.current) return;
    if (!rowsToSave.length) {
      toast.error("Nenhum registro para salvar.");
      return;
    }
    const now = Date.now();
    const windowMs = DUPLICATE_WINDOW_MINUTES * 60 * 1000;
    const suspects: NonNullable<typeof duplicateWarning>["suspects"] = [];
    const seenInBatch = new Map<string, ListImportRow>();

    for (const r of rowsToSave) {
      if (!r.phone || !r.productName) continue;
      const productKey = `${normalizeKey(r.productName)}|${normalizeKey(r.platformOrCategory)}`;
      const batchKey = `${r.phone}|${productKey}`;

      // 1) duplicidade dentro do próprio lote (mesma pessoa + mesmo produto)
      const prev = seenInBatch.get(batchKey);
      if (prev) {
        suspects.push({
          row: r,
          kind: "duplicate-in-batch",
          when: `Linha ${prev.lineNumber}`,
          note: `Este produto aparece mais de uma vez para ${r.clientName || r.phone} no lote atual.`,
        });
      } else {
        seenInBatch.set(batchKey, r);
      }

      // 2) mesmo produto já salvo há poucos minutos para o mesmo cliente
      const existingClient = findClientByPhone(r.phone);
      if (existingClient) {
        const recent = products.find((p) => {
          if (p.clientId !== existingClient.id) return false;
          if (normalizeKey(p.name) !== normalizeKey(r.productName)) return false;
          const t = new Date(p.registerDate).getTime();
          if (!Number.isFinite(t)) return false;
          return now - t <= windowMs;
        });
        if (recent) {
          const minutesAgo = Math.max(
            0,
            Math.round((now - new Date(recent.registerDate).getTime()) / 60000),
          );
          suspects.push({
            row: r,
            kind: "recent-existing",
            when:
              minutesAgo === 0
                ? "agora há pouco"
                : `há ${minutesAgo} min`,
            note: `${r.clientName || existingClient.name} já recebeu "${r.productName}" ${
              minutesAgo === 0 ? "agora há pouco" : `há ${minutesAgo} min`
            } — pode ser importação duplicada.`,
          });
        }
      }
    }

    if (suspects.length > 0) {
      setDuplicateWarning({ rows: rowsToSave, suspects });
      return;
    }
    await runPersist(rowsToSave);
  }

  async function runPersist(rowsToSave: ListImportRow[]) {
    if (savingRef.current) return;
    if (!rowsToSave.length) {
      toast.error("Nenhum registro para salvar.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    // Data marcada no cabeçalho da lista (ex.: "25/06/2026"). Quando presente,
    // os produtos importados refletem nessa data em vez de "hoje".
    const headerISO = preview?.headerDate
      ? new Date(`${preview.headerDate}T12:00:00`).toISOString()
      : null;
    // "Data Limite: DD/MM/AA" no cabeçalho vira dueDate das Reservas do lote.
    // Se ausente ou <= registerDate, addProduct/normalizeProductDueDateForCreate
    // reescreve para cadastro + 1 mês.
    const headerDueISO = preview?.headerDueDate
      ? new Date(`${preview.headerDueDate}T12:00:00`).toISOString()
      : null;
    // Agrupar por "pasta" (grupo da lista) para reaproveitar a mesma esteira
    // visual dos imports de ZIP/Notion.
    const folders: string[] = Array.from(
      new Set(rowsToSave.map((r) => r.sourceGroup || "Sem grupo")),
    );
    const startedAt = new Date().toISOString();
    const baseState: ImportProgressState = {
      fileHash: `list-${Date.now()}`,
      zipName: `Lista colada (${preview?.groups.length ?? folders.length} grupos)`,
      startedAt,
      folders,
      currentIdx: -1,
      messages: [],
      errors: [],
      stats: {
        createdClients: 0,
        updatedClients: 0,
        createdProducts: 0,
        createdAgreements: 0,
        replacedAgreements: 0,
        ignoredDuplicates: 0,
        errorEntries: 0,
        skippedAfterCorrection: 0,
      },
      recordsTotal: rowsToSave.length,
      recordsProcessed: 0,
      currentBatchSize: rowsToSave.length,
      currentBatchProcessed: 0,
      done: false,
    };
    setProgressState(baseState);
    try {
      let clientsCreated = 0;
      let productsCreated = 0;
      let errorEntries = 0;
      const cache = new Map<string, string>();
      for (let i = 0; i < rowsToSave.length; i++) {
        const r = rowsToSave[i];
        const folderIdx = folders.indexOf(r.sourceGroup || "Sem grupo");
        if (!r.clientName || !r.phone) {
          errorEntries++;
          setProgressState((prev) =>
            prev
              ? {
                  ...prev,
                  currentIdx: folderIdx,
                  recordsProcessed: i + 1,
                  currentBatchProcessed: i + 1,
                  stats: { ...prev.stats, errorEntries },
                }
              : prev,
          );
          continue;
        }
        let clientId = cache.get(r.phone);
        let wasNewClient = false;
        if (!clientId) {
          const existing = findClientByPhone(r.phone);
          if (existing) {
            clientId = existing.id;
            if (
              nameDecisionsRef.current.get(r.phone) === "update" &&
              r.clientName &&
              r.clientName !== existing.name
            ) {
              updateClient(existing.id, { name: r.clientName });
            }
          } else {
            const created = addClient({
              name: r.clientName,
              phone: r.phone,
              notes: r.sourceGroup ? `Origem: ${r.sourceGroup} (lista colada)` : undefined,
              clientType: "common",
            });
            clientId = created.id;
            clientsCreated++;
            wasNewClient = true;
          }
          cache.set(r.phone, clientId);
        }
        const now = headerISO ?? new Date().toISOString();
        const financialStatusFinal = statusToFinancial(r.financialStatus);
        const dueISO =
          financialStatusFinal === "Reserva"
            ? (headerDueISO ?? calculateReservaDueDate(now))
            : now;
        addProduct({
          clientId,
          name: r.productName || "(sem nome)",
          platform: r.platformOrCategory || "(sem plataforma)",
          totalValue: r.totalValue ?? 0,
          paidValue: r.paidValue ?? 0,
          financialStatus: financialStatusFinal,
          situation: resolveSituation(r as RowWithSituation),
          registerDate: now,
          dueDate: dueISO,
          notes:
            mode === "html"
              ? `Importado por HTML de cliente • Grupo: ${r.sourceGroup}`
              : `Importado por lista colada • Grupo: ${r.sourceGroup}`,
        });
        productsCreated++;
        const snapshotClients = clientsCreated;
        const snapshotProducts = productsCreated;
        setProgressState((prev) =>
          prev
            ? {
                ...prev,
                currentIdx: folderIdx,
                recordsProcessed: i + 1,
                currentBatchProcessed: i + 1,
                messages: wasNewClient
                  ? [...prev.messages, `Novo cliente: ${r.clientName}`].slice(-30)
                  : prev.messages,
                stats: {
                  ...prev.stats,
                  createdClients: snapshotClients,
                  createdProducts: snapshotProducts,
                  errorEntries,
                },
              }
            : prev,
        );
      }
      // Garante que clientes e produtos foram gravados no backend antes de
      // registrar o histórico. Sem isso, os produtos podem falhar por FK
      // (client_id ainda não commitado) e o import termina "vazio" na onepage.
      await flushAllPendingUpserts();
      addImportHistory({
        source: "Texto",
        file: `Lista colada (${preview?.groups.length ?? 0} grupos)`,
        clientsCreated,
        productsAdded: productsCreated,
        errors: preview?.totals.errorRows ?? 0,
        status: (preview?.totals.errorRows ?? 0) > 0 ? "Com avisos" : "Concluído",
        // Guarda o conteúdo exato colado/importado para o botão "Ver texto"
        // reproduzir a importação original sem depender da auditoria.
        rawContent: (mode === "html" ? rawHtml : rawText).trim() || undefined,
      });
      setProgressState((prev) =>
        prev
          ? {
              ...prev,
              currentIdx: prev.folders.length,
              recordsProcessed: rowsToSave.length,
              currentBatchProcessed: rowsToSave.length,
              done: true,
              stats: {
                ...prev.stats,
                createdClients: clientsCreated,
                createdProducts: productsCreated,
                errorEntries,
              },
            }
          : prev,
      );
      toast.success(`${clientsCreated} cliente(s) e ${productsCreated} produto(s) salvos.`);
    } catch (e) {
      setProgressState((prev) =>
        prev
          ? {
              ...prev,
              errors: [...prev.errors, e instanceof Error ? e.message : String(e)],
              done: true,
            }
          : prev,
      );
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function saveValidOnly() {
    if (!preview) return;
    void persist(preview.rows.filter((r) => !r.ignored && r.reviewStatus === "ok"));
  }
  function saveReviewed() {
    if (!preview) return;
    void persist(preview.rows.filter((r) => !r.ignored && r.reviewStatus !== "error"));
  }
  function saveAllWithConfirm() {
    if (!preview) return;
    const totalIssues =
      preview.totals.errorRows + preview.totals.reviewRows + preview.totals.invalidPhones;
    if (totalIssues > 0) {
      const ok = window.confirm(
        `Existem ${totalIssues} registro(s) com aviso. Deseja salvar mesmo assim?`,
      );
      if (!ok) return;
    }
    void persist(preview.rows.filter((r) => !r.ignored));
  }

  /** Confirma exatamente as linhas visíveis no preview (respeitando filtros). */
  function confirmVisible() {
    if (!filteredRows.length) {
      toast.error("Nenhuma linha visível para importar.");
      return;
    }
    void persist(filteredRows.filter((r) => r.reviewStatus !== "error"));
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
 <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar lista de grupos</DialogTitle>
          <DialogDescription>
            Cole a lista de vendas/reservas ou envie um HTML de cliente (Notion) para revisar
            antes de salvar. Nada é gravado antes da confirmação.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as "text" | "html" | "zip")}>
          <TabsList>
            <TabsTrigger value="text">Lista colada</TabsTrigger>
            <TabsTrigger value="html">HTML de cliente (Notion)</TabsTrigger>
            <TabsTrigger value="zip">ZIP Notion</TabsTrigger>
          </TabsList>
          <TabsContent value="text" className="space-y-3">
            <Label htmlFor="list-text">Lista de grupos</Label>
            <Textarea
              id="list-text"
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={SAMPLE}
              className="min-h-44 font-mono text-xs"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                Formato: <code>Nome - Telefone - Produto - Plataforma - Valor - Status</code>
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setRawText(SAMPLE)}>
                  Usar exemplo
                </Button>
                <Button size="sm" onClick={analyze}>
                  Analisar lista
                </Button>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="html" className="space-y-3">
            <Label htmlFor="html-file">Arquivo HTML do cliente</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="html-file"
                type="file"
                accept=".html,text/html"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onHtmlFile(f);
                }}
                className="max-w-md"
              />
              {htmlFileName && (
                <Badge variant="secondary" className="text-xs">
                  {htmlFileName}
                </Badge>
              )}
            </div>
            <Label htmlFor="html-text" className="text-xs text-muted-foreground">
              …ou cole o HTML abaixo
            </Label>
            <Textarea
              id="html-text"
              value={rawHtml}
              onChange={(e) => setRawHtml(e.target.value)}
              placeholder="<html>...</html>"
              className="min-h-32 font-mono text-xs"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                Um HTML por cliente. Lê todas as tabelas do arquivo e concatena como
                produtos do mesmo cliente. <strong>REMOVIDO</strong> vira Retirado,{" "}
                <strong>ENVIADO</strong> vira Enviado.
              </span>
              <Button size="sm" onClick={analyzeHtml}>
                Analisar HTML
              </Button>
            </div>
          </TabsContent>
          <TabsContent value="zip" className="space-y-3">
            <ZipImportReview onDone={close} />
          </TabsContent>
        </Tabs>

        {preview && (
          <div className="space-y-4">
            <ImportCardsGrid>
              <ImportCard
                icon={Layers}
                title="Grupos detectados"
                value={preview.groups.length}
                tone="info"
              />
              <ImportCard
                icon={Hash}
                title="Linhas analisadas"
                value={preview.totals.lines}
                tone="neutral"
                onClick={() => {
                  setFilter("all");
                  setFilterGroup(null);
                }}
              />
              <ImportCard
                icon={Users}
                title="Clientes únicos"
                value={preview.totals.uniqueClients}
                tone="common"
              />
              <ImportCard
                icon={Box}
                title="Produtos capturados"
                value={preview.totals.products}
                tone="common"
                onClick={() => setFilter("all")}
              />
              <ImportCard
                icon={CheckCircle2}
                title="Pagos"
                value={preview.totals.paidRows}
                tone="success"
                onClick={() => setFilter("paid")}
              />
              <ImportCard
                icon={Clock}
                title="Reservas"
                value={preview.totals.reservaRows}
                tone="warning"
                onClick={() => setFilter("reserva")}
              />
              <ImportCard
                icon={Wallet}
                title="Valor total"
                value={preview.totals.totalValue}
                tone="info"
                format={formatBRL}
              />
              <ImportCard
                icon={ShieldCheck}
                title="Valor pago"
                value={preview.totals.paidValue}
                tone="success"
                format={formatBRL}
              />
              <ImportCard
                icon={Wallet}
                title="Valor em aberto"
                value={preview.totals.openValue}
                tone="warning"
                format={formatBRL}
                onClick={() => setFilter("open")}
              />
              <ImportCard
                icon={Phone}
                title="Telefones válidos"
                value={preview.totals.validPhones}
                tone="success"
                onClick={() => setFilter("validPhones")}
              />
              <ImportCard
                icon={PhoneOff}
                title="Telefones com erro"
                value={preview.totals.invalidPhones}
                tone="danger"
                onClick={() => setFilter("invalidPhones")}
              />
              <ImportCard
                icon={CopyCheck}
                title="Duplicatas possíveis"
                value={preview.totals.duplicateCandidates}
                tone="warning"
                onClick={() => setFilter("duplicates")}
              />
              <ImportCard
                icon={CircleAlert}
                title="Revisão necessária"
                value={preview.totals.reviewRows}
                tone="warning"
                onClick={() => setFilter("review")}
              />
              <ImportCard
                icon={AlertOctagon}
                title="Erros de leitura"
                value={preview.totals.errorRows}
                tone="danger"
                onClick={() => setFilter("errors")}
              />
            </ImportCardsGrid>

            {/* Barra de confirmação sincronizada com o que está visível */}
            {(preview.totals.splitRows > 0 ||
              preview.totals.missingPlatformRows > 0 ||
              preview.totals.shortPhones > 0 ||
              preview.totals.duplicateCandidates > 0) && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
                <p className="mb-1 font-medium text-amber-700">
                  Correções aplicadas na leitura — confira e edite antes de importar
                </p>
                <ul className="list-disc space-y-0.5 pl-4 text-amber-700/90">
                  {preview.totals.splitRows > 0 && (
                    <li>
                      {preview.totals.splitRows} registro(s) vieram grudados na mesma linha e foram
                      divididos automaticamente (o texto depois do status vira um novo cliente).
                    </li>
                  )}
                  {preview.totals.missingPlatformRows > 0 && (
                    <li>
                      {preview.totals.missingPlatformRows} linha(s) sem plataforma/categoria — preencha
                      antes de confirmar.
                    </li>
                  )}
                  {preview.totals.shortPhones > 0 && (
                    <li>
                      {preview.totals.shortPhones} telefone(s) com 10 dígitos — confirme se falta o 9º
                      dígito.
                    </li>
                  )}
                  {preview.totals.duplicateCandidates > 0 && (
                    <li>
                      {preview.totals.duplicateCandidates} possível(is) duplicidade(s) de cliente/produto.
                    </li>
                  )}
                </ul>
              </div>
            )}

            <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background/95 px-3 py-2 backdrop-blur">
              <div className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{filteredRows.length}</span> registro(s) visíveis serão importados ao confirmar.
              </div>
              <Button size="sm" onClick={confirmVisible} disabled={saving || !filteredRows.length}>
                {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
                Confirmar importação ({filteredRows.length})
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Filtros ativos:</span>
              <Badge variant="secondary">{labelForFilter(filter)}</Badge>
              <Select
                value={filterGroup ?? "__all__"}
                onValueChange={(v) => setFilterGroup(v === "__all__" ? null : v)}
              >
                <SelectTrigger className="h-7 w-56 text-xs">
                  <SelectValue placeholder="Todos os grupos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos os grupos</SelectItem>
                  {preview.groups.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filter !== "all" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setFilter("all")}
                >
                  Limpar filtro
                </Button>
              )}
            </div>

            <div className="max-h-[40vh] overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/40">
                  <tr className="text-left">
                    <th className="p-2">Grupo</th>
                    <th className="p-2">Cliente</th>
                    <th className="p-2">Telefone</th>
                    <th className="p-2">Produto</th>
                    <th className="p-2">Plataforma</th>
                    <th className="p-2 text-right">Total</th>
                    <th className="p-2 text-right">Pago</th>
                    <th className="p-2 text-right">Restante</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Conf.</th>
                    <th className="p-2">Avisos</th>
                    <th className="p-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={12} className="p-4 text-center text-muted-foreground">
                        Nenhuma linha para o filtro atual.
                      </td>
                    </tr>
                  )}
                  {filteredRows.map((r) => (
                    <tr key={r.id} className={cn("border-t", r.reviewStatus === "error" && "bg-destructive/5")}>
                      <td className="p-2 align-top">{r.sourceGroup}</td>
                      <td className="p-2 align-top font-medium">{r.clientName || "—"}</td>
                      <td className={cn("p-2 align-top font-mono", !r.phoneValid && "text-destructive")}>
                        {r.phone || "—"}
                      </td>
                      <td className="p-2 align-top">{r.productName || "—"}</td>
                      <td className="p-2 align-top">{r.platformOrCategory || "—"}</td>
                      <td className="p-2 align-top text-right tabular-nums">
                        {r.totalValue !== null ? formatBRL(r.totalValue) : "—"}
                      </td>
                      <td className="p-2 align-top text-right tabular-nums">
                        {r.paidValue !== null ? formatBRL(r.paidValue) : "—"}
                      </td>
                      <td className="p-2 align-top text-right tabular-nums">
                        {r.remainingValue !== null ? formatBRL(r.remainingValue) : "—"}
                      </td>
                      <td className="p-2 align-top">
                        <Badge variant={statusBadgeVariant(r.financialStatus)}>{r.financialStatus}</Badge>
                        {r.duplicateCandidate && (
                          <Badge variant="outline" className="ml-1">dup?</Badge>
                        )}
                        {r.splitFromGluedLine && (
                          <Badge variant="outline" className="ml-1" title="Linha estava grudada e foi dividida">
                            dividida
                          </Badge>
                        )}
                      </td>
                      <td className="p-2 align-top tabular-nums">
                        {(r.confidence * 100).toFixed(0)}%
                      </td>
                      <td className="p-2 align-top max-w-[12rem]">
                        {r.warnings.length ? (
                          <ul className="list-disc pl-4 text-[11px] text-muted-foreground">
                            {r.warnings.slice(0, 3).map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                        {r.autoFixes?.length ? (
                          <ul className="mt-1 list-disc pl-4 text-[11px] text-amber-700">
                            {r.autoFixes.slice(0, 3).map((f, i) => (
                              <li key={i}>{f}</li>
                            ))}
                          </ul>
                        ) : null}
                      </td>
                      <td className="p-2 align-top">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Editar"
                            onClick={() => setEditing(r)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Revisar com IA"
                            disabled={aiBusyId === r.id}
                            onClick={() => void reviewWithAI(r)}
                          >
                            {aiBusyId === r.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Brain className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Ignorar linha"
                            onClick={() => ignoreRow(r.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.totals.errorRows + preview.totals.reviewRows > 0 && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700">
                <Sparkles className="mr-1 inline h-3 w-3" />
                Algumas linhas precisam de revisão antes de salvar.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancelar
          </Button>
          {preview && (
            <>
              <Button variant="outline" onClick={saveValidOnly} disabled={saving}>
                Salvar somente válidos
              </Button>
              <Button variant="outline" onClick={saveReviewed} disabled={saving}>
                Salvar tudo revisado
              </Button>
              <Button onClick={saveAllWithConfirm} disabled={saving}>
                {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Salvar todos com confirmação
              </Button>
            </>
          )}
        </DialogFooter>

        {editing && (
          <EditRowDialog
            row={editing}
            onClose={() => setEditing(null)}
            onSave={(patch) => {
              updateRow(editing.id, patch);
              setEditing(null);
            }}
          />
        )}
      </DialogContent>

      {/* Mesma esteira visual do fluxo de ZIP/Notion durante a persistência */}
      <ImportProgressModal
        state={progressState}
        open={!!progressState}
        onClose={() => {
          setProgressState(null);
          close();
        }}
      />

      {/* Aviso da IA: mesmo produto para o mesmo cliente em poucos minutos */}
      <Dialog
        open={!!duplicateWarning}
        onOpenChange={(o) => { if (!o) setDuplicateWarning(null); }}
      >
        <DialogContent className="border-amber-500/50 bg-gradient-to-b from-amber-500/10 via-background to-background sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
              <Sparkles className="h-5 w-5" /> Possível importação duplicada
            </DialogTitle>
            <DialogDescription>
              A IA detectou {duplicateWarning?.suspects.length ?? 0} produto(s) que{" "}
              <span className="font-medium text-foreground">já foram adicionados</span> ao mesmo cliente nos últimos {DUPLICATE_WINDOW_MINUTES} minutos ou aparecem{" "}
              <span className="font-medium text-foreground">mais de uma vez</span> neste lote. Confirme antes de gravar para evitar duplicidade.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 overflow-y-auto rounded-md border bg-background/70">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60 text-left">
                <tr>
                  <th className="p-2">Cliente</th>
                  <th className="p-2">Produto</th>
                  <th className="p-2">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {duplicateWarning?.suspects.slice(0, 50).map((s, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2 align-top">{s.row.clientName || s.row.phone || "—"}</td>
                    <td className="p-2 align-top">
                      {s.row.productName || "—"}
                      {s.row.platformOrCategory ? (
                        <span className="text-muted-foreground"> · {s.row.platformOrCategory}</span>
                      ) : null}
                    </td>
                    <td className="p-2 align-top text-amber-700 dark:text-amber-300">
                      {s.kind === "recent-existing"
                        ? `Já importado ${s.when}`
                        : `Repetido no lote (${s.when})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setDuplicateWarning(null)}
            >
              Cancelar e revisar
            </Button>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => {
                if (!duplicateWarning) return;
                const suspectRowIds = new Set(
                  duplicateWarning.suspects.map((s) => s.row.id),
                );
                const filtered = duplicateWarning.rows.filter(
                  (r) => !suspectRowIds.has(r.id),
                );
                setDuplicateWarning(null);
                if (filtered.length === 0) {
                  toast.error("Nada restou para importar após remover os duplicados.");
                  return;
                }
                void runPersist(filtered);
              }}
            >
              Pular os duplicados
            </Button>
            <Button
              variant="outline"
              disabled={saving}
              title="Mantém apenas uma ocorrência de cada produto repetido no lote"
              onClick={() => {
                if (!duplicateWarning) return;
                // Unificar: remove apenas as repetições dentro do lote
                // (mantendo a primeira ocorrência) e preserva o restante.
                const repeatedIds = new Set(
                  duplicateWarning.suspects
                    .filter((s) => s.kind === "duplicate-in-batch")
                    .map((s) => s.row.id),
                );
                const rows = duplicateWarning.rows.filter((r) => !repeatedIds.has(r.id));
                setDuplicateWarning(null);
                if (rows.length === 0) {
                  toast.error("Nada restou para importar após unificar os itens.");
                  return;
                }
                toast.success(
                  `${repeatedIds.size} item(ns) repetido(s) unificado(s) — 1 registro por produto.`,
                );
                void runPersist(rows);
              }}
            >
              Unificar itens
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={saving}
              onClick={() => {
                if (!duplicateWarning) return;
                const rows = duplicateWarning.rows;
                setDuplicateWarning(null);
                void runPersist(rows);
              }}
            >
              Importar mesmo assim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

function labelForFilter(f: FilterKey): string {
  const map: Record<FilterKey, string> = {
    all: "Todos",
    paid: "Pagos",
    reserva: "Reservas",
    open: "Valor em aberto",
    validPhones: "Telefones válidos",
    invalidPhones: "Telefones com erro",
    duplicates: "Duplicatas possíveis",
    review: "Revisão necessária",
    errors: "Erros de leitura",
  };
  return map[f];
}

function statusBadgeVariant(s: ListImportRow["financialStatus"]): React.ComponentProps<typeof Badge>["variant"] {
  if (s === "Pago") return "default";
  if (s === "Reserva") return "secondary";
  if (s === "Revisão necessária") return "destructive";
  return "outline";
}

function EditRowDialog({
  row,
  onClose,
  onSave,
}: {
  row: ListImportRow;
  onClose: () => void;
  onSave: (patch: Partial<ListImportRow>) => void;
}) {
  const [draft, setDraft] = useState({
    clientName: row.clientName,
    phone: row.phone,
    productName: row.productName,
    platformOrCategory: row.platformOrCategory,
    totalValue: row.totalValue ?? 0,
    paidValue: row.paidValue ?? 0,
    financialStatus: row.financialStatus,
    sourceGroup: row.sourceGroup,
  });
  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : null)}>
 <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar linha</DialogTitle>
          <DialogDescription>Linha {row.lineNumber} • {row.sourceGroup}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cliente" full>
            <Input value={draft.clientName} onChange={(e) => setDraft({ ...draft, clientName: e.target.value })} />
          </Field>
          <Field label="Telefone">
            <Input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value.replace(/\D+/g, "") })} />
          </Field>
          <Field label="Grupo">
            <Input value={draft.sourceGroup} onChange={(e) => setDraft({ ...draft, sourceGroup: e.target.value })} />
          </Field>
          <Field label="Produto" full>
            <Input value={draft.productName} onChange={(e) => setDraft({ ...draft, productName: e.target.value })} />
          </Field>
          <Field label="Plataforma/Categoria" full>
            <Input
              value={draft.platformOrCategory}
              onChange={(e) => setDraft({ ...draft, platformOrCategory: e.target.value })}
            />
          </Field>
          <Field label="Valor total">
            <Input
              type="number"
              value={draft.totalValue}
              onChange={(e) => setDraft({ ...draft, totalValue: Number(e.target.value) })}
            />
          </Field>
          <Field label="Valor pago">
            <Input
              type="number"
              value={draft.paidValue}
              onChange={(e) => setDraft({ ...draft, paidValue: Number(e.target.value) })}
            />
          </Field>
          <Field label="Status" full>
            <Select
              value={draft.financialStatus}
              onValueChange={(v) => setDraft({ ...draft, financialStatus: v as ListImportRow["financialStatus"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["Pago", "Reserva", "Pendente", "Revisão necessária"] as const).map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            <X className="mr-1 h-4 w-4" /> Cancelar
          </Button>
          <Button
            onClick={() =>
              onSave({
                clientName: draft.clientName.trim(),
                phone: draft.phone,
                productName: draft.productName.trim(),
                platformOrCategory: draft.platformOrCategory.trim(),
                totalValue: draft.totalValue,
                paidValue: draft.paidValue,
                financialStatus: draft.financialStatus,
                sourceGroup: draft.sourceGroup,
              })
            }
          >
            <CheckCircle2 className="mr-1 h-4 w-4" /> Salvar correção
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={cn("space-y-1", full && "col-span-2")}>
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}