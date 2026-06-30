import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  KeyRound,
  Plus,
  ShieldCheck,
  Trash2,
  UserCog,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/lib/use-permissions";
import {
  listUsers,
  createUser,
  updateUserRoles,
  resetUserPassword,
  setUserBanned,
  deleteUser,
  updateUserResponsibilities,
  type AdminUserRow,
  type UserResponsibility,
} from "@/lib/admin-users.functions";
import {
  listRolePermissions,
  type AppPermission,
  type AppRole,
} from "@/lib/permissions.functions";

const ROLES: AppRole[] = [
  "admin_master",
  "admin",
  "gerente",
  "manager",
  "supervisor",
  "funcionario",
  "envio",
  "mgmv",
  "operator",
  "viewer",
];
const RESPONSIBILITIES: UserResponsibility[] = [
  "cobranca","mgmv","envio","importacao","revisao_ia",
  "cadastro","financeiro","atendimento","leiloes","admin",
];
const RESPONSIBILITY_LABELS: Record<UserResponsibility, string> = {
  cobranca: "Cobrança",
  mgmv: "MGMV",
  envio: "Envio",
  importacao: "Importação",
  revisao_ia: "Revisão IA",
  cadastro: "Cadastro",
  financeiro: "Financeiro",
  atendimento: "Atendimento",
  leiloes: "Leilões",
  admin: "Admin",
};
const ROLE_LABELS: Record<AppRole, string> = {
  admin_master: "Admin Master",
  admin: "Administrador",
  gerente: "Gerente",
  manager: "Gerente (legado)",
  supervisor: "Supervisor",
  funcionario: "Funcionário",
  envio: "Envio",
  mgmv: "MGMV",
  operator: "Operador",
  viewer: "Leitor",
};
const ALL_PERMISSIONS: AppPermission[] = [
  "dashboard.view",
  "clientes.view",
  "clientes.edit",
  "collection.view",
  "collection.edit",
  "mgmv.view",
  "mgmv.edit",
  "import.use",
  "finance.view",
  "settings.view",
  "users.manage",
  "team.view",
  "team.assign.all",
  "team.assign.team",
  "team.task.update_own",
  "team.task.comment",
  "punch.clock",
  "shipping.mark_sent",
  "mgmv.register_product",
];
const PERM_LABELS: Record<AppPermission, string> = {
  "dashboard.view": "Ver dashboard",
  "clientes.view": "Ver clientes",
  "clientes.edit": "Editar clientes",
  "collection.view": "Ver cobranças",
  "collection.edit": "Editar cobranças",
  "mgmv.view": "Ver MGMV",
  "mgmv.edit": "Editar MGMV",
  "import.use": "Importar dados",
  "finance.view": "Ver finanças",
  "settings.view": "Ver configurações",
  "users.manage": "Gerenciar usuários",
  "team.view": "Ver equipe",
  "team.assign.all": "Atribuir tarefas a qualquer pessoa",
  "team.assign.team": "Atribuir tarefas à própria equipe",
  "team.task.update_own": "Atualizar próprias tarefas",
  "team.task.comment": "Comentar em tarefas",
  "punch.clock": "Registrar ponto",
  "shipping.mark_sent": "Marcar envio de produto",
  "mgmv.register_product": "Cadastrar produto MGMV",
};

function randomPassword(len = 14) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  let s = "";
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) s += chars[buf[i] % chars.length];
  return s;
}

