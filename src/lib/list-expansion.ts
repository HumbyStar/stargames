import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Estado de expansão/minimização das listas por seção.
 * Padrão: minimizado. Persistido apenas a preferência do usuário.
 * Não persiste dados de importação, clientes, MGMV ou collection.
 */
export type ListSection = "clients" | "mgmv" | "collection";

interface State {
  preferred: Record<ListSection, boolean>;
  setPreferred: (s: ListSection, v: boolean) => void;
}

export const useListExpansionStore = create<State>()(
  persist(
    (set) => ({
      preferred: { clients: false, mgmv: false, collection: false },
      setPreferred: (s, v) =>
        set((st) => ({ preferred: { ...st.preferred, [s]: v } })),
    }),
    { name: "sg-list-expansion-v1" },
  ),
);

export function useListExpansion(section: ListSection) {
  const expanded = useListExpansionStore((s) => s.preferred[section]);
  const setPreferred = useListExpansionStore((s) => s.setPreferred);
  return {
    expanded,
    toggle: () => setPreferred(section, !expanded),
    expand: () => setPreferred(section, true),
    minimize: () => setPreferred(section, false),
  };
}