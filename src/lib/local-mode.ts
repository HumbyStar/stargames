// ---------------------------------------------------------------------------
// Modo Local (instalação Windows / offline)
// ---------------------------------------------------------------------------
// Quando ativo, o app lê e grava no banco local (IndexedDB) em vez do banco
// na nuvem. Nada é enviado ao servidor: o caminho de volta é sempre o ZIP de
// backup exportado localmente → Modo Teste → produção.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "stargames.localMode";

export type LocalModePreference = "auto" | "always" | "off";

let preference: LocalModePreference = "auto";
let online = true;
let initialized = false;
let packageInstalled = false;

const listeners = new Set<() => void>();

function readPreference(): LocalModePreference {
  if (typeof window === "undefined") return "auto";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === "always" || raw === "off" ? raw : "auto";
}

function emit() {
  for (const cb of listeners) cb();
}

/** Inicializa a detecção de conexão (chamado uma vez pelo layout). */
export function initLocalMode(): () => void {
  if (typeof window === "undefined") return () => {};
  if (initialized) return () => {};
  initialized = true;
  preference = readPreference();
  online = window.navigator.onLine !== false;
  void (async () => {
    try {
      const { hasLocalPackage } = await import("./local-db");
      packageInstalled = await hasLocalPackage();
      emit();
    } catch {
      packageInstalled = false;
    }
  })();
  const goOnline = () => {
    online = true;
    emit();
  };
  const goOffline = () => {
    online = false;
    emit();
  };
  window.addEventListener("online", goOnline);
  window.addEventListener("offline", goOffline);
  return () => {
    window.removeEventListener("online", goOnline);
    window.removeEventListener("offline", goOffline);
    initialized = false;
  };
}

export function isOnline(): boolean {
  if (typeof window === "undefined") return true;
  if (!initialized) return window.navigator.onLine !== false;
  return online;
}

export function getLocalModePreference(): LocalModePreference {
  if (!initialized) preference = readPreference();
  return preference;
}

export function setLocalModePreference(next: LocalModePreference): void {
  preference = next;
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, next);
  emit();
}

/** Marca se existe um pacote instalado neste PC (após instalar/limpar). */
export function setLocalPackageInstalled(value: boolean): void {
  packageInstalled = value;
  emit();
}

export function hasInstalledPackage(): boolean {
  return packageInstalled;
}

/**
 * `true` quando o app deve operar contra o banco local.
 * - "always": sempre local (usuário forçou)
 * - "off": nunca local
 * - "auto": local somente quando o navegador está sem conexão
 * Em qualquer caso exige um pacote local instalado.
 */
export function isLocalMode(): boolean {
  if (typeof window === "undefined") return false;
  if (!packageInstalled) return false;
  const pref = getLocalModePreference();
  if (pref === "always") return true;
  if (pref === "off") return false;
  return !isOnline();
}

export function subscribeLocalMode(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Notifica manualmente (usado após instalar/limpar o pacote local). */
export function notifyLocalModeChanged(): void {
  emit();
}