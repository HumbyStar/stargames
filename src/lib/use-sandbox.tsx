import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getSandboxState,
  setSandboxMode,
  type SandboxState,
} from "@/lib/sandbox.functions";

interface SandboxContextValue {
  state: SandboxState;
  loading: boolean;
  refresh: () => Promise<void>;
  setActive: (active: boolean) => Promise<void>;
}

const EMPTY: SandboxState = { active: false, clonedAt: null, counts: {}, isAdmin: false };

const SandboxContext = createContext<SandboxContextValue>({
  state: EMPTY,
  loading: false,
  refresh: async () => {},
  setActive: async () => {},
});

/** Recarrega todos os dados do app sem F5 (mesmo evento usado no reset/restore). */
export function reloadAppData() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("app:reset"));
  }
}

export function SandboxProvider({ children }: { children: ReactNode }) {
  const fetchState = useServerFn(getSandboxState);
  const setMode = useServerFn(setSandboxMode);
  const [state, setState] = useState<SandboxState>(EMPTY);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchState();
      setState(next);
    } catch {
      setState(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [fetchState]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setActive = useCallback(
    async (active: boolean) => {
      const next = await setMode({ data: { active } });
      setState(next);
      reloadAppData();
    },
    [setMode],
  );

  const value = useMemo(
    () => ({ state, loading, refresh, setActive }),
    [state, loading, refresh, setActive],
  );

  return <SandboxContext.Provider value={value}>{children}</SandboxContext.Provider>;
}

export function useSandbox() {
  return useContext(SandboxContext);
}