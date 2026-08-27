import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

/**
 * Hook base para tabelas com paginação, busca e filtros server-side.
 *
 * - `search` é debounçado (400ms por padrão) antes de virar parte da queryKey.
 * - Ao trocar `search`/`filters`/`pageSize`/`sort`, a página volta pra 1.
 * - `keepPreviousData` mantém a página anterior visível enquanto a nova
 *   carrega, evitando "pisca" na UI.
 *
 * Uso típico:
 *   const t = useServerTable(listClients, ['clients'], {
 *     initialPageSize: 25,
 *     filters: { clientType: 'common' },
 *   });
 *   t.rows, t.total, t.page, t.pageSize, t.setPage, t.setSearch, t.isFetching
 */

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UseServerTableOptions<TFilters extends Record<string, unknown>> {
  initialPage?: number;
  initialPageSize?: number;
  initialSearch?: string;
  initialSortBy?: string;
  initialSortDir?: "asc" | "desc";
  filters?: TFilters;
  debounceMs?: number;
  /** Se `false`, a query só roda quando `enabled` virar `true`. */
  enabled?: boolean;
  /** Freshness — padrão 30s. */
  staleTime?: number;
}

type ServerFn<TInput, TRow> = (args: { data: TInput }) => Promise<Paginated<TRow>>;

export function useServerTable<TRow, TFilters extends Record<string, unknown>>(
  fn: ServerFn<
    {
      page: number;
      pageSize: number;
      search: string;
      sortBy?: string;
      sortDir?: "asc" | "desc";
    } & TFilters,
    TRow
  >,
  keyPrefix: readonly unknown[],
  opts: UseServerTableOptions<TFilters> = {},
) {
  const call = useServerFn(fn as never) as unknown as ServerFn<
    {
      page: number;
      pageSize: number;
      search: string;
      sortBy?: string;
      sortDir?: "asc" | "desc";
    } & TFilters,
    TRow
  >;

  const [page, setPage] = useState(opts.initialPage ?? 1);
  const [pageSize, setPageSize] = useState(opts.initialPageSize ?? 25);
  const [search, setSearchRaw] = useState(opts.initialSearch ?? "");
  const [sortBy, setSortBy] = useState<string | undefined>(opts.initialSortBy);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(opts.initialSortDir ?? "asc");
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  const debounceMs = opts.debounceMs ?? 400;

  // Debounce da busca
  useEffect(() => {
    if (search === debouncedSearch) return;
    const t = window.setTimeout(() => setDebouncedSearch(search), debounceMs);
    return () => window.clearTimeout(t);
  }, [search, debouncedSearch, debounceMs]);

  // Reset página quando busca/filtros/pageSize/sort mudam
  const filtersKey = useMemo(() => JSON.stringify(opts.filters ?? {}), [opts.filters]);
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filtersKey, pageSize, sortBy, sortDir]);

  const queryKey = useMemo(
    () => [
      ...keyPrefix,
      { page, pageSize, search: debouncedSearch, sortBy, sortDir, filters: filtersKey },
    ],
    [keyPrefix, page, pageSize, debouncedSearch, sortBy, sortDir, filtersKey],
  );

  const query = useQuery({
    queryKey,
    enabled: opts.enabled ?? true,
    staleTime: opts.staleTime ?? 300_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    queryFn: () =>
      call({
        data: {
          page,
          pageSize,
          search: debouncedSearch,
          sortBy,
          sortDir,
          ...((opts.filters ?? {}) as TFilters),
        },
      }),
  });

  const setSearch = (s: string) => setSearchRaw(s);

  return {
    rows: query.data?.rows ?? [],
    total: query.data?.total ?? 0,
    page,
    pageSize,
    search,
    debouncedSearch,
    sortBy,
    sortDir,
    isFetching: query.isFetching,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    setPage,
    setPageSize,
    setSearch,
    setSortBy,
    setSortDir,
    refetch: query.refetch,
    queryKey,
  };
}