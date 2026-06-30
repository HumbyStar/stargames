import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Renderiza filhos apenas quando o container entra (ou está perto de entrar)
 * no viewport. Mantém a altura reservada antes do mount para não causar
 * "jump" no scroll. Uma vez montado, permanece montado para preservar o
 * estado interno (filtros, paginação, etc.).
 */
export function LazySection({
  anchorId,
  minHeight = 600,
  rootMargin = "800px",
  children,
  fallback,
}: {
  anchorId?: string;
  minHeight?: number;
  rootMargin?: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;

    // Se o usuário chega via âncora (#clientes), montar imediatamente.
    if (typeof window !== "undefined" && anchorId && window.location.hash === `#${anchorId}`) {
      setVisible(true);
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible, rootMargin, anchorId]);

  return (
    <div
      ref={ref}
      id={!visible ? anchorId : undefined}
      style={visible ? undefined : { minHeight }}
    >
      {visible ? (
        <Suspense fallback={fallback ?? <SectionSkeleton minHeight={minHeight} />}>
          {children}
        </Suspense>
      ) : (
        fallback ?? <SectionSkeleton minHeight={minHeight} />
      )}
    </div>
  );
}

function SectionSkeleton({ minHeight }: { minHeight: number }) {
  return (
    <div
      className="one-page-section animate-pulse"
      style={{ minHeight }}
      aria-hidden="true"
    >
      <div className="h-8 w-48 rounded bg-muted/60" />
      <div className="mt-4 h-4 w-64 rounded bg-muted/40" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="h-24 rounded-xl bg-muted/40" />
        <div className="h-24 rounded-xl bg-muted/40" />
        <div className="h-24 rounded-xl bg-muted/40" />
        <div className="h-24 rounded-xl bg-muted/40" />
      </div>
      <div className="mt-6 h-64 rounded-xl bg-muted/30" />
    </div>
  );
}