import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Monta o conteúdo da seção só quando o wrapper entra em cerca de uma
 * viewport de distância do usuário. Enquanto isso, mantém apenas o
 * placeholder com altura reservada, para que a navbar consiga rolar até
 * a seção (o `id` fica no wrapper) e o layout não pule.
 */
export function LazySection({
  id,
  minHeight = "80vh",
  rootSelector = ".page-container",
  children,
}: {
  id: string;
  minHeight?: string;
  rootSelector?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (mounted) return;
    const el = ref.current;
    if (!el) return;
    const root = document.querySelector<HTMLElement>(rootSelector) ?? null;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMounted(true);
          io.disconnect();
        }
      },
      { root, rootMargin: "100% 0px 100% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mounted, rootSelector]);

  return (
    <div id={id} ref={ref} style={mounted ? undefined : { minHeight }}>
      {mounted ? children : null}
    </div>
  );
}