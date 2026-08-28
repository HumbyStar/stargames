const KEY = "sg:chunk-reload";

/**
 * Erros de carregamento de chunk: a aba está com uma versão antiga do app
 * e tentou baixar um módulo que não existe mais naquele endereço.
 */
export function isChunkLoadError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? `${error.message} ${error.name}`
      : typeof error === "string"
        ? error
        : "";
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk .* failed/i.test(
    msg,
  );
}

/** Já tentamos recarregar nesta sessão? */
export function chunkReloadAttempted(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Recarrega a página uma única vez por sessão. Retorna `true` quando o
 * reload foi disparado, `false` quando já houve tentativa.
 */
export function recoverFromChunkError(): boolean {
  if (typeof window === "undefined") return false;
  if (chunkReloadAttempted()) return false;
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    // sem storage: evita loop não recarregando
    return false;
  }
  window.location.reload();
  return true;
}

/** Limpa o marcador após um carregamento bem-sucedido. */
export function clearChunkReloadMark() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // storage indisponível
  }
}
