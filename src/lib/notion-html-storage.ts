import { supabase } from "@/integrations/supabase/client";

/** Bucket privado que guarda os HTMLs originais importados do Notion. */
export const NOTION_HTML_BUCKET = "notion-html-originals";

/** SHA-1 hex do conteúdo (para detectar duplicatas/re-imports). */
export async function sha1Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-1", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeFileName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80) || "cliente.html";
}

export interface UploadedNotionHtml {
  path: string;
  checksum: string;
  fileName: string;
  importedAt: string;
  sourceFolder?: string;
}

/**
 * Faz upload do HTML original para o bucket privado.
 * Só usuários autorizados (admin/admin_master/gerente/supervisor) conseguem
 * gravar por causa das políticas RLS do storage.
 */
export async function uploadNotionHtml(params: {
  clientId: string;
  fileName: string;
  html: string;
  sourceFolder?: string;
}): Promise<UploadedNotionHtml> {
  const checksum = await sha1Hex(params.html);
  const importedAt = new Date().toISOString();
  const cleanName = safeFileName(params.fileName || "cliente.html");
  const path = `${params.clientId}/${checksum}-${cleanName}`;

  const blob = new Blob([params.html], { type: "text/html; charset=utf-8" });
  const { error } = await supabase.storage
    .from(NOTION_HTML_BUCKET)
    .upload(path, blob, {
      contentType: "text/html; charset=utf-8",
      upsert: true,
    });
  if (error) throw error;

  return {
    path,
    checksum,
    fileName: cleanName,
    importedAt,
    sourceFolder: params.sourceFolder,
  };
}

/**
 * Gera uma URL assinada temporária para visualização/download.
 * Falha silenciosa (retorna null) se o usuário não tiver permissão.
 */
export async function getNotionHtmlSignedUrl(
  path: string,
  opts: { download?: boolean; expiresInSec?: number } = {},
): Promise<string | null> {
  const expiresIn = opts.expiresInSec ?? 60;
  const { data, error } = await supabase.storage
    .from(NOTION_HTML_BUCKET)
    .createSignedUrl(path, expiresIn, {
      download: opts.download ? true : undefined,
    });
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export type NotionHtmlAccessAction =
  | "view_original_notion_html"
  | "download_original_notion_html";

/**
 * Registra visualização/download do HTML original.
 * Silencioso em caso de erro — RLS + policies bloqueiam usuários sem role.
 */
export async function logNotionHtmlAccess(params: {
  action: NotionHtmlAccessAction;
  clientId?: string;
  storagePath: string;
  fileName?: string;
}): Promise<void> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return;
    await supabase.from("notion_html_access_log").insert({
      action: params.action,
      client_id: params.clientId ?? null,
      storage_path: params.storagePath,
      file_name: params.fileName ?? null,
      user_id: user.id,
      user_email: user.email ?? null,
    });
  } catch (err) {
    console.warn("[notion-html] audit log falhou", err);
  }
}