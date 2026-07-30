// Espelha o estado do app no banco local sempre que algo muda no Modo Local.
import { useStore } from "./store";
import { isLocalMode } from "./local-mode";
import { persistLocalSnapshot } from "./local-package";
import { getUiStateSnapshot } from "./db-sync";

let stop: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Assina o store e grava (debounced) no IndexedDB enquanto o Modo Local estiver ativo. */
export function startLocalPersistence(): () => void {
  if (stop) return stop;
  const unsubscribe = useStore.subscribe((state, prev) => {
    if (!isLocalMode()) return;
    if (
      state.clients === prev.clients &&
      state.products === prev.products &&
      state.importHistory === prev.importHistory &&
      state.preferences === prev.preferences &&
      state.rules === prev.rules &&
      state.security === prev.security
    ) {
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void persistLocalSnapshot({
        clients: state.clients,
        products: state.products,
        importHistory: state.importHistory,
        preferences: state.preferences,
        rules: state.rules,
        security: state.security,
        uiState: getUiStateSnapshot(),
      }).catch(() => {});
    }, 600);
  });
  stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    unsubscribe();
    stop = null;
  };
  return stop;
}

/** Grava imediatamente (usado antes de exportar o ZIP). */
export async function flushLocalPersistence(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const state = useStore.getState();
  await persistLocalSnapshot({
    clients: state.clients,
    products: state.products,
    importHistory: state.importHistory,
    preferences: state.preferences,
    rules: state.rules,
    security: state.security,
    uiState: getUiStateSnapshot(),
  });
}