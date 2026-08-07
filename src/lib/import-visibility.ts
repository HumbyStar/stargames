import { useStore } from "./store";

/**
 * Confirmação de exibição: depois que o banco confirma a gravação, ainda é
 * preciso garantir que os registros estão de fato na lista em memória (a
 * mesma que a tela lê). Só então a importação assistida pode ser encerrada.
 */
export interface VisibilityResult {
  ok: boolean;
  missingClients: string[];
  missingProducts: string[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function missingIds(clientIds: string[], productIds: string[]) {
  const s = useStore.getState();
  const clientSet = new Set(s.clients.map((c) => c.id));
  const productSet = new Set(s.products.map((p) => p.id));
  return {
    missingClients: clientIds.filter((id) => !clientSet.has(id)),
    missingProducts: productIds.filter((id) => !productSet.has(id)),
  };
}

/**
 * Espera até que todos os clientes/produtos criados apareçam no store,
 * disparando releitura direcionada por cliente enquanto faltar algo.
 */
export async function waitUntilVisibleInStore(
  clientIds: string[],
  productIds: string[],
  opts: {
    timeoutMs?: number;
    pollMs?: number;
    /** Clientes cujos dados devem ser relidos enquanto faltar algo. */
    refreshClientIds?: string[];
    onProgress?: (msg: string) => void;
  } = {},
): Promise<VisibilityResult> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const pollMs = opts.pollMs ?? 500;
  const started = Date.now();

  let state = missingIds(clientIds, productIds);
  while (
    (state.missingClients.length > 0 || state.missingProducts.length > 0) &&
    Date.now() - started < timeoutMs
  ) {
    opts.onProgress?.(
      `Confirmando exibição na tela… faltam ${state.missingClients.length} cliente(s) e ${state.missingProducts.length} produto(s).`,
    );
    // Releitura direcionada: só os clientes envolvidos, nunca a base inteira.
    const affected = new Set<string>(state.missingClients);
    const store = useStore.getState();
    for (const pid of state.missingProducts) {
      const known = store.products.find((p) => p.id === pid);
      if (known) affected.add(known.clientId);
    }
    for (const cid of clientIds) affected.add(cid);
    for (const cid of opts.refreshClientIds ?? []) affected.add(cid);
    for (const cid of Array.from(affected)) {
      try {
        await useStore.getState().refreshClientData(cid);
      } catch {
        /* tenta de novo no próximo ciclo */
      }
    }
    state = missingIds(clientIds, productIds);
    if (state.missingClients.length === 0 && state.missingProducts.length === 0) break;
    await sleep(pollMs);
    state = missingIds(clientIds, productIds);
  }

  return {
    ok: state.missingClients.length === 0 && state.missingProducts.length === 0,
    ...state,
  };
}
