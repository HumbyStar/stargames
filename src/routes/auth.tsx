import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { claimSession } from "@/lib/session-guard.functions";
import { SESSION_ID_KEY } from "@/components/session-guard";
import mascotAsset from "@/assets/tutorial-mascot.svg.asset.json";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): { next?: string } => ({
    next: typeof s.next === "string" && s.next.startsWith("/") && !s.next.startsWith("//") ? s.next : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Entrar — Star Games" },
      { name: "description", content: "Acesso ao painel operacional Star Games." },
    ],
  }),
  component: AuthPage,
});

function newSessionId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

const NETWORK_HINT =
  "Seu navegador não conseguiu alcançar o servidor de login. Isso costuma ser bloqueio de extensão (AdBlock/uBlock/Brave Shields), VPN, proxy ou firewall da rede. Desative a extensão para este site, troque de rede (ex.: 4G do celular) e tente novamente.";

function isNetworkFailure(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("network request failed") ||
    m.includes("load failed") ||
    m.includes("fetch failed")
  );
}

function describeAuthError(message: string) {
  if (isNetworkFailure(message)) return NETWORK_HINT;
  if (message.toLowerCase().includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if (message.toLowerCase().includes("email not confirmed")) return "E-mail ainda não confirmado.";
  return message;
}

function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        if (next) window.location.replace(next);
        else navigate({ to: "/", replace: true });
      }
    });
  }, [navigate, next]);

  async function attemptClaim() {
    const sessionId = newSessionId();
    const res = await claimSession({ data: { sessionId, force: true } });
    if (res.ok) {
      try {
        localStorage.setItem(SESSION_ID_KEY, sessionId);
      } catch {}
      toast.success("Bem-vindo!");
      if (next) window.location.replace(next);
      else navigate({ to: "/", replace: true });
      return;
    }
    if (res.reason === "no_internal_access") {
      await supabase.auth.signOut();
      toast.error("Sem acesso interno", {
        description:
          "Sua conta não está liberada para o painel. Peça a um administrador ou gerente para atribuir um perfil de acesso.",
        duration: 9000,
      });
      return;
    }
    // Sessões concorrentes liberadas — outros retornos não bloqueiam.
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        const network = isNetworkFailure(error.message);
        toast.error(network ? "Sem conexão com o servidor de login" : "Falha ao entrar", {
          description: describeAuthError(error.message),
          duration: network ? 12000 : 6000,
        });
        return;
      }
      await attemptClaim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro inesperado";
      const network = isNetworkFailure(msg);
      toast.error(network ? "Sem conexão com o servidor de login" : "Não foi possível concluir o login", {
        description: describeAuthError(msg),
        duration: network ? 12000 : 6000,
      });
      if (!network) await supabase.auth.signOut();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background bg-gradient-to-b from-background via-background to-accent/30 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-[-12px] rounded-full bg-[radial-gradient(circle_at_center,color-mix(in_oklch,var(--color-primary)_45%,transparent)_0%,transparent_70%)] blur-xl"
            />
            <img
              src={mascotAsset.url}
              alt="Concierge Operacional"
              draggable={false}
              className="relative size-24 rounded-full object-cover ring-2 ring-primary/40 shadow-xl"
            />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight">Star Games</h1>
            <p className="text-sm text-muted-foreground">Gestão Operacional</p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-border bg-card/80 p-6 shadow-xl backdrop-blur space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@stargames.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Acesso restrito. Novos usuários são cadastrados por um administrador ou gerente.
          </p>
        </form>
      </div>
    </div>
  );
}