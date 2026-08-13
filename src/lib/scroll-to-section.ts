import { useUiStore } from "@/lib/ui-store";

/**
 * Seções que precisam montar imediatamente porque o usuário navegou até
 * elas (clique na navbar / atalho), antes do agendamento ocioso normal.
 */
const requested = new Set<string>();
const listeners = new Map<string, Set<() => void>>();

export function isSectionMountRequested(id: string) {
  return requested.has(id);
}

export function requestSectionMount(id: string) {
  if (requested.has(id)) return;
  requested.add(id);
  listeners.get(id)?.forEach((cb) => cb());
}

export function onSectionMountRequest(id: string, cb: () => void) {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
  };
}

/**
 * Enquanto uma rolagem programática está em curso, o observador de seção
 * ativa deve ignorar as seções intermediárias (senão a navbar "pisca"
 * percorrendo todos os itens até chegar ao destino).
 */
let lockUntil = 0;
export function isNavScrollLocked() {
  return performance.now() < lockUntil;
}

function targetTop(el: HTMLElement, container: HTMLElement) {
  return Math.max(
    0,
    el.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      12,
  );
}

/**
 * Rola o `.page-container` (ou a viewport quando o container ainda não
 * existe) até a seção com `id`, respeitando um offset visual pequeno.
 * Fonte única — usada pela navbar e pela one-page.
 *
 * Também força a montagem da seção-alvo (caso ainda esteja adiada) e
 * corrige a posição depois que o conteúdo entra no DOM, além de marcar a
 * seção como ativa imediatamente para a navbar responder no clique.
 */
export function scrollToSection(id: string) {
  requestSectionMount(id);
  useUiStore.getState().setActiveSection(id);
  lockUntil = performance.now() + 800;

  const container = document.querySelector<HTMLElement>(".page-container");
  const el = document.getElementById(id);
  if (!el) return;
  if (!container) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  container.scrollTo({ top: targetTop(el, container), behavior: "smooth" });

  // A seção pode ter acabado de montar (altura muda) — reajusta o alvo
  // algumas vezes, sem custo perceptível, e só quando há desvio real.
  let tries = 0;
  const correct = () => {
    tries += 1;
    const node = document.getElementById(id);
    if (node) {
      const top = targetTop(node, container);
      if (Math.abs(container.scrollTop - top) > 8) {
        container.scrollTo({ top, behavior: "smooth" });
        lockUntil = performance.now() + 500;
      }
    }
    if (tries < 3) window.setTimeout(correct, 180);
  };
  window.setTimeout(correct, 180);
}