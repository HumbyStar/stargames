import { useEffect, useState } from "react";

/**
 * Mantém a lista da seção minimizada por padrão (ao entrar/recarregar o site)
 * e expande automaticamente quando o usuário está visualizando aquela seção.
 * Ao sair da seção, a lista volta a ficar compacta.
 *
 * O usuário ainda pode alternar manualmente via o botão Compactar/Expandir;
 * a próxima mudança de seção reaplica o comportamento automático.
 */
export function useSectionCompact(sectionId: string): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [compact, setCompact] = useState<boolean>(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = document.getElementById(sectionId);
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Considera "ativa" quando uma parte significativa da seção está no viewport.
          setCompact(!(entry.isIntersecting && entry.intersectionRatio >= 0.25));
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [sectionId]);

  return [compact, setCompact];
}