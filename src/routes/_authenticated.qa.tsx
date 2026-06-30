import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, RefreshCw, AlertTriangle, Smartphone, Tablet, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/qa")({
  head: () => ({
    meta: [
      { title: "QA — Responsividade & Modais" },
      { name: "description", content: "Checklist de aceite para responsividade e modais." },
    ],
  }),
  component: QaPage,
});

type Item = { id: string; label: string; detail?: string };
type Group = { id: string; title: string; description: string; items: Item[] };

const GROUPS: Group[] = [
  {
    id: "modais",
    title: "Modais — abertura e contenção",
    description: "Todo modal deve abrir sem ultrapassar a tela em 390px e 768px.",
    items: [
      { id: "mod-fullscreen-390", label: "Em 390px o modal ocupa 100% da viewport, sem margem lateral", detail: "DialogContent usa inset-0 + h-[100dvh] no mobile" },
      { id: "mod-centered-768", label: "Em 768px o modal volta a ser centralizado, com max-w respeitado" },
      { id: "mod-overlay", label: "Overlay escurece o fundo e bloqueia interação atrás" },
      { id: "mod-esc", label: "Tecla ESC fecha o modal" },
      { id: "mod-outside", label: "Clique fora do modal fecha" },
      { id: "mod-close-btn", label: "Botão (X) de fechar visível em TODOS os modais", detail: "Mínimo 44x44 no mobile" },
    ],
  },
  {
    id: "sticky",
    title: "Header e rodapé sticky",
    description: "No mobile o header e o rodapé do modal não podem rolar junto com o conteúdo.",
    items: [
      { id: "hdr-sticky", label: "DialogHeader fica fixo no topo ao rolar conteúdo (mobile)" },
      { id: "hdr-bg", label: "Header tem fundo opaco/blur para não vazar conteúdo por trás" },
      { id: "ftr-sticky", label: "DialogFooter fica fixo no rodapé ao rolar conteúdo (mobile)" },
      { id: "ftr-actions", label: "Botões do rodapé empilhados e em largura total no mobile" },
      { id: "ftr-row", label: "No desktop voltam para linha alinhados à direita" },
    ],
  },
  {
    id: "botoes",
    title: "Botões e ações principais",
    description: "Ações primárias devem estar sempre visíveis e tocáveis.",
    items: [
      { id: "btn-tap", label: "Área tocável mínima 44x44px em ações primárias no mobile" },
      { id: "btn-visible", label: "Ação primária sempre visível sem precisar rolar até o fim" },
      { id: "btn-disabled", label: "Estado disabled visualmente diferenciado" },
      { id: "btn-loading", label: "Estado de carregamento bloqueia duplo clique" },
    ],
  },
  {
    id: "stacking",
    title: "Empilhamento lado a lado → coluna",
    description: "Qualquer grid de colunas dentro de modal deve virar coluna única no mobile.",
    items: [
      { id: "stk-grid", label: "grid-cols-2/3/4 vira grid-cols-1 abaixo de sm" },
      { id: "stk-flex", label: "flex-row de campos vira flex-col abaixo de sm" },
      { id: "stk-truncate", label: "Textos longos truncam ou quebram, sem estourar largura" },
      { id: "stk-min-w-0", label: "Containers de texto em flex/grid usam min-w-0" },
    ],
  },
  {
    id: "tabelas",
    title: "Tabelas → cards no mobile",
    description: "Toda tabela com scroll lateral deve virar lista de cards no mobile.",
    items: [
      { id: "tbl-cards", label: "Tabela escondida com sm:hidden e cards mostrados no lugar" },
      { id: "tbl-summary", label: "Cada card resume a linha (campos rotulados + ações)" },
      { id: "tbl-actions", label: "Ações da linha disponíveis no card (editar/excluir/etc.)" },
      { id: "tbl-no-h-scroll", label: "Nenhum scroll lateral no mobile para visualizar dados" },
    ],
  },
  {
    id: "overflow",
    title: "Sem scroll horizontal global",
    description: "Use o scanner abaixo para detectar elementos que estouram a viewport.",
    items: [
      { id: "ovf-390", label: "Sem scroll horizontal em 390px (rota /, modais abertos)" },
      { id: "ovf-768", label: "Sem scroll horizontal em 768px (rota /, modais abertos)" },
      { id: "ovf-doc", label: "document.documentElement.scrollWidth = window.innerWidth" },
    ],
  },
];

const STORAGE_KEY = "qa-checklist-v1";