export function AccessManagementDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { access, hasRole, refresh: refreshPerms } = usePermissions();
  const isAdmin = hasRole("admin");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" /> Gerenciar acesso
          </DialogTitle>
          <DialogDescription>
            Crie contas, atribua papéis e gerencie permissões de quem acessa o sistema.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={isAdmin ? "users" : "account"}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="users" disabled={!isAdmin} className="gap-2">
              <Users className="size-4" /> Usuários
            </TabsTrigger>
            <TabsTrigger value="roles" className="gap-2">
              <ShieldCheck className="size-4" /> Papéis e permissões
            </TabsTrigger>
            <TabsTrigger value="account" className="gap-2">
              <KeyRound className="size-4" /> Minha conta
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="mt-4">
            {isAdmin ? <UsersTab onChanged={refreshPerms} currentUserId={access?.userId ?? null} /> : <NotAdminNotice />}
          </TabsContent>

          <TabsContent value="roles" className="mt-4">
            <RolesTab />
          </TabsContent>

          <TabsContent value="account" className="mt-4">
            <AccountTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function NotAdminNotice() {
  return (
    <p className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
      Apenas administradores podem gerenciar usuários.
    </p>
  );
}

function UsersTab({ onChanged, currentUserId }: { onChanged: () => void; currentUserId: string | null }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listUsers);
  const { data: users, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => listFn(),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [resetUser, setResetUser] = useState<AdminUserRow | null>(null);
  const [rolesUser, setRolesUser] = useState<AdminUserRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUserRow | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    onChanged();
  };

  const banFn = useServerFn(setUserBanned);
  const banMut = useMutation({
    mutationFn: (vars: { userId: string; banned: boolean }) =>
      banFn({ data: vars }),
    onSuccess: () => {
      toast.success("Status atualizado.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteFn = useServerFn(deleteUser);
  const deleteMut = useMutation({
    mutationFn: (userId: string) => deleteFn({ data: { userId } }),
    onSuccess: () => {
      toast.success("Usuário excluído.");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {users?.length ?? 0} usuário(s) cadastrado(s).
        </p>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="size-4" /> Novo usuário
        </Button>
      </div>

      <div className="max-h-[420px] overflow-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>E-mail</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Papéis</TableHead>
              <TableHead>Último login</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">Carregando...</TableCell></TableRow>
            )}
            {users?.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.email ?? "—"}</TableCell>
                <TableCell>{u.fullName ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.length === 0 && <span className="text-xs text-muted-foreground">sem papel</span>}
                    {u.roles.map((r) => (
                      <Badge key={r} variant="secondary" className="text-xs">{ROLE_LABELS[r]}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleString("pt-BR") : "nunca"}
                </TableCell>
                <TableCell>
                  {u.banned ? <Badge variant="destructive">Desativado</Badge> : <Badge>Ativo</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" title="Editar papéis" onClick={() => setRolesUser(u)}>
                      <UserCog className="size-4" />
                    </Button>
                    <Button size="sm" variant="ghost" title="Redefinir senha" onClick={() => setResetUser(u)}>
                      <KeyRound className="size-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={u.banned ? "Reativar" : "Desativar"}
                      disabled={u.id === currentUserId}
                      onClick={() => banMut.mutate({ userId: u.id, banned: !u.banned })}
                    >
                      <UserMinus className="size-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Excluir"
                      disabled={u.id === currentUserId}
                      onClick={() => setDeleteTarget(u)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && users && users.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">Nenhum usuário.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={invalidate} />
      <ResetPasswordDialog user={resetUser} onClose={() => setResetUser(null)} />
      <EditRolesDialog user={rolesUser} onClose={() => setRolesUser(null)} onSaved={invalidate} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é permanente. {deleteTarget?.email}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState<AppRole[]>(["viewer"]);

  const createFn = useServerFn(createUser);
  const mut = useMutation({
    mutationFn: () => createFn({ data: { email, password, fullName: fullName || undefined, roles } }),
    onSuccess: () => {
      toast.success("Usuário criado. Ele já pode entrar com o e-mail e a senha definidos.");
      onCreated();
      onOpenChange(false);
      setEmail(""); setFullName(""); setPassword(""); setRoles(["viewer"]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus className="size-4" /> Novo usuário</DialogTitle>
          <DialogDescription>Defina e-mail e senha iniciais; o usuário poderá alterá-la depois.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>E-mail</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@empresa.com" />
          </div>
          <div className="space-y-1">
            <Label>Nome completo</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="space-y-1">
            <Label>Senha inicial</Label>
            <div className="flex gap-2">
              <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" />
              <Button type="button" variant="outline" onClick={() => setPassword(randomPassword())}>Gerar</Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Papéis</Label>
            <RolesPicker value={roles} onChange={setRoles} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !email || password.length < 8 || roles.length === 0}>
            Criar usuário
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RolesPicker({ value, onChange }: { value: AppRole[]; onChange: (r: AppRole[]) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {ROLES.map((r) => {
        const checked = value.includes(r);
        return (
          <label key={r} className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background/50 p-2 text-sm">
            <Checkbox
              checked={checked}
              onCheckedChange={(v) => onChange(v ? Array.from(new Set([...value, r])) : value.filter((x) => x !== r))}
            />
            {ROLE_LABELS[r]}
          </label>
        );
      })}
    </div>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: AdminUserRow | null; onClose: () => void }) {
  const [pw, setPw] = useState("");
  const fn = useServerFn(resetUserPassword);
  const mut = useMutation({
    mutationFn: () => fn({ data: { userId: user!.id, newPassword: pw } }),
    onSuccess: () => { toast.success("Senha redefinida."); setPw(""); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={!!user} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Redefinir senha</DialogTitle>
          <DialogDescription>{user?.email}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Nova senha</Label>
          <div className="flex gap-2">
            <Input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Mínimo 8 caracteres" />
            <Button variant="outline" type="button" onClick={() => setPw(randomPassword())}>Gerar</Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || pw.length < 8}>Redefinir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditRolesDialog({ user, onClose, onSaved }: { user: AdminUserRow | null; onClose: () => void; onSaved: () => void }) {
  const [roles, setRoles] = useState<AppRole[]>(user?.roles ?? []);
  // sync when user changes
  if (user && roles !== user.roles && roles.length === 0 && user.roles.length > 0) {
    setRoles(user.roles);
  }
  const fn = useServerFn(updateUserRoles);
  const mut = useMutation({
    mutationFn: () => fn({ data: { userId: user!.id, roles } }),
    onSuccess: () => { toast.success("Papéis atualizados."); onSaved(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={!!user} onOpenChange={(v) => { if (!v) { setRoles([]); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar papéis</DialogTitle>
          <DialogDescription>{user?.email}</DialogDescription>
        </DialogHeader>
        <RolesPicker value={roles.length ? roles : user?.roles ?? []} onChange={setRoles} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || (roles.length || user?.roles.length || 0) === 0}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RolesTab() {
  const fn = useServerFn(listRolePermissions);
  const { data, isLoading } = useQuery({
    queryKey: ["role-permissions"],
    queryFn: () => fn(),
  });

  const matrix = new Map<AppRole, Set<AppPermission>>();
  for (const r of ROLES) matrix.set(r, new Set());
  for (const row of data ?? []) matrix.get(row.role)?.add(row.permission);

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  return (
    <div className="overflow-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Permissão</TableHead>
            {ROLES.map((r) => <TableHead key={r} className="text-center">{ROLE_LABELS[r]}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {ALL_PERMISSIONS.map((perm) => (
            <TableRow key={perm}>
              <TableCell className="text-sm">{PERM_LABELS[perm]}</TableCell>
              {ROLES.map((r) => (
                <TableCell key={r} className="text-center">
                  {matrix.get(r)?.has(perm) ? <span className="text-primary">●</span> : <span className="text-muted-foreground/40">○</span>}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AccountTab() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (pw.length < 8) { toast.error("Mínimo 8 caracteres."); return; }
    if (pw !== pw2) { toast.error("As senhas não conferem."); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setLoading(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Senha alterada.");
      setPw(""); setPw2("");
    }
  }

  return (
    <div className="space-y-3 max-w-md">
      <p className="text-sm text-muted-foreground">Altere a sua própria senha de acesso.</p>
      <div className="space-y-1">
        <Label>Nova senha</Label>
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label>Confirmar nova senha</Label>
        <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
      </div>
      <Button onClick={submit} disabled={loading}>Alterar senha</Button>
    </div>
  );
}
