import { create } from "zustand";

export type HistoryContext =
  | "clientes-todos"
  | "desistiu"
  | "abandonou"
  | "mgmv-todos";

/**
 * Pequeno store de UI para abrir/fechar modais globais a partir de
 * qualquer ponto da árvore (navbar, dashboard, etc).
 */
interface UiState {
  importOpen: boolean;
  equipeOpen: boolean;
  settingsOpen: boolean;
  settingsLocked: boolean;
  helpOpen: boolean;
  notificationsOpen: boolean;
  conciergeOpen: boolean;
  financeOpen: boolean;
  historyContext: HistoryContext | null;
  activeTutorialId: string | null;
  activeSection: string;
  setActiveSection: (id: string) => void;
  openImport: () => void;
  closeImport: () => void;
  openEquipe: () => void;
  closeEquipe: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  setSettingsLocked: (v: boolean) => void;
  openHelp: () => void;
  closeHelp: () => void;
  openNotifications: () => void;
  closeNotifications: () => void;
  openConcierge: () => void;
  closeConcierge: () => void;
  openFinance: () => void;
  closeFinance: () => void;
  openHistory: (ctx: HistoryContext) => void;
  closeHistory: () => void;
  startTutorial: (id: string) => void;
  stopTutorial: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  importOpen: false,
  equipeOpen: false,
  settingsOpen: false,
  settingsLocked: false,
  helpOpen: false,
  notificationsOpen: false,
  conciergeOpen: false,
  financeOpen: false,
  historyContext: null,
  activeTutorialId: null,
  activeSection: "dashboard",
  setActiveSection: (id) => set({ activeSection: id }),
  openImport: () => set({ importOpen: true }),
  closeImport: () => set({ importOpen: false }),
  openEquipe: () => set({ equipeOpen: true }),
  closeEquipe: () => set({ equipeOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () =>
    set((s) => (s.settingsLocked ? s : { settingsOpen: false })),
  setSettingsLocked: (v) => set({ settingsLocked: v }),
  openHelp: () => set({ helpOpen: true }),
  closeHelp: () => set({ helpOpen: false }),
  openNotifications: () => set({ notificationsOpen: true }),
  closeNotifications: () => set({ notificationsOpen: false }),
  openConcierge: () => set({ conciergeOpen: true }),
  closeConcierge: () => set({ conciergeOpen: false }),
  openFinance: () => set({ financeOpen: true }),
  closeFinance: () => set({ financeOpen: false }),
  openHistory: (ctx) => set({ historyContext: ctx }),
  closeHistory: () => set({ historyContext: null }),
  startTutorial: (id) => set({ activeTutorialId: id }),
  stopTutorial: () => set({ activeTutorialId: null }),
}));