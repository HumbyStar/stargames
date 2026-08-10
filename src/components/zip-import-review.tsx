import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Brain,
  CheckCircle2,
  FileArchive,
  Loader2,
  Pencil,
  PhoneOff,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatBRL, useStore, type FinancialStatus, type Situation } from "@/lib/store";
import type { HtmlImportRow } from "@/lib/html-client-import-parser";
import {
  parseZipNotionFile,
  type ZipClientEntry,
  type ZipImportResult,
} from "@/lib/zip-import-parser";
import {
  reviewZipClient,
  type ZipAiClientReview,
  type ZipAiRowSuggestion,
} from "@/lib/list-import-ai-zip.functions";
import { RowEditActions, RowEditPencil } from "@/components/row-edit-controls";
import { useRowEdit } from "@/lib/use-row-edit";
import { uploadNotionHtml } from "@/lib/notion-html-storage";
import { NotionHtmlInlineActions } from "@/components/notion-html-actions";
import { confirmImportedRows } from "@/lib/import-visibility";

type PreviewRow = HtmlImportRow & {
  ignored?: boolean;
  ai?: ZipAiRowSuggestion;
};

interface ClientState {
  entry: ZipClientEntry;
  rows: PreviewRow[];
  aiSummary?: string;
  aiOverallReview?: boolean;
  aiBusy?: boolean;
}

function statusToFinancial(s: PreviewRow["financialStatus"]): FinancialStatus {
  if (s === "Pago") return "Pago";
  if (s === "Reserva") return "Reserva";
  if (s === "Pendente") return "Pendente";
  return "Pendente";
}

function resolveSituation(r: PreviewRow): Situation {
  const s = r.situation;
  if (s === "Retirado" || s === "Retirar" || s === "Enviado" || s === "Abandonou") return s;
  return "Em Aberto";
}

interface RowDraft extends Record<string, unknown> {
  productName: string;
  platformOrCategory: string;
  totalValue: number | null;
  paidValue: number | null;
  financialStatus: PreviewRow["financialStatus"];
  situation: PreviewRow["situation"];
}

