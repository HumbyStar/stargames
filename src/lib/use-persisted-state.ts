import { useEffect, useRef, useState } from "react";

/**
 * useState que persiste o valor em localStorage sob `key`.
 * Carrega o valor salvo no primeiro render do cliente (SSR-safe).
 */
export function usePersistedState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initial);
  const hydrated = useRef(false);

  // Hidrata a partir do localStorage no client (uma única vez).
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
      if (raw != null) {
        setValue(JSON.parse(raw) as T);
      }
    } catch {
      // ignora JSON inválido ou storage indisponível
    }
    hydrated.current = true;
  }, [key]);

  // Salva mudanças após a hidratação para não sobrescrever o valor salvo.
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage cheio / indisponível
    }
  }, [key, value]);

  return [value, setValue];
}