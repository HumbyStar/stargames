import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Save, Trash2, Wand2, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildCategoryPlan,
  categoryLabel,
  makeRuleId,
  SUGGESTED_KEYWORDS,
  type CategoryPlan,
  type CategoryRule,
} from "@/lib/category-rules";
import { saveCategoryRules } from "@/lib/category-rules.functions";
import { setPlatformCategories, type CategoryNode, type PlatformStat } from "@/lib/segmentation.functions";

const UNSET = "__none__";
const BATCH = 300;

interface Props {
  categories: CategoryNode[];
  platforms: PlatformStat[];
  initialRules: CategoryRule[];
  onChanged: () => void;
}

type PreviewFilter = "all" | "new" | "change" | "unmatched";

export function CategoryRulesTab({ categories, platforms, initialRules, onChanged }: Props) {
  const saveFn = useServerFn(saveCategoryRules);
  const linkFn = useServerFn(setPlatformCategories);

  const [rules, setRules] = useState<CategoryRule[]>(initialRules);
  const [skipAssigned, setSkipAssigned] = useState(true);
  const [plan, setPlan] = useState<CategoryPlan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<PreviewFilter>("all");
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(50);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const tree = useMemo(() => {
    const byParent = new Map<string | null, CategoryNode[]>();
    for (const c of categories) {
      const list = byParent.get(c.parentId) ?? [];
      list.push(c);
      byParent.set(c.parentId, list);
    }
    const out: { id: string; name: string; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      const list = [...(byParent.get(parent) ?? [])].sort(
        (a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "pt-BR"),
      );
      for (const c of list) {
        out.push({ id: c.id, name: c.name, depth });
        walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [categories]);

  const label = (id: string | null) => categoryLabel(id, categories);

  function patchRule(id: string, patch: Partial<CategoryRule>) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setPlan(null);
  }

  function move(id: string, dir: -1 | 1) {
    setRules((prev) => {
      const idx = prev.findIndex((r) => r.id === id);
      const next = idx + dir;
      if (idx < 0 || next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(next, 0, item!);
      return copy;
    });
    setPlan(null);
  }

  function addRule(nome = "", palavras: string[] = []) {
    setRules((prev) => [...prev, { id: makeRuleId(), nome: nome || "Nova regra", categoryId: null, palavras }]);
    setPlan(null);
  }

  function addSuggested() {
    const extra = Object.entries(SUGGESTED_KEYWORDS).map(([nome, palavras]) => ({
      id: makeRuleId(),
      nome,
      categoryId: null,
      palavras: [...palavras],
    }));
    setRules((prev) => [...prev, ...extra]);
    setPlan(null);
    toast.success("Regras sugeridas adicionadas — escolha a categoria de cada uma.");
  }

  async function persistRules() {
    setBusy(true);
    try {
      await saveFn({ data: { rules } });
      toast.success("Regras salvas.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar as regras.");
    } finally {
      setBusy(false);
    }
  }

  function simulate() {
    const usable = rules.filter((r) => r.categoryId && r.palavras.some((p) => p.trim()));
    if (!usable.length) {
      toast.error("Crie ao menos uma regra com categoria e palavras-chave.");
      return;
    }
    const result = buildCategoryPlan(platforms, usable, { skipAssigned });
    setPlan(result);
    setVisible(50);
    setFilter("all");
    setSelected(
      new Set(result.rows.filter((r) => r.kind === "new" || r.kind === "change").map((r) => r.platformKey)),
    );
  }

  const rowsFiltered = useMemo(() => {
    if (!plan) return [];
    const q = search.trim().toLowerCase();
    return plan.rows.filter((r) => {
      if (filter !== "all" && r.kind !== filter) return false;
      if (filter === "all" && r.kind === "same") return false;
      return !q || r.platform.toLowerCase().includes(q);
    });
  }, [plan, filter, search]);

  const applicable = useMemo(
    () => (plan ? plan.rows.filter((r) => selected.has(r.platformKey) && r.proposedCategoryId) : []),
    [plan, selected],
  );

  async function applySelected() {
    if (!applicable.length) {
      toast.error("Nada selecionado para aplicar.");
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      const byCategory = new Map<string, { key: string; label: string }[]>();
      for (const row of applicable) {
        const list = byCategory.get(row.proposedCategoryId!) ?? [];
        list.push({ key: row.platformKey, label: row.platform });
        byCategory.set(row.proposedCategoryId!, list);
      }
      let done = 0;
      for (const [categoryId, items] of byCategory) {
        for (let i = 0; i < items.length; i += BATCH) {
          const chunk = items.slice(i, i + BATCH);
          await linkFn({ data: { platforms: chunk, categoryId } });
          done += chunk.length;
          setProgress(Math.round((done / applicable.length) * 100));
        }
      }
      toast.success(`${applicable.length} plataforma(s) categorizada(s).`);
      setPlan(null);
      setSelected(new Set());
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao aplicar as regras.");
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  return (
    <div className="space-y-5">
      {/* Editor de regras */}
      <div className="rounded-xl border bg-muted/20 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Regras (a primeira que casar vence)</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => addSuggested()}>
              <Wand2 className="size-4" /> Adicionar sugeridas
            </Button>
            <Button variant="outline" size="sm" onClick={() => addRule()}>
              <Plus className="size-4" /> Nova regra
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void persistRules()}>
              <Save className="size-4" /> Salvar regras
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          {rules.length ? (
            rules.map((rule, idx) => (
              <div key={rule.id} className="rounded-lg border bg-card p-2">
                <div className="flex flex-wrap items-end gap-2">
                  <Badge variant="outline" className="mb-2">
                    {idx + 1}
                  </Badge>
                  <div className="min-w-[160px] flex-1">
                    <Label className="text-xs">Nome</Label>
                    <Input
                      value={rule.nome}
                      onChange={(e) => patchRule(rule.id, { nome: e.target.value })}
                    />
                  </div>
                  <div className="min-w-[200px] flex-1">
                    <Label className="text-xs">Categoria de destino</Label>
                    <Select
                      value={rule.categoryId ?? UNSET}
                      onValueChange={(v) => patchRule(rule.id, { categoryId: v === UNSET ? null : v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-[320px]">
                        <SelectItem value={UNSET}>Escolher categoria…</SelectItem>
                        {tree.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {label(c.id)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-1 pb-0.5">
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => move(rule.id, -1)} aria-label="Subir">
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => move(rule.id, 1)} aria-label="Descer">
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground"
                      onClick={() => {
                        setRules((p) => p.filter((r) => r.id !== rule.id));
                        setPlan(null);
                      }}
                      aria-label="Remover regra"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="mt-2">
                  <Label className="text-xs">Palavras-chave (separadas por vírgula)</Label>
                  <Textarea
                    rows={2}
                    value={rule.palavras.join(", ")}
                    onChange={(e) =>
                      patchRule(rule.id, {
                        palavras: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                      })
                    }
                    placeholder="psp, ps vita, xbox 360…"
                  />
                </div>
              </div>
            ))
          ) : (
            <p className="p-2 text-sm text-muted-foreground">
              Nenhuma regra ainda. Use "Adicionar sugeridas" para começar.
            </p>
          )}
        </div>
      </div>

      {/* Simulação */}
      <div className="rounded-xl border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={simulate} disabled={busy}>
            <Wand2 className="size-4" /> Simular regras
          </Button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={skipAssigned} onCheckedChange={(v) => { setSkipAssigned(Boolean(v)); setPlan(null); }} />
            Não alterar plataformas que já têm categoria
          </label>
          <span className="text-xs text-muted-foreground">
            {platforms.length} plataforma(s) na base
          </span>
        </div>

        {plan ? (
          <div className="mt-3 space-y-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <Stat label="Analisadas" value={plan.analyzed} />
              <Stat label="Receberiam categoria" value={plan.newCount} />
              <Stat label="Mudariam de categoria" value={plan.changeCount} />
              <Stat label="Continuariam sem categoria" value={plan.unmatchedCount} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ["all", "Todas as mudanças"],
                  ["new", "Só novas"],
                  ["change", "Só mudanças"],
                  ["unmatched", "Sem categoria"],
                ] as [PreviewFilter, string][]
              ).map(([k, text]) => (
                <Button
                  key={k}
                  size="sm"
                  variant={filter === k ? "default" : "outline"}
                  onClick={() => {
                    setFilter(k);
                    setVisible(50);
                  }}
                >
                  {text}
                </Button>
              ))}
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setVisible(50);
                }}
                placeholder="Buscar plataforma…"
                className="h-9 max-w-xs"
              />
              <span className="ml-auto text-xs text-muted-foreground">
                {rowsFiltered.length} linha(s) • {applicable.length} selecionada(s)
              </span>
            </div>

            <div className="max-h-[340px] overflow-y-auto rounded-lg border bg-card">
              <table className="w-full text-sm">
                <tbody>
                  {rowsFiltered.slice(0, visible).map((r) => (
                    <tr key={r.platformKey} className="border-b last:border-0">
                      <td className="w-8 px-2 py-1.5">
                        <Checkbox
                          disabled={!r.proposedCategoryId}
                          checked={selected.has(r.platformKey)}
                          onCheckedChange={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(r.platformKey)) next.delete(r.platformKey);
                              else next.add(r.platformKey);
                              return next;
                            })
                          }
                          aria-label={`Selecionar ${r.platform}`}
                        />
                      </td>
                      <td className="px-2 py-1.5">{r.platform}</td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground">
                        {r.productsCount} produto(s)
                      </td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground">
                        {label(r.currentCategoryId)}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Badge variant={r.proposedCategoryId ? "secondary" : "outline"}>
                          {r.proposedCategoryId ? label(r.proposedCategoryId) : "Sem correspondência"}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">
                        {r.ruleName ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rowsFiltered.length > visible ? (
                <div className="p-2 text-center">
                  <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + 50)}>
                    Carregar mais
                  </Button>
                </div>
              ) : null}
              {!rowsFiltered.length ? (
                <p className="p-3 text-sm text-muted-foreground">Nada para mostrar neste filtro.</p>
              ) : null}
            </div>

            {busy && progress > 0 ? <Progress value={progress} /> : null}

            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !applicable.length} onClick={() => void applySelected()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null} Aplicar selecionadas (
                {applicable.length})
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  setSelected(
                    new Set(rowsFiltered.filter((r) => r.proposedCategoryId).map((r) => r.platformKey)),
                  )
                }
              >
                Selecionar visíveis
              </Button>
              <Button variant="ghost" onClick={() => setSelected(new Set())}>
                Limpar seleção
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            A simulação mostra o resultado aqui na tela. Nada é gravado até você confirmar.
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-lg font-semibold">{value.toLocaleString("pt-BR")}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
