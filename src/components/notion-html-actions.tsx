import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getNotionHtmlSignedUrl,
  logNotionHtmlAccess,
  uploadNotionHtml,
} from "@/lib/notion-html-storage";
import { useStore } from "@/lib/store";

export interface NotionHtmlActionsProps {
  clientId?: string;
  fileName?: string;
  path: string;
  importedAt?: string;
  sourceFolder?: string;
  compact?: boolean;
  label?: string;
}

export function NotionHtmlActions({
  clientId,
  fileName,
  path,
  importedAt,
  sourceFolder,
  compact,
  label,
}: NotionHtmlActionsProps) {
  const [busy, setBusy] = useState<"view" | "download" | null>(null);

  async function open(mode: "view" | "download") {
    setBusy(mode);
    try {
      const url = await getNotionHtmlSignedUrl(path, {
        download: mode === "download",
        expiresInSec: 120,
      });
      if (!url) {
        toast.error("Você não tem permissão para acessar o HTML original.");
        return;
      }
      void logNotionHtmlAccess({
        action:
          mode === "view"
            ? "view_original_notion_html"
            : "download_original_notion_html",
        clientId,
        storagePath: path,
        fileName,
      });
      if (mode === "view") {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName || "notion-original.html";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao abrir o HTML original.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      {!compact && (
        <div className="text-[11px] text-muted-foreground">
          <div className="truncate" title={fileName}>
            Arquivo: <span className="font-medium">{fileName || "(sem nome)"}</span>
          </div>
          {sourceFolder && (
            <div>
              Pasta de origem: <span className="font-medium">{sourceFolder}</span>
            </div>
          )}
          {importedAt && (
            <div>Importado em: {new Date(importedAt).toLocaleString("pt-BR")}</div>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={busy !== null}
          onClick={() => void open("view")}
        >
          <FileText className="mr-1 h-3.5 w-3.5" />
          {label ?? "Ver HTML original do Notion"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          disabled={busy !== null}
          onClick={() => void open("download")}
        >
          <Download className="mr-1 h-3.5 w-3.5" />
          Baixar
        </Button>
      </div>
    </div>
  );
}

/**
 * Variante usada no preview de importação: o HTML ainda está em memória
 * (não foi enviado ao storage). Cria um Blob URL temporário para inspeção.
 */
export function NotionHtmlInlineActions({
  fileName,
  rawHtml,
}: {
  fileName?: string;
  rawHtml: string;
}) {
  function view() {
    const blob = new Blob([rawHtml], { type: "text/html; charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  function download() {
    const blob = new Blob([rawHtml], { type: "text/html; charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "notion-original.html";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={view}>
        <FileText className="mr-1 h-3.5 w-3.5" /> Ver HTML original
      </Button>
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={download}>
        <Download className="mr-1 h-3.5 w-3.5" /> Baixar
      </Button>
    </div>
  );
}

/**
 * Botão de anexar HTML original manualmente a um cliente existente que
 * ainda não tem HTML vinculado (ex.: importações antigas).
 */
export function NotionHtmlAttachButton({
  clientId,
  sourceFolder,
}: {
  clientId: string;
  sourceFolder?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const updateClient = useStore((s) => s.updateClient);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const html = await file.text();
      if (!/<html/i.test(html)) {
        toast.error("Arquivo não parece ser um HTML válido.");
        return;
      }
      const uploaded = await uploadNotionHtml({
        clientId,
        fileName: file.name,
        html,
        sourceFolder,
      });
      updateClient(clientId, {
        originalHtmlFileName: uploaded.fileName,
        originalHtmlStoragePath: uploaded.path,
        originalHtmlImportedAt: uploaded.importedAt,
        originalHtmlSourceFolder: uploaded.sourceFolder,
        originalHtmlChecksum: uploaded.checksum,
      });
      toast.success("HTML original vinculado ao cliente.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao anexar HTML.";
      toast.error(
        /row-level security|permission|denied|unauthor/i.test(msg)
          ? "Você não tem permissão para anexar HTML original."
          : msg,
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".html,text/html"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="mr-1 h-3.5 w-3.5" />
        {busy ? "Enviando…" : "Anexar HTML original"}
      </Button>
      <span className="text-[10px] text-muted-foreground">
        Envie o arquivo .html exportado do Notion desse cliente.
      </span>
    </div>
  );
}