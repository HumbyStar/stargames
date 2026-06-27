import { useCallback, useEffect, useState } from "react";
import {
  getUiValue,
  isUiLoaded,
  setUiValue,
  subscribeUi,
  whenUiLoaded,
} from "./db-sync";

/**
 * Estado persistido no banco Lovable Cloud em `app_settings.ui_state`
 * (chave por `key`). Antes da hidratação inicial usa o valor `initial`;
 * depois espelha o valor salvo. Escritas são debounced e sincronizadas
 * em background entre abas/componentes que compartilham a mesma chave.
 */
export function usePersistedState<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const read = useCallback(() => getUiValue<T>(key, initial), [key, initial]);
  const [value, setValueLocal] = useState<T>(() => (isUiLoaded() ? read() : initial));

  // Atualiza o valor assim que a hidratação inicial terminar.
  useEffect(() => {
    let cancelled = false;
    whenUiLoaded(() => {
      if (cancelled) return;
      setValueLocal(read());
    });
    const unsub = subscribeUi(key, () => {
      setValueLocal(read());
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [key, read]);

  const setValue: React.Dispatch<React.SetStateAction<T>> = useCallback(
    (next) => {
      setValueLocal((prev) => {
        const computed =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        setUiValue(key, computed);
        return computed;
      });
    },
    [key],
  );

  return [value, setValue];
}