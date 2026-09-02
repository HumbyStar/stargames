import { useEffect } from "react";
import { useStore } from "@/lib/store";

/**
 * Carrega a base (clientes/produtos/MGMV) sob demanda.
 *
 * O app abre sem ler as listas completas — só preferências e histórico.
 * Qualquer tela que realmente precise dos dados chama este hook; a leitura
 * acontece uma única vez por sessão/ambiente.
 */
export function useEnsureData(active = true): boolean {
  const ensureDataLoaded = useStore((s) => s.ensureDataLoaded);
  const dataLoading = useStore((s) => s.dataLoading);
  const dataLoaded = useStore((s) => s.dataLoaded);

  useEffect(() => {
    if (active && !dataLoaded) void ensureDataLoaded();
  }, [active, dataLoaded, ensureDataLoaded]);

  return dataLoading && !dataLoaded;
}
