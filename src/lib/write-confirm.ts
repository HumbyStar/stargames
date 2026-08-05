/**
 * Confirmação de escrita: uma ação só pode ser anunciada como "sucesso"
 * depois que o banco confirmou o estado final (ou o evento realtime da
 * própria linha chegou). Isso elimina o "sucesso falso" — a mensagem de
 * êxito sem a gravação correspondente na base.
 */
export type RowKind = "client" | "product";
export type RowOp = "upsert" | "delete";

type Listener = (kind: RowKind, id: string, op: RowOp) => void;

const listeners = new Set<Listener>();

/** Chamado pelo canal realtime quando uma linha chega do banco. */
export function notifyRowConfirmed(kind: RowKind, id: string, op: RowOp): void {
  for (const l of Array.from(listeners)) {
    try {
      l(kind, id, op);
    } catch {
      /* listener isolado nunca derruba o canal */
    }
  }
}

export function onRowConfirmed(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export interface ConfirmOptions {
  /** Consulta que devolve os ids realmente presentes no banco. */
  verify?: (kind: RowKind, ids: string[]) => Promise<Set<string>>;
  timeoutMs?: number;
  pollMs?: number;
}

export interface ConfirmResult {
  confirmed: string[];
  missing: string[];
  ok: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Espera a confirmação real de `ids`:
 * - `upsert`: id presente no banco;
 * - `delete`: id ausente no banco.
 * O evento realtime correspondente adianta a confirmação; a consulta de
 * verificação é a rede de segurança quando o evento se perde.
 */
export async function waitForRowConfirmation(
  kind: RowKind,
  ids: string[],
  op: RowOp,
  opts: ConfirmOptions = {},
): Promise<ConfirmResult> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return { confirmed: [], missing: [], ok: true };

  const timeoutMs = opts.timeoutMs ?? 8000;
  const pollMs = opts.pollMs ?? 400;
  const pending = new Set(unique);
  const confirmed = new Set<string>();

  const off = onRowConfirmed((k, id, o) => {
    if (k !== kind || o !== op) return;
    if (pending.delete(id)) confirmed.add(id);
  });

  const started = Date.now();
  try {
    while (pending.size > 0 && Date.now() - started < timeoutMs) {
      if (opts.verify) {
        try {
          const present = await opts.verify(kind, Array.from(pending));
          for (const id of Array.from(pending)) {
            const isPresent = present.has(id);
            if (op === "upsert" ? isPresent : !isPresent) {
              pending.delete(id);
              confirmed.add(id);
            }
          }
        } catch {
          /* falha transitória de rede: tenta de novo no próximo ciclo */
        }
      }
      if (pending.size === 0) break;
      await sleep(pollMs);
    }
  } finally {
    off();
  }

  const missing = Array.from(pending);
  return { confirmed: Array.from(confirmed), missing, ok: missing.length === 0 };
}
