/**
 * Rola o `.page-container` (ou a viewport quando o container ainda não
 * existe) até a seção com `id`, respeitando um offset visual pequeno.
 * Fonte única — usada pela navbar e pela one-page.
 */
export function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const container = document.querySelector<HTMLElement>(".page-container");
  if (!container) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const top =
    el.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop;
  container.scrollTo({ top: Math.max(0, top - 12), behavior: "smooth" });
}