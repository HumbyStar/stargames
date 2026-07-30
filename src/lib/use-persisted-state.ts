import { useCallback, useEffect, useRef, useState } from "react";
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
  // `initial` costuma ser um literal inline (objeto/array) recriado a cada
  // render. Se ele entrar nas dependências, o efeito abaixo re-executa
  // infinitamente (setState → render → nova identidade → efeito), derrubando
  // a página com "Maximum update depth exceeded". Guardamos em ref e
  // dependemos apenas de `key`.
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const read = useCallback(() => getUiValue<T>(key, initialRef.current), [key]);
  const [value, setValueLocal] = useState<T>(() => (isUiLoaded() ? read() : initial));

  // Evita re-render quando o valor lido é equivalente ao atual.
  const applyRead = useCallback(() => {
    setValueLocal((prev) => {
      const next = read();
      if (Object.is(prev, next)) return prev;
      try {
        if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
      } catch {
        /* valores não serializáveis: segue com o novo */
      }
      return next;
    });
  }, [read]);

  // Atualiza o valor assim que a hidratação inicial terminar.
  useEffect(() => {
    let cancelled = false;
    whenUiLoaded(() => {
      if (cancelled) return;
      applyRead();
    });
    const unsub = subscribeUi(key, () => {
      applyRead();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [key, applyRead]);

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