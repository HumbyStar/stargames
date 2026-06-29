import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAccess, type AppPermission, type AppRole, type MyAccess } from "./permissions.functions";

interface PermissionsValue {
  loading: boolean;
  access: MyAccess | null;
  hasPermission: (p: AppPermission) => boolean;
  hasAnyPermission: (perms: AppPermission[]) => boolean;
  hasRole: (r: AppRole) => boolean;
  refresh: () => void;
}

const Ctx = createContext<PermissionsValue | null>(null);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const fn = useServerFn(getMyAccess);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["my-access"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });

  const access = data ?? null;
  const set = new Set(access?.permissions ?? []);
  const roleSet = new Set(access?.roles ?? []);

  const value: PermissionsValue = {
    loading: isLoading,
    access,
    hasPermission: (p) => set.has(p),
    hasAnyPermission: (perms) => perms.some((p) => set.has(p)),
    hasRole: (r) => roleSet.has(r),
    refresh: () => qc.invalidateQueries({ queryKey: ["my-access"] }),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePermissions(): PermissionsValue {
  const v = useContext(Ctx);
  if (!v) {
    // Fallback seguro: nega tudo enquanto o provider não está montado.
    return {
      loading: true,
      access: null,
      hasPermission: () => false,
      hasAnyPermission: () => false,
      hasRole: () => false,
      refresh: () => {},
    };
  }
  return v;
}
