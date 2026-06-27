import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Star Games" },
      { name: "description", content: "Acesso ao painel operacional Star Games." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/", replace: true });
    });
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { display_name: displayName || email.split("@")[0] },
          },
        });
        if (error) {
          toast.error("Falha ao cadastrar", { description: error.message });
          return;
        }
        if (data.user) {
          await supabase.from("profiles").upsert({
            id: data.user.id,
            display_name: displayName || email.split("@")[0],
          });
        }
        if (data.session) {
          toast.success("Conta criada!");
          navigate({ to: "/", replace: true });
        } else {
          toast.success("Conta criada! Verifique seu e-mail para confirmar.");
          setMode("signin");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          toast.error("Falha ao entrar", { description: error.message });
          return;
        }
        toast.success("Bem-vindo!");
        navigate({ to: "/", replace: true });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background bg-gradient-to-b from-background via-background to-accent/30 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-primary to-[oklch(0.65_0.22_280)] text-primary-foreground font-bold text-2xl shadow-lg">
            S
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
          <div className="grid grid-cols-2 gap-1 rounded-full bg-foreground/5 p-1 text-sm">
            <button
              type="button"
              onClick={() => setMode("signin")}
              className={cn(
                "rounded-full py-1.5 font-medium transition-colors",
                mode === "signin"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={cn(
                "rounded-full py-1.5 font-medium transition-colors",
                mode === "signup"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Cadastrar
            </button>
          </div>

          {mode === "signup" && (
            <div className="space-y-2">
              <Label htmlFor="displayName">Nome</Label>
              <Input
                id="displayName"
                type="text"
                autoComplete="name"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Seu nome"
              />
            </div>
          )}

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
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading
              ? mode === "signup" ? "Cadastrando..." : "Entrando..."
              : mode === "signup" ? "Criar conta" : "Entrar"}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            {mode === "signup"
              ? "Ao criar a conta você terá acesso completo ao painel."
              : "Acesso restrito a usuários autorizados."}
          </p>
        </form>
      </div>
    </div>
  );
}