function QaPage() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [viewport, setViewport] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [overflowing, setOverflowing] = useState<{ tag: string; cls: string; w: number }[] | null>(null);
  const [hasHScroll, setHasHScroll] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setChecked(JSON.parse(raw));
    } catch {}
    const update = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(checked));
    } catch {}
  }, [checked]);

  const toggle = useCallback((id: string) => {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const total = useMemo(() => GROUPS.reduce((n, g) => n + g.items.length, 0), []);
  const done = useMemo(
    () => GROUPS.reduce((n, g) => n + g.items.filter((i) => checked[i.id]).length, 0),
    [checked],
  );

  const runScan = useCallback(() => {
    const vw = window.innerWidth;
    const docW = document.documentElement.scrollWidth;
    setHasHScroll(docW > vw);

    const list: { tag: string; cls: string; w: number }[] = [];
    const all = document.body.querySelectorAll<HTMLElement>("*");
    all.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > vw + 1) {
        list.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || "").toString().slice(0, 120),
          w: Math.round(r.width),
        });
      }
    });
    // dedupe by tag+cls, keep top 20 widest
    const seen = new Set<string>();
    const unique = list
      .sort((a, b) => b.w - a.w)
      .filter((e) => {
        const k = `${e.tag}|${e.cls}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 20);
    setOverflowing(unique);
  }, []);

  const reset = useCallback(() => {
    if (confirm("Reiniciar checklist?")) setChecked({});
  }, []);

  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  const vpBadge =
    viewport.w < 640 ? { Icon: Smartphone, label: "Mobile" } :
    viewport.w < 1024 ? { Icon: Tablet, label: "Tablet" } :
    { Icon: Monitor, label: "Desktop" };

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold sm:text-2xl">QA — Responsividade & Modais</h1>
          <p className="text-sm text-muted-foreground">
            Critérios de aceite para os fluxos do Star Games. Marque conforme valida.
          </p>
        </div>
        <Badge variant="secondary" className="shrink-0 gap-1">
          <vpBadge.Icon className="size-3" />
          {vpBadge.label} {viewport.w}×{viewport.h}
        </Badge>
      </header>

      <Card className="mt-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Progresso</CardTitle>
          <CardDescription>
            {done} de {total} critérios validados ({pct}%)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button onClick={runScan} variant="outline" className="w-full gap-2">
              <RefreshCw className="size-4" /> Scanear overflow agora
            </Button>
            <Button onClick={reset} variant="ghost" className="w-full">
              Reiniciar checklist
            </Button>
          </div>

          {hasHScroll !== null && (
            <div
              className={
                "rounded-md border p-3 text-sm " +
                (hasHScroll
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400")
              }
            >
              {hasHScroll ? (
                <span className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  Scroll horizontal detectado em {viewport.w}px — documento mede{" "}
                  {document.documentElement.scrollWidth}px.
                </span>
              ) : (
                <span className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  Sem scroll horizontal em {viewport.w}px.
                </span>
              )}
            </div>
          )}

          {overflowing && overflowing.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Elementos estourando a viewport ({overflowing.length})
              </p>
              <div className="space-y-1">
                {overflowing.map((e, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-border bg-muted/30 p-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono">{e.tag}</span>
                      <Badge variant="destructive" className="text-[10px]">
                        {e.w}px
                      </Badge>
                    </div>
                    {e.cls && (
                      <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                        {e.cls}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <section className="mt-6 space-y-4">
        {GROUPS.map((g) => {
          const groupDone = g.items.filter((i) => checked[i.id]).length;
          const ok = groupDone === g.items.length;
          return (
            <Card key={g.id}>
              <CardHeader className="pb-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{g.title}</CardTitle>
                    <CardDescription>{g.description}</CardDescription>
                  </div>
                  <Badge
                    variant={ok ? "default" : "secondary"}
                    className="shrink-0"
                  >
                    {groupDone}/{g.items.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {g.items.map((i) => {
                  const isChecked = !!checked[i.id];
                  return (
                    <button
                      key={i.id}
                      type="button"
                      onClick={() => toggle(i.id)}
                      className={
                        "flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors min-h-11 " +
                        (isChecked
                          ? "border-emerald-500/40 bg-emerald-500/5"
                          : "border-border bg-card hover:bg-accent/40")
                      }
                    >
                      {isChecked ? (
                        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-500" />
                      ) : (
                        <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p
                          className={
                            "text-sm " + (isChecked ? "line-through text-muted-foreground" : "")
                          }
                        >
                          {i.label}
                        </p>
                        {i.detail && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{i.detail}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </section>

      <footer className="mt-8 rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Como validar fora deste relatório</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
          <li>Abrir o app em 390px e 768px (DevTools ou device toggle do preview).</li>
          <li>Abrir cada modal: Configurações, Detalhe do Cliente, Importação, MGMV, Concierge, Acesso.</li>
          <li>Confirmar header/footer sticky, sem scroll lateral e tabelas viraram cards.</li>
          <li>Voltar aqui e rodar &quot;Scanear overflow agora&quot; com modais abertos.</li>
        </ol>
      </footer>
    </main>
  );
}
