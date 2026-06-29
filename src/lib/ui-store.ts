import { create } from "zustand";

/**
 * Pequeno store de UI para abrir/fechar modais globais a partir de
 * qualquer ponto da árvore (navbar, dashboard, etc).
 */
interface UiState {
  importOpen: boolean;
  settingsOpen: boolean;
  helpOpen: boolean;
  notificationsOpen: boolean;
  conciergeOpen: boolean;
  activeTutorialId: string | null;
  openImport: () => void;
  closeImport: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openHelp: () => void;
  closeHelp: () => void;
  openNotifications: () => void;
  closeNotifications: () => void;
  openConcierge: () => void;
  closeConcierge: () => void;
  startTutorial: (id: string) => void;
  stopTutorial: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  importOpen: false,
  settingsOpen: false,
  helpOpen: false,
  notificationsOpen: false,
  conciergeOpen: false,
  activeTutorialId: null,
  openImport: () => set({ importOpen: true }),
  closeImport: () => set({ importOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openHelp: () => set({ helpOpen: true }),
  closeHelp: () => set({ helpOpen: false }),
  openNotifications: () => set({ notificationsOpen: true }),
  closeNotifications: () => set({ notificationsOpen: false }),
  openConcierge: () => set({ conciergeOpen: true }),
  closeConcierge: () => set({ conciergeOpen: false }),
  startTutorial: (id) => set({ activeTutorialId: id }),
  stopTutorial: () => set({ activeTutorialId: null }),
}));