export function ZipImportReview({ onDone }: { onDone: () => void }) {
  const [zipName, setZipName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [zipResult, setZipResult] = useState<ZipImportResult | null>(null);
  const [clientsState, setClientsState] = useState<ClientState[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const reviewFn = useServerFn(reviewZipClient);

  const rowEdit = useRowEdit<RowDraft>();
  const addClient = useStore((s) => s.addClient);
  const addProduct = useStore((s) => s.addProduct);
  const findClientByPhone = useStore((s) => s.findClientByPhone);
  const addImportHistory = useStore((s) => s.addImportHistory);
  const updateClient = useStore((s) => s.updateClient);

  async function onFile(file: File) {
    setLoading(true);
    setZipName(file.name);
    try {
      const res = await parseZipNotionFile(file);
      if (res.clients.length === 0) {
        toast.error("Nenhum HTML de cliente encontrado no ZIP.");
        setZipResult(null);
        setClientsState([]);
        return;
      }
      setZipResult(res);
      setClientsState(
        res.clients.map((c) => ({
          entry: c,
          rows: c.preview.rows as PreviewRow[],
        })),
      );
      setActiveIdx(0);
      toast.success(
        `${res.clients.length} cliente(s) detectados${
          res.matchedFolder ? ` em ${res.folders.join(", ")}` : " (raiz do ZIP)"
        }.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao ler o ZIP.");
    } finally {
      setLoading(false);
    }
  }

  const active = clientsState[activeIdx];

  const totalRows = useMemo(
    () => clientsState.reduce((n, c) => n + c.rows.filter((r) => !r.ignored).length, 0),
    [clientsState],
  );

  function updateActiveRows(fn: (rows: PreviewRow[]) => PreviewRow[]) {
    setClientsState((prev) =>
      prev.map((c, i) => (i === activeIdx ? { ...c, rows: fn(c.rows) } : c)),
    );
  }

  function setRowSituation(rowId: string, situation: PreviewRow["situation"]) {
    updateActiveRows((rows) =>
      rows.map((r) => (r.id === rowId ? { ...r, situation } : r)),
    );
  }

  function ignoreRow(rowId: string) {
    updateActiveRows((rows) =>
      rows.map((r) => (r.id === rowId ? { ...r, ignored: true } : r)),
    );
  }

  async function reviewClientWithAI(clientIdx: number) {
    const c = clientsState[clientIdx];
    if (!c) return;
    setClientsState((prev) =>
      prev.map((x, i) => (i === clientIdx ? { ...x, aiBusy: true } : x)),
    );
    try {
      const suggestion: ZipAiClientReview = await reviewFn({
        data: {
          clientName: c.entry.preview.clientHeader.name || c.entry.fileName,
          clientPhone: c.entry.preview.clientHeader.phone,
          htmlSnippet: c.entry.rawHtml.slice(0, 24000),
          rows: c.rows.map((r) => ({
            rowId: r.id,
            sourceGroup: r.sourceGroup,
            productName: r.productName,
            platformOrCategory: r.platformOrCategory,
            totalValue: r.totalValue,
            paidValue: r.paidValue,
            financialStatus: String(r.financialStatus),
            rawSituation: r.situation ?? "",
            rawLine: r.rawLine,
          })),
        },
      });
      const map = new Map(suggestion.rows.map((x) => [x.rowId, x] as const));
      setClientsState((prev) =>
        prev.map((x, i) =>
          i === clientIdx
            ? {
                ...x,
                aiBusy: false,
                aiSummary: suggestion.clientSummary,
                aiOverallReview: suggestion.overallNeedsReview,
                rows: x.rows.map((r) => {
                  const ai = map.get(r.id);
                  return ai ? { ...r, ai } : r;
                }),
              }
            : x,
        ),
      );
      toast.success(`IA revisou ${suggestion.rows.length} linha(s).`);
    } catch (e) {
      setClientsState((prev) =>
        prev.map((x, i) => (i === clientIdx ? { ...x, aiBusy: false } : x)),
      );
      toast.error(e instanceof Error ? e.message : "Falha na revisão IA.");
    }
  }

  function applyAiSuggestions(clientIdx: number) {
    setClientsState((prev) =>
      prev.map((x, i) => {
        if (i !== clientIdx) return x;
        return {
          ...x,
          rows: x.rows.map((r) => {
            const ai = r.ai;
            if (!ai) return r;
            let situation: PreviewRow["situation"] = r.situation;
            if (
              ai.situationSuggestion === "Retirado" ||
              ai.situationSuggestion === "Retirar" ||
              ai.situationSuggestion === "Enviado" ||
              ai.situationSuggestion === "Abandonou"
            ) {
              situation = ai.situationSuggestion;
            }
            const fin =
              ai.financialStatusSuggestion === "Pago" ||
              ai.financialStatusSuggestion === "Reserva" ||
              ai.financialStatusSuggestion === "Pendente"
                ? ai.financialStatusSuggestion
                : r.financialStatus;
            return {
              ...r,
              situation,
              financialStatus: fin,
              totalValue: ai.totalValue ?? r.totalValue,
              paidValue: ai.paidValue ?? r.paidValue,
            };
          }),
        };
      }),
    );
    toast.success("Sugestões da IA aplicadas.");
  }

  function startEditRow(r: PreviewRow) {
    rowEdit.startEdit(r.id, {
      productName: r.productName,
      platformOrCategory: r.platformOrCategory,
      totalValue: r.totalValue,
      paidValue: r.paidValue,
      financialStatus: r.financialStatus,
      situation: r.situation,
    });
  }

  async function confirmEdit() {
    await rowEdit.confirm(async (draft) => {
      if (!rowEdit.editingRowId) return;
      const editingId = rowEdit.editingRowId;
      updateActiveRows((rows) =>
        rows.map((r) =>
          r.id === editingId
            ? {
                ...r,
                productName: draft.productName,
                platformOrCategory: draft.platformOrCategory,
                totalValue: draft.totalValue,
                paidValue: draft.paidValue,
                financialStatus: draft.financialStatus,
                situation: draft.situation,
              }
            : r,
        ),
      );
    });
  }

  async function persistAll() {
    if (!clientsState.length) return;
    setSaving(true);
    let clientsCreated = 0;
    let productsCreated = 0;
    let htmlSaved = 0;
    let htmlFailed = 0;
    const createdClientIds: string[] = [];
    const createdProductIds: string[] = [];
    const touchedClientIds = new Set<string>();
    try {
      for (const c of clientsState) {
        const header = c.entry.preview.clientHeader;
        if (!header.phone) continue;
        let clientId = findClientByPhone(header.phone)?.id;
        if (!clientId) {
          const created = addClient({
            name: header.name || c.entry.fileName,
            phone: header.phone,
            notes: `Importado do ZIP Notion (${c.entry.folder})`,
            clientType: "common",
            folder: c.entry.folder,
          });
          clientId = created.id;
          createdClientIds.push(created.id);
          clientsCreated++;
        }
        touchedClientIds.add(clientId);
        // Upload do HTML original — só grava se o storage aceitar (RLS).
        try {
          const uploaded = await uploadNotionHtml({
            clientId,
            fileName: c.entry.fileName,
            html: c.entry.rawHtml,
            sourceFolder: c.entry.folder,
          });
          updateClient(clientId, {
            originalHtmlFileName: uploaded.fileName,
            originalHtmlStoragePath: uploaded.path,
            originalHtmlImportedAt: uploaded.importedAt,
            originalHtmlSourceFolder: uploaded.sourceFolder,
            originalHtmlChecksum: uploaded.checksum,
          });
          htmlSaved++;
        } catch (err) {
          htmlFailed++;
          console.warn("[notion-html] upload falhou", c.entry.fileName, err);
        }
        for (const r of c.rows) {
          if (r.ignored) continue;
          const now = new Date().toISOString();
          const createdProduct = addProduct({
            clientId,
            name: r.productName || "(sem nome)",
            platform: r.platformOrCategory || "(sem plataforma)",
            totalValue: r.totalValue ?? 0,
            paidValue: r.paidValue ?? 0,
            financialStatus: statusToFinancial(r.financialStatus),
            situation: resolveSituation(r),
            registerDate: now,
            dueDate: now,
            notes: `Importado por ZIP Notion • Arquivo: ${c.entry.fileName} • Grupo: ${r.sourceGroup}${
              r.ai?.evidence?.length
                ? ` • Evidência IA: ${r.ai.evidence.slice(0, 2).join(" | ")}`
                : ""
            }`,
          });
          createdProductIds.push(createdProduct.id);
          productsCreated++;
        }
      }
      await confirmImportedRows({
        clientIds: Array.from(touchedClientIds),
        productIds: createdProductIds,
        touchedClientIds: Array.from(touchedClientIds),
      });
      addImportHistory({
        source: "HTML Notion",
        file: zipName ?? "ZIP Notion",
        clientsCreated,
        productsAdded: productsCreated,
        errors: 0,
        status: "Concluído",
      });
      toast.success(
        `${clientsCreated} cliente(s) e ${productsCreated} produto(s) importados.`,
      );
      if (htmlSaved > 0) {
        toast.success(`${htmlSaved} HTML(s) originais salvos para auditoria.`);
      }
      if (htmlFailed > 0) {
        toast.warning(
          `${htmlFailed} HTML(s) originais não foram armazenados (sem permissão ou erro de storage).`,
        );
      }
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao importar.");
    } finally {
      setSaving(false);
    }
  }

  const activeAiReview = active?.rows.some((r) => r.ai) ?? false;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          className="max-w-md"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
        {zipName && (
          <Badge variant="secondary" className="gap-1 text-xs">
            <FileArchive className="h-3 w-3" />
            {zipName}
          </Badge>
        )}
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {zipResult && (
          <span className="text-xs text-muted-foreground">
            {clientsState.length} cliente(s) · {totalRows} produto(s)
            {zipResult.matchedFolder
              ? ` · pasta: ${zipResult.folders.join(", ")}`
              : " · varredura na raiz"}
          </span>
        )}
      </div>

      {clientsState.length > 0 && active && (
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <aside className="max-h-[60vh] overflow-y-auto rounded-md border">
            <ul className="text-xs">
              {clientsState.map((c, i) => (
                <li key={c.entry.path}>
                  <button
                    type="button"
                    onClick={() => setActiveIdx(i)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-2 py-2 text-left hover:bg-muted",
                      i === activeIdx && "bg-muted font-medium",
                    )}
                  >
                    <span className="truncate">
                      {c.entry.preview.clientHeader.name || c.entry.fileName}
                    </span>
                    <div className="flex items-center gap-1">
                      {!c.entry.preview.clientHeader.phoneValid && (
                        <PhoneOff className="h-3 w-3 text-destructive" />
                      )}
                      {c.aiOverallReview && (
                        <Sparkles className="h-3 w-3 text-amber-500" />
                      )}
                      <Badge variant="outline" className="h-4 px-1 text-[10px]">
                        {c.rows.filter((r) => !r.ignored).length}
                      </Badge>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <section className="space-y-2">
            <header className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 p-2">
              <div className="flex flex-col text-xs">
                <strong className="text-sm">
                  {active.entry.preview.clientHeader.name || active.entry.fileName}
                </strong>
                <span className="text-muted-foreground">
                  {active.entry.fileName} · tel:{" "}
                  {active.entry.preview.clientHeader.phone || "—"}
                </span>
                {active.aiSummary && (
                  <span className="mt-1 text-[11px] italic text-muted-foreground">
                    IA: {active.aiSummary}
                  </span>
                )}
                <div className="mt-1">
                  <NotionHtmlInlineActions
                    fileName={active.entry.fileName}
                    rawHtml={active.entry.rawHtml}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void reviewClientWithAI(activeIdx)}
                  disabled={active.aiBusy}
                >
                  {active.aiBusy ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Brain className="mr-1 h-3.5 w-3.5" />
                  )}
                  Revisar cliente com IA
                </Button>
                {activeAiReview && (
                  <Button size="sm" onClick={() => applyAiSuggestions(activeIdx)}>
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Aplicar sugestões
                  </Button>
                )}
              </div>
            </header>

            <div className="max-h-[55vh] overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-left">
                  <tr>
                    <th className="p-2">Grupo</th>
                    <th className="p-2">Item</th>
                    <th className="p-2">Plataforma</th>
                    <th className="p-2 text-right">Total</th>
                    <th className="p-2 text-right">Pago</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Situação</th>
                    <th className="p-2">IA</th>
                    <th className="p-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {active.rows.map((r) => {
                    if (r.ignored) return null;
                    const isEd = rowEdit.isEditing(r.id);
                    const draft = isEd ? rowEdit.draftValues : null;
                    const s = r.situation;
                    return (
                      <tr key={r.id} className="border-t align-top">
                        <td className="p-2 text-muted-foreground">{r.sourceGroup}</td>
                        <td className="p-2">
                          {isEd ? (
                            <Input
                              value={draft?.productName ?? ""}
                              onChange={(e) =>
                                rowEdit.setField("productName", e.target.value)
                              }
                              className="h-7 text-xs"
                            />
                          ) : (
                            r.productName || "—"
                          )}
                        </td>
                        <td className="p-2">
                          {isEd ? (
                            <Input
                              value={draft?.platformOrCategory ?? ""}
                              onChange={(e) =>
                                rowEdit.setField(
                                  "platformOrCategory",
                                  e.target.value,
                                )
                              }
                              className="h-7 text-xs"
                            />
                          ) : (
                            r.platformOrCategory || "—"
                          )}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {isEd ? (
                            <Input
                              type="number"
                              value={draft?.totalValue ?? ""}
                              onChange={(e) =>
                                rowEdit.setField(
                                  "totalValue",
                                  e.target.value === "" ? null : Number(e.target.value),
                                )
                              }
                              className="h-7 w-24 text-right text-xs"
                            />
                          ) : r.totalValue !== null ? (
                            formatBRL(r.totalValue)
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {isEd ? (
                            <Input
                              type="number"
                              value={draft?.paidValue ?? ""}
                              onChange={(e) =>
                                rowEdit.setField(
                                  "paidValue",
                                  e.target.value === "" ? null : Number(e.target.value),
                                )
                              }
                              className="h-7 w-24 text-right text-xs"
                            />
                          ) : r.paidValue !== null ? (
                            formatBRL(r.paidValue)
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-2">
                          <Badge variant="outline">{r.financialStatus}</Badge>
                        </td>
                        <td className="p-2">
                          <Badge
                            variant={
                              s === "Retirado"
                                ? "secondary"
                                : s === "Retirar" || s === "Abandonou"
                                  ? "outline"
                                  : "default"
                            }
                          >
                            {s ?? "Em Aberto"}
                          </Badge>
                        </td>
                        <td className="p-2 max-w-[14rem]">
                          {r.ai ? (
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-1">
                                <Badge variant="outline" className="text-[10px]">
                                  {r.ai.situationSuggestion}
                                </Badge>
                                <Badge variant="outline" className="text-[10px]">
                                  {r.ai.financialStatusSuggestion}
                                </Badge>
                                <span className="text-[10px] text-muted-foreground">
                                  {(r.ai.confidence * 100).toFixed(0)}%
                                </span>
                                {r.ai.needsReview && (
                                  <Sparkles className="h-3 w-3 text-amber-500" />
                                )}
                              </div>
                              {r.ai.evidence.length > 0 && (
                                <p className="line-clamp-2 text-[10px] italic text-muted-foreground">
                                  “{r.ai.evidence[0]}”
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-2">
                          <div className="flex flex-wrap justify-end gap-1">
                            {isEd ? (
                              <RowEditActions
                                onConfirm={() => void confirmEdit()}
                                onClose={rowEdit.close}
                              />
                            ) : (
                              <>
                                <RowEditPencil onStart={() => startEditRow(r)} />
                                {(s === "Retirar" || s === "Abandonou") && (
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => setRowSituation(r.id, "Retirado")}
                                  >
                                    Removido
                                  </Button>
                                )}
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  title="Ignorar linha"
                                  onClick={() => ignoreRow(r.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {clientsState.length > 0 && (
        <div className="flex justify-end gap-2 border-t pt-2">
          <Button variant="ghost" onClick={onDone} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void persistAll()} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1 h-4 w-4" />
            )}
            Importar {clientsState.length} cliente(s)
          </Button>
        </div>
      )}
    </div>
  );
}