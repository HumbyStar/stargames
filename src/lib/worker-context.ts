type WorkerLikeContext = {
  waitUntil?: (promise: Promise<unknown>) => void;
};

let currentContext: WorkerLikeContext | undefined;

export async function withWorkerContext<T>(ctx: unknown, run: () => Promise<T>): Promise<T> {
  const previous = currentContext;
  currentContext = (ctx ?? undefined) as WorkerLikeContext | undefined;
  try {
    return await run();
  } finally {
    currentContext = previous;
  }
}

export function deferWithWorkerContext(promise: Promise<unknown>): boolean {
  const waitUntil = currentContext?.waitUntil;
  if (typeof waitUntil !== "function") return false;
  waitUntil.call(currentContext, promise);
  return true;
}