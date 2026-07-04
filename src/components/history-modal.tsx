import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useUiStore, type HistoryContext } from "@/lib/ui-store";
import { useStore, isResolvedSituation, type Client, type Product } from "@/lib/store";
import { usePaginatedList } from "@/hooks/use-paginated-list";
import { LoadMoreButton } from "@/components/load-more-button";
import { highlight, matchText } from "@/lib/search-highlight";

interface Row {
  client: Client;
  product?: Product;
  status: string;
}

function contextTitle(ctx: HistoryContext): { title: string; desc: string } {
  switch (ctx) {
    case "clientes-todos":
      return { title: "Todos os clientes", desc: "Base completa de clientes cadastrados." };
    case "desistiu":
      return { title: "Desistências", desc: "Clientes com produtos marcados como Desistiu." };
    case "abandonou":
      return { title: "Abandonos", desc: "Clientes com produtos marcados como Abandonou." };
    case "mgmv-todos":
      return { title: "Todos os acordos MGMV", desc: "Base completa de clientes com MGMV." };
  }
}

export function HistoryModal() {
  const context = useUiStore((s) => s.historyContext);
  const closeHistory = useUiStore((s) => s.closeHistory);
  const clients = useStore((s) => s.clients);
  const products = useStore((s) => s.products);
  const [search, setSearch] = useState("");

  const rows = useMemo<Row[]>(() => {
    if (!context) return [];
    if (context === "mgmv-todos") {
      return clients
        .filter((c) => c.clientType === "mgmv" || (c.mgmv && c.mgmv.installments.length > 0))
        .map((c) => ({ client: c, status: c.mgmv ? "MGMV" : "—" }));
    }
    if (context === "clientes-todos") {
      return clients.map((c) => ({ client: c, status: c.clientType === "mgmv" ? "MGMV" : "Comum" }));
    }
    // desistiu / abandonou → varre produtos com essas situações
    const target = context === "desistiu" ? "Desistiu" : "Abandonou";
    const clientMap = new Map(clients.map((c) => [c.id, c]));
    const list: Row[] = [];
    for (const p of products) {
      if (p.situation !== target) continue;
      const c = clientMap.get(p.clientId);
      if (!c) continue;
      list.push({ client: c, product: p, status: p.situation });
    }
    return list;
  }, [context, clients, products]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    return rows.filter((r) => {
      return (
        matchText(r.client.name, search) ||
        matchText(r.client.phone, search) ||
        (r.product && matchText(r.product.name, search)) ||
        matchText(r.status, search)
      );
    });
  }, [rows, search]);

  const { visible, hasMore, nextChunk, loadMore } = usePaginatedList(filtered, { step: 10 });

  const meta = context ? contextTitle(context) : null;

  return (
    <Dialog
      open={context !== null}
      onOpenChange={(open) => {
        if (!open) {
          closeHistory();
          setSearch("");
        }
      }}
    >
      <DialogContent className="max-w-3xl">
        {meta && (
          <DialogHeader>
            <DialogTitle>{meta.title}</DialogTitle>
            <DialogDescription>{meta.desc}</DialogDescription>
          </DialogHeader>
        )}
        <div className="space-y-3">
          <Input
            placeholder="Buscar por nome, telefone ou produto…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="text-xs text-muted-foreground">
            {filtered.length} registro(s) encontrado(s)
          </div>
          <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Telefone</TableHead>
                  {context !== "clientes-todos" && context !== "mgmv-todos" && (
                    <TableHead>Produto</TableHead>
                  )}
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r, i) => (
                  <TableRow key={`${r.client.id}-${r.product?.id ?? i}`}>
                    <TableCell>{highlight(r.client.name, search)}</TableCell>
                    <TableCell>{highlight(r.client.phone, search)}</TableCell>
                    {context !== "clientes-todos" && context !== "mgmv-todos" && (
                      <TableCell>{r.product ? highlight(r.product.name, search) : "—"}</TableCell>
                    )}
                    <TableCell>{highlight(r.status, search)}</TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                      Nenhum registro para exibir.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {hasMore && (
            <LoadMoreButton onClick={loadMore} count={nextChunk} />
          )}
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => closeHistory()}>
              Fechar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Evita warning quando o util não é usado em todos os contextos.
void isResolvedSituation;