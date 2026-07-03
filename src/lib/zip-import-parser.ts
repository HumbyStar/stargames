import JSZip from "jszip";
import {
  parseClientHtml,
  type HtmlImportPreview,
} from "./html-client-import-parser";

export interface ZipClientEntry {
  /** Caminho relativo dentro do ZIP (ex.: "Clientes (3)/Alice.html"). */
  path: string;
  /** Nome base do arquivo. */
  fileName: string;
  /** Nome da pasta imediata (ex.: "Clientes (3)") — vazio se raiz. */
  folder: string;
  /** HTML bruto do arquivo. */
  rawHtml: string;
  /** Resultado do parser HTML. */
  preview: HtmlImportPreview;
}

export interface ZipImportResult {
  clients: ZipClientEntry[];
  /** Nome da(s) pasta(s) de clientes detectadas. */
  folders: string[];
  // true quando encontramos pasta "Cliente"/"Clientes"; false = fallback raiz.
  matchedFolder: boolean;
}

// Regex da pasta de clientes exportada pelo Notion. Aceita "Clientes",
// "Cliente", "Clientes (3)" (o "(3)" é sufixo do Notion, não é quantidade),
// e subpastas ("Vendas/Clientes (2)").
const CLIENTS_FOLDER_RE = /(^|\/)Clientes?(\s*\([^)]*\))?\/?$/i;

function folderOf(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx < 0) return "";
  return path.slice(0, idx);
}

function baseOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx < 0 ? path : path.slice(idx + 1);
}

function isHtml(path: string): boolean {
  return /\.html?$/i.test(path);
}

/**
 * Percorre o ZIP e retorna um cliente por arquivo `*.html` encontrado dentro
 * de uma pasta do padrão Notion `Clientes*` (ou, no fallback, na raiz do ZIP).
 *
 * A quantidade de clientes é a **contagem real** dos arquivos HTML; qualquer
 * número entre parênteses no nome da pasta (`Clientes (3)`) é apenas sufixo do
 * Notion e é ignorado.
 */
export async function parseZipNotionFile(file: File | Blob): Promise<ZipImportResult> {
  const zip = await JSZip.loadAsync(file);
  const htmlEntries = Object.values(zip.files).filter(
    (f) => !f.dir && isHtml(f.name),
  );

  // Detecta pastas Clientes*: qualquer ancestral do arquivo cujo nome bata a regex.
  const inClientsFolder = (path: string): { in: boolean; folder: string } => {
    const dir = folderOf(path);
    if (!dir) return { in: false, folder: "" };
    const parts = dir.split("/");
    for (let i = parts.length; i > 0; i--) {
      const candidate = parts.slice(0, i).join("/") + "/";
      if (CLIENTS_FOLDER_RE.test(candidate)) {
        return { in: true, folder: parts[i - 1] };
      }
    }
    return { in: false, folder: parts[parts.length - 1] };
  };

  const matched: Array<{ folder: string; entry: (typeof htmlEntries)[number] }> = [];
  for (const e of htmlEntries) {
    const meta = inClientsFolder(e.name);
    if (meta.in) matched.push({ folder: meta.folder, entry: e });
  }

  const useFallback = matched.length === 0;
  const targetEntries = useFallback
    ? htmlEntries.map((e) => ({ folder: folderOf(e.name) || "(raiz)", entry: e }))
    : matched;

  const clients: ZipClientEntry[] = [];
  const foldersSet = new Set<string>();

  for (const { folder, entry } of targetEntries) {
    const rawHtml = await entry.async("string");
    const preview = parseClientHtml(rawHtml);
    // Ignora arquivos sem cliente reconhecido (index/toc do Notion, etc.).
    if (!preview.clientHeader.name && preview.rows.length === 0) continue;
    foldersSet.add(folder);
    clients.push({
      path: entry.name,
      fileName: baseOf(entry.name),
      folder,
      rawHtml,
      preview,
    });
  }

  return {
    clients,
    folders: Array.from(foldersSet),
    matchedFolder: !useFallback,
  };
}