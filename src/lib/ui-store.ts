import { create } from "zustand";

/**
 * Pequeno store de UI para abrir/fechar modais globais a partir de
 * qualquer ponto da árvore (navbar, dashboard, etc).
 */
interface UiState {
  importOpen: boolean;
  settingsOpen: boolean;
  helpOpen: boolean;
  openImport: () => void;
  closeImport: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openHelp: () => void;
  closeHelp: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  importOpen: false,
  settingsOpen: false,
  helpOpen: false,
  openImport: () => set({ importOpen: true }),
  closeImport: () => set({ importOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openHelp: () => set({ helpOpen: true }),
  closeHelp: () => set({ helpOpen: false }),
}));