import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Trash2, Tags } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createProductCategory,
  deleteProductCategory,
  setPlatformCategories,
  type CategoryNode,
  type PlatformStat,
} from "@/lib/segmentation.functions";

export interface CategoriesPanelProps {
  categories: CategoryNode[];
  platforms: PlatformStat[];
  onChanged: () => void;
}

const UNSET = "__none__";

export function ProductCategoriesPanel({ categories, platforms, onChanged }: CategoriesPanelProps) {
  const createFn = useServerFn(createProductCategory);
  const deleteFn = useServerFn(deleteProductCategory);
  const linkFn = useServerFn(setPlatformCategories);

  const [search, setSearch] = useState("");
  const [onlyUnset, setOnlyUnset] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<string>(UNSET);
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState<string>(UNSET);
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(40);

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  

  /** Árvore achatada em qualquer profundidade, para os selects. */
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

  const label = (id: string | null) => {
    if (!id) return "Sem categoria";
    const parts: string[] = [];
    let cur = byId.get(id);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.length ? parts.join(" › ") : "Sem categoria";
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return platforms.filter(
      (p) =>
        (!q || p.platform.toLowerCase().includes(q)) && (!onlyUnset || !p.categoryId),
    );
  }, [platforms, search, onlyUnset]);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  async function applyCategory() {
    if (!selected.size) {
      toast.error("Selecione ao menos uma plataforma.");
      return;
    }
    setBusy(true);
    try {
      const items = platforms
        .filter((p) => selected.has(p.platformKey))
        .map((p) => ({ key: p.platformKey, label: p.platform }));
      await linkFn({
        data: { platforms: items, categoryId: target === UNSET ? null : target },
      });
      toast.success(`${items.length} plataforma(s) atualizada(s).`);
      setSelected(new Set());
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao aplicar categoria.");
    } finally {
      setBusy(false);
    }
  }

  async function addCategory() {
    const name = newName.trim();
    if (!name) {
      toast.error("Informe o nome da categoria.");
      return;
    }
    setBusy(true);
    try {
      await createFn({
        data: { name, parentId: newParent === UNSET ? null : newParent, sort: categories.length },
      });
      setNewName("");
      toast.success("Categoria criada.");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar categoria.");
    } finally {
      setBusy(false);
    }
  }

  async function removeCategory(id: string) {
    setBusy(true);
    try {
      await deleteFn({ data: { id } });
      toast.success("Categoria removida.");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover categoria.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Tabs defaultValue="platforms" className="space-y-4">
      <TabsList>
        <TabsTrigger value="platforms">Plataformas</TabsTrigger>
        <TabsTrigger value="rules">Regras</TabsTrigger>
      </TabsList>

      <TabsContent value="rules">
        {rulesQuery.isLoading ? (
          <p className="p-3 text-sm text-muted-foreground">Carregando regras…</p>
        ) : (
          <CategoryRulesTab
            key={rulesQuery.dataUpdatedAt}
            categories={categories}
            platforms={platforms}
            initialRules={rulesQuery.data ?? []}
            onChanged={onChanged}
          />
        )}
      </TabsContent>

      <TabsContent value="platforms" className="space-y-5">
      {/* Árvore */}
      <div className="rounded-xl border bg-muted/20 p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Tags className="size-4 text-primary" /> Árvore de categorias
        </div>
        <div className="divide-y rounded-lg border bg-card">
          {tree.length ? (
            tree.map((c) => {
              const linked = platforms.filter((p) => p.categoryId === c.id).length;
              return (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-2 px-2 py-1.5"
                  style={{ paddingLeft: 8 + c.depth * 18 }}
                >
                  <span className={c.depth ? "text-sm" : "text-sm font-medium"}>
                    {c.depth ? "└ " : ""}
                    {c.name}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[11px]">
                      {linked} plataforma(s)
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground"
                      disabled={busy}
                      onClick={() => void removeCategory(c.id)}
                      aria-label={`Remover ${c.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="p-3 text-sm text-muted-foreground">
              Nenhuma categoria ainda. Crie a primeira abaixo.
            </p>
          )}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div>
            <Label className="text-xs">Nova categoria</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ex.: Mangás"
            />
          </div>
          <div>
            <Label className="text-xs">Dentro de</Label>
            <Select value={newParent} onValueChange={setNewParent}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[320px]">
                <SelectItem value={UNSET}>Categoria principal</SelectItem>
                {tree.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {"\u00A0".repeat(c.depth * 3) + (c.depth ? "└ " : "") + c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button className="self-end" disabled={busy} onClick={() => void addCategory()}>
            <Plus className="size-4" /> Criar
          </Button>
        </div>
      </div>

      {/* Plataformas */}
      <div className="rounded-xl border bg-muted/20 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisible(40);
            }}
            placeholder="Buscar plataforma…"
            className="h-9 max-w-xs"
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={onlyUnset}
              onCheckedChange={(v) => {
                setOnlyUnset(Boolean(v));
                setVisible(40);
              }}
            />
            Somente sem categoria
          </label>
          <span className="ml-auto text-xs text-muted-foreground">
            {filtered.length} plataforma(s) • {selected.size} selecionada(s)
          </span>
        </div>

        <div className="mb-2 flex flex-wrap items-end gap-2">
          <div className="min-w-[220px]">
            <Label className="text-xs">Aplicar aos selecionados</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>Sem categoria (desvincular)</SelectItem>
                {tree.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {label(c.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button disabled={busy} onClick={() => void applyCategory()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Tags className="size-4" />}{" "}
            Aplicar
          </Button>
          <Button
            variant="outline"
            onClick={() => setSelected(new Set(filtered.map((p) => p.platformKey)))}
          >
            Selecionar visíveis
          </Button>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            Limpar seleção
          </Button>
        </div>

        <div className="max-h-[360px] overflow-y-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <tbody>
              {filtered.slice(0, visible).map((p) => (
                <tr key={p.platformKey} className="border-b last:border-0">
                  <td className="w-8 px-2 py-1.5">
                    <Checkbox
                      checked={selected.has(p.platformKey)}
                      onCheckedChange={() => toggle(p.platformKey)}
                      aria-label={`Selecionar ${p.platform}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">{p.platform}</td>
                  <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">
                    {p.productsCount} produto(s)
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Badge variant={p.categoryId ? "secondary" : "outline"}>
                      {label(p.categoryId)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > visible ? (
            <div className="p-2 text-center">
              <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + 40)}>
                Carregar mais
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
