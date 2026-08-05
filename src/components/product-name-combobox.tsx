import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { useStore } from "@/lib/store";
import { matchText } from "@/lib/search-highlight";

export interface ProductSuggestion {
  name: string;
  platform: string;
  count: number;
  lastUsed: number;
}

/**
 * Campo de nome de produto com sugestões (mesmo estilo da busca da navbar).
 * Aceita qualquer texto digitado — sugestões apenas aceleram o preenchimento.
 */
export function ProductNameCombobox({
  value,
  onChange,
  onPick,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onPick?: (s: ProductSuggestion) => void;
  placeholder?: string;
}) {
  const products = useStore((s) => s.products);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState(value);
  const [debounced, setDebounced] = useState(value);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => setQuery(value), [value]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 120);
    return () => clearTimeout(t);
  }, [query]);

  const catalog = useMemo(() => {
    const map = new Map<string, ProductSuggestion>();
    for (const p of products) {
      const name = (p.name ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const ts = new Date(p.registerDate ?? 0).getTime() || 0;
      const prev = map.get(key);
      if (prev) {
        prev.count += 1;
        if (ts > prev.lastUsed) {
          prev.lastUsed = ts;
          if (p.platform) prev.platform = p.platform;
        }
      } else {
        map.set(key, { name, platform: p.platform ?? "", count: 1, lastUsed: ts });
      }
    }
    return [...map.values()];
  }, [products]);

  const suggestions = useMemo(() => {
    const q = debounced.trim();
    if (!q) return [];
    return catalog
      .filter((s) => matchText(s.name, q) || matchText(s.platform, q))
      .sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed)
      .slice(0, 8);
  }, [catalog, debounced]);

  useEffect(() => setActive(0), [debounced]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const pick = (s: ProductSuggestion) => {
    onChange(s.name);
    setQuery(s.name);
    onPick?.(s);
    setOpen(false);
  };

  const showList = open && suggestions.length > 0;

  return (
    <div className="relative" ref={wrapRef}>
      <Input
        value={query}
        placeholder={placeholder ?? "Digite para buscar ou cadastrar"}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % suggestions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            const s = suggestions[active];
            if (s) pick(s);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {showList && (
        <div className="absolute z-[60] mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-md">
          {suggestions.map((s, i) => (
            <button
              key={`${s.name}-${i}`}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s)}
              className={`flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm ${
                i === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
              }`}
            >
              <span className="truncate">{s.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {s.platform || "—"} · {s.count}x
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}