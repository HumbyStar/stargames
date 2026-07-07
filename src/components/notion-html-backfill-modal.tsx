import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStore } from "@/lib/store";
import { uploadNotionHtml } from "@/lib/notion-html-storage";

interface Row {
  file: File;
  html?: string;
  title?: string;
  phoneDigits?: string;
  clientId?: string;
  clientName?: string;
  status: "pending" | "matched" | "unmatched" | "already" | "saving" | "saved" | "error";
  error?: string;
}

const digits = (s: string) => s.replace(/\D/g, "");

function extractTitle(html: string): string | undefined {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim() : undefined;
}

export function NotionHtmlBackfillButton() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const clients = useStore((s) => s.clients);
  const updateClient = useStore((s) => s.updateClient);

  const clientsByPhone = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    for (const c of clients) {
      const d = digits(c.phone || "");
      if (d) m.set(d, { id: c.id, name: c.name });
    }
    return m;
  }, [clients]);

  function matchPhone(candidate: string): { id: string; name: string } | undefined {
    const d = digits(candidate);
    if (!d) return undefined;
    // Exact
    if (clientsByPhone.has(d)) return clientsByPhone.get(d);
    // Suffix match: last 8-11 digits
    for (const len of [11, 10, 9, 8]) {
      if (d.length < len) continue;
      const tail = d.slice(-len);
      for (const [k, v] of clientsByPhone.entries()) {
        if (k.endsWith(tail) || tail.endsWith(k)) return v;
      }
    }
    return undefined;
  }

  async function handleFiles(files: FileList) {
    const list: Row[] = [];
    for (const f of Array.from(files)) {
      if (!/\.html?$/i.test(f.name)) continue;
      try {
        const html = await f.text();
        const title = extractTitle(html);
        // Try phone from title first, then filename
        const phoneStr =
          (title && digits(title)) || digits(f.name);
        const match = matchPhone(phoneStr);
        const client = match ? clients.find((c) => c.id === match.id) : undefined;
        list.push({
          file: f,
          html,
          title,
          phoneDigits: phoneStr,
          clientId: match?.id,
          clientName: match?.name,
          status: match
            ? client?.originalHtmlStoragePath
              ? "already"
              : "matched"
            : "unmatched",
        });
      } catch (e) {
        list.push({
          file: f,
          status: "error",
          error: e instanceof Error ? e.message : "Falha ao ler",
        });
      }
    }
    setRows(list);
  }

  async function persistAll() {
    setBusy(true);
    let saved = 0;
    let failed = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.status !== "matched" || !r.clientId || !r.html) continue;
      setRows((prev) => prev.map((x, idx) => (idx === i ? { ...x, status: "saving" } : x)));
      try {
        const uploaded = await uploadNotionHtml({
          clientId: r.clientId,
          fileName: r.file.name,
          html: r.html,
        });
        updateClient(r.clientId, {
          originalHtmlFileName: uploaded.fileName,
          originalHtmlStoragePath: uploaded.path,
          originalHtmlImportedAt: uploaded.importedAt,
          originalHtmlChecksum: uploaded.checksum,
        });
        saved++;
        setRows((prev) => prev.map((x, idx) => (idx === i ? { ...x, status: "saved" } : x)));
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : "Falha";
        setRows((prev) =>
          prev.map((x, idx) => (idx === i ? { ...x, status: "error", error: msg } : x)),
        );
      }
    }
    setBusy(false);
    if (saved) toast.success(`${saved} HTML(s) vinculado(s) aos clientes.`);
    if (failed) toast.error(`${failed} falha(s) ao vincular.`);
  }

  const stats = useMemo(() => {
    const s = { matched: 0, unmatched: 0, already: 0, saved: 0, error: 0 };
    for (const r of rows) {
      if (r.status === "matched") s.matched++;
      else if (r.status === "unmatched") s.unmatched++;
      else if (r.status === "already") s.already++;
      else if (r.status === "saved") s.saved++;
      else if (r.status === "error") s.error++;
    }
    return s;
  }, [rows]);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FileUp className="mr-1 h-4 w-4" /> Vincular HTMLs originais
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Vincular HTMLs originais aos clientes</DialogTitle>
            <DialogDescription>
              Selecione os arquivos <code>.html</code> exportados do Notion. O sistema
              identifica automaticamente o cliente pelo telefone extraído do título/nome do
              arquivo e vincula o HTML — sem precisar anexar um por um.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".html,text/html"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void handleFiles(e.target.files);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              Selecionar arquivos .html
            </Button>
            {rows.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {rows.length} arquivo(s) • {stats.matched} identificado(s) •{" "}
                {stats.unmatched} sem match • {stats.already} já vinculado(s) •{" "}
                {stats.saved} salvo(s) • {stats.error} erro(s)
              </span>
            )}
          </div>

          {rows.length > 0 && (
            <div className="max-h-96 overflow-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="p-2 text-left">Arquivo</th>
                    <th className="p-2 text-left">Cliente detectado</th>
                    <th className="p-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="p-2 truncate max-w-[260px]" title={r.file.name}>
                        {r.file.name}
                      </td>
                      <td className="p-2">
                        {r.clientName ?? (
                          <span className="italic text-muted-foreground">— não encontrado</span>
                        )}
                      </td>
                      <td className="p-2">
                        {r.status === "matched" && "Pronto para salvar"}
                        {r.status === "unmatched" && "Sem correspondência"}
                        {r.status === "already" && "Já vinculado"}
                        {r.status === "saving" && (
                          <span className="inline-flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" /> Salvando…
                          </span>
                        )}
                        {r.status === "saved" && (
                          <span className="text-emerald-500">✓ Salvo</span>
                        )}
                        {r.status === "error" && (
                          <span className="text-destructive" title={r.error}>
                            Erro
                          </span>
                        )}
                        {r.status === "pending" && "…"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Fechar
            </Button>
            <Button
              disabled={busy || stats.matched === 0}
              onClick={() => void persistAll()}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Salvando…
                </>
              ) : (
                <>Vincular {stats.matched > 0 ? `(${stats.matched})` : ""}</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
