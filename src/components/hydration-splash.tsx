import { useEffect, useMemo, useRef, useState } from "react";
import mascotAsset from "@/assets/tutorial-mascot.svg.asset.json";
import { supabase } from "@/integrations/supabase/client";

const NAME_CACHE_KEY = "sg_display_name";

function firstName(full: string | null | undefined): string | null {
  if (!full) return null;
  const first = full.trim().split(/\s+/)[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : null;
}

/**
 * Resolve o primeiro nome do usuário autenticado sem bloquear o render.
 * Ordem: cache de sessão → user_metadata.full_name → profiles.display_name → email local-part.
 */
export function useHydrationUserName(): string | null {
  const [name, setName] = useState<string | null>(() => {
    if (typeof sessionStorage === "undefined") return null;
    try {
      return sessionStorage.getItem(NAME_CACHE_KEY);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user;
        if (!user) return;
        const metaFull = (user.user_metadata as { full_name?: string } | null)?.full_name ?? null;
        let resolved = firstName(metaFull);
        if (!resolved) {
          const { data: prof } = await supabase
            .from("profiles")
            .select("display_name")
            .eq("id", user.id)
            .maybeSingle();
          resolved = firstName((prof as { display_name?: string | null } | null)?.display_name);
        }
        if (!resolved && user.email) {
          resolved = firstName(user.email.split("@")[0]);
        }
        if (!cancelled && resolved) {
          setName(resolved);
          try {
            sessionStorage.setItem(NAME_CACHE_KEY, resolved);
          } catch {}
        }
      } catch {
        // silencioso: fallback já está no render
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return name;
}

const LOADING_PHRASES = [
  "Carregando tabelas e clientes…",
  "Preparando cobranças em aberto…",
  "Carregando MGMV e acordos ativos…",
  "Sincronizando importações recentes…",
  "Ajustando o Concierge para o seu dia…",
  "Como está seu dia até agora?",
];

const PHRASE_MS = 1400;
const GREETING_MS = 1800;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * Splash exibido enquanto o store hidrata.
 * - Mostra o mascote/Concierge com balão de fala.
 * - Frases rotativas com progress bar sincronizada.
 * - Nunca chega a 100% enquanto montado — o unmount é o sinal de sucesso.
 */
export function HydrationSplash({ userName }: { userName: string | null }) {
  const reduced = usePrefersReducedMotion();
  const [phraseIndex, setPhraseIndex] = useState(-1); // -1 = greeting
  const startedAt = useRef(Date.now());

  useEffect(() => {
    const timers: number[] = [];
    timers.push(
      window.setTimeout(() => setPhraseIndex(0), GREETING_MS),
    );
    const interval = window.setInterval(() => {
      setPhraseIndex((i) => {
        if (i < 0) return 0;
        // segura na última frase enquanto o splash ainda estiver montado
        return Math.min(i + 1, LOADING_PHRASES.length - 1);
      });
    }, GREETING_MS + PHRASE_MS);
    timers.push(interval);
    return () => timers.forEach((t) => clearInterval(t));
  }, []);

  const greeting = useMemo(() => {
    if (userName) return `Bem-vindo(a), ${userName}! Vamos otimizar seu trabalho?`;
    return "Bem-vindo(a) de volta! Vamos otimizar seu trabalho?";
  }, [userName]);

  const text = phraseIndex < 0 ? greeting : LOADING_PHRASES[phraseIndex];
  // Progresso: greeting = 8%, depois distribui até 92% pelas frases
  const totalSteps = LOADING_PHRASES.length;
  const progress =
    phraseIndex < 0
      ? 8
      : Math.min(92, 8 + ((phraseIndex + 1) / totalSteps) * 84);

  return (
    <div className="grid min-h-screen place-items-center bg-background px-6">
      <style>{`
        @keyframes hs-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes hs-bubble-in {
          from { opacity: 0; transform: translateX(-8px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .hs-float { animation: hs-float 3.4s ease-in-out infinite; }
        .hs-bubble { animation: hs-bubble-in 260ms ease-out both; }
        .hs-bubble::before {
          content: "";
          position: absolute;
          left: -8px;
          top: 28px;
          width: 0;
          height: 0;
          border-top: 8px solid transparent;
          border-bottom: 8px solid transparent;
          border-right: 10px solid hsl(var(--card));
          filter: drop-shadow(-1px 0 0 hsl(var(--border)));
        }
      `}</style>
      <div className="flex w-full max-w-xl flex-col items-center gap-6 md:flex-row md:items-center md:gap-8">
        <div className={reduced ? "" : "hs-float"}>
          <img
            src={mascotAsset.url}
            alt="Concierge"
            className="size-32 md:size-40 drop-shadow-md select-none"
            draggable={false}
          />
        </div>
        <div className="flex-1 w-full">
          <div
            className="hs-bubble relative rounded-2xl border border-border bg-card px-5 py-4 shadow-lg"
            role="status"
            aria-live="polite"
          >
            <p key={phraseIndex} className={reduced ? "text-sm text-foreground" : "text-sm text-foreground animate-fade-in"}>
              {text}
            </p>
          </div>
          <div
            className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Carregando dados"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Otimizando sua sessão…
          </p>
        </div>
      </div>
      {/* startedAt referenciado para futura extensão (min splash time) */}
      <span className="sr-only" aria-hidden>{startedAt.current}</span>
    </div>
  );
}