// ---------------------------------------------------------------------------
// Registro do Service Worker (instalação local / offline)
// ---------------------------------------------------------------------------
// Registra APENAS no app publicado. Em dev, dentro de iframe ou em qualquer
// domínio de preview da Lovable o worker é removido, para nunca servir HTML
// velho durante o desenvolvimento. `?sw=off` funciona como interruptor.
// ---------------------------------------------------------------------------

const SW_URL = "/sw.js";

function isPreviewHost(hostname: string): boolean {
  return (
    hostname.startsWith("id-preview--") ||
    hostname.startsWith("preview--") ||
    hostname === "lovableproject.com" ||
    hostname.endsWith(".lovableproject.com") ||
    hostname === "lovableproject-dev.com" ||
    hostname.endsWith(".lovableproject-dev.com") ||
    hostname === "beta.lovable.dev" ||
    hostname.endsWith(".beta.lovable.dev")
  );
}

function shouldRegister(): boolean {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;
  if (!import.meta.env.PROD) return false;
  if (window.self !== window.top) return false;
  if (isPreviewHost(window.location.hostname)) return false;
  if (new URLSearchParams(window.location.search).get("sw") === "off") return false;
  return true;
}

async function unregisterAppWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
  await Promise.allSettled(
    registrations
      .filter((r) => (r.active?.scriptURL ?? r.installing?.scriptURL ?? "").endsWith(SW_URL))
      .map((r) => r.unregister()),
  );
}

/** Chamado uma vez no layout autenticado. */
export function registerServiceWorker(): void {
  if (!shouldRegister()) {
    void unregisterAppWorker();
    return;
  }
  void navigator.serviceWorker.register(SW_URL, { scope: "/" }).catch(() => {});
}

export function isStandaloneInstall(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// ---- prompt de instalação do navegador ----
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: InstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();

export function initInstallPrompt(): () => void {
  if (typeof window === "undefined") return () => {};
  const onPrompt = (e: Event) => {
    e.preventDefault();
    deferredPrompt = e as InstallPromptEvent;
    for (const cb of promptListeners) cb();
  };
  const onInstalled = () => {
    deferredPrompt = null;
    for (const cb of promptListeners) cb();
  };
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

export function canPromptInstall(): boolean {
  return deferredPrompt !== null;
}

export function subscribeInstallPrompt(cb: () => void): () => void {
  promptListeners.add(cb);
  return () => promptListeners.delete(cb);
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  const evt = deferredPrompt;
  deferredPrompt = null;
  for (const cb of promptListeners) cb();
  await evt.prompt();
  const choice = await evt.userChoice;
  return choice.outcome;
}