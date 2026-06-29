import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Tag } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { useStore, type Client } from "@/lib/store";
import { useUiStore } from "@/lib/ui-store";
import { usePermissions } from "@/lib/use-permissions";
import { usePriorityAlert, conciergePrefs } from "@/lib/concierge-priority";
import { setUiValue } from "@/lib/db-sync";
import mascotAsset from "@/assets/tutorial-mascot.svg.asset.json";
import {
  AlertTriangle,
  ArrowUp,
  Bell,
  ChevronRight,
  CreditCard,
  Lightbulb,
  Link2,
  Loader2,
  Mic,
  MicOff,
  Package,
  ShieldCheck,
  Sparkles,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DashboardDrilldownModal,
  type DashboardCardId,
} from "@/components/dashboard-drilldown-modal";
import {
  resolveConciergeIntent,
  transcribeConciergeAudio,
  type ConciergeCardId,
  type ConciergeIntentResult,
  type ConciergeSection,
} from "@/lib/concierge-ai.functions";

/* ----------------------------- Quick actions ------------------------------ */

type QuickAction = {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  cardId?: DashboardCardId;
  custom?: "new-client" | "add-product";
  tone: "primary" | "danger" | "warning" | "success" | "neutral";
};

const QUICK_ACTIONS: QuickAction[] = [
  { id: "new-client", label: "Cadastrar cliente", description: "Abrir novo cliente.", icon: UserPlus, custom: "new-client", tone: "primary" },
  { id: "add-product", label: "Adicionar produto", description: "Vincular produto a cliente.", icon: Package, custom: "add-product", tone: "primary" },
  { id: "charge", label: "Cobrar cliente", description: "Cobranças elegíveis.", icon: CreditCard, cardId: "pending", tone: "primary" },
  { id: "view-pending", label: "Ver pendentes", description: "Pendências em aberto.", icon: AlertTriangle, cardId: "pending", tone: "primary" },
];

const TONE_CLASS: Record<QuickAction["tone"], string> = {
  primary: "border-primary/30 hover:bg-primary/10",
  danger: "border-destructive/30 hover:bg-destructive/10",
  warning: "border-amber-500/30 hover:bg-amber-500/10",
  success: "border-emerald-500/30 hover:bg-emerald-500/10",
  neutral: "border-border hover:bg-accent",
};

/* --------------------------------- Utils --------------------------------- */

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function sectionToDom(section: ConciergeSection): string {
  if (section === "config") return "configuracoes";
  if (section === "import") return "importacao";
  return section; // dashboard | clientes | collection | mgmv | equipe
}

function searchClients(clients: Client[], query: string): Client[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const digits = q.replace(/\D/g, "");
  return clients.filter((c) => {
    const name = (c.name || "").toLowerCase();
    const phone = (c.phone || "").replace(/\D/g, "");
    return name.includes(q) || (digits.length >= 3 && phone.includes(digits));
  });
}

/* ------------------------------- Voice hook ------------------------------ */

type RecState = "idle" | "requesting" | "recording" | "transcribing" | "denied" | "error";

function useVoiceCapture(onTranscript: (text: string) => void) {
  const [state, setState] = useState<RecState>("idle");
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const transcribe = useServerFn(transcribeConciergeAudio);

  const cleanup = useCallback(() => {
    recRef.current = null;
    chunksRef.current = [];
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (state === "recording" || state === "requesting") return;
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        cleanup();
        if (blob.size < 1500) {
          setState("idle");
          toast.info("Áudio muito curto. Tente novamente.");
          return;
        }
        setState("transcribing");
        try {
          const buf = await blob.arrayBuffer();
          let bin = "";
          const bytes = new Uint8Array(buf);
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          const audioBase64 = btoa(bin);
          const result = await transcribe({ data: { audioBase64, mime: blob.type } });
          setState("idle");
          const txt = (result?.text || "").trim();
          if (!txt) {
            toast.info("Não consegui entender o áudio. Tente falar mais claro.");
            return;
          }
          onTranscript(txt);
        } catch (err) {
          setState("error");
          toast.error(err instanceof Error ? err.message : "Falha ao transcrever áudio");
          setTimeout(() => setState("idle"), 1500);
        }
      };
      rec.start();
      setState("recording");
    } catch (err) {
      cleanup();
      const e = err as { name?: string };
      if (e?.name === "NotAllowedError" || e?.name === "SecurityError") {
        setState("denied");
        toast.error("Não foi possível acessar o microfone. Você pode digitar o comando.");
      } else {
        setState("error");
        toast.error("Microfone indisponível. Você pode digitar o comando.");
      }
      setTimeout(() => setState("idle"), 1800);
    }
  }, [cleanup, onTranscript, state, transcribe]);

  const stop = useCallback(() => {
    if (recRef.current && recRef.current.state !== "inactive") {
      recRef.current.stop();
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  return { state, start, stop };
}

/* ----------------------------- Sugestões card ---------------------------- */

type SuggestionCard = {
  id: string;
  title: string;
  body: string;
  tone: "danger" | "warning" | "success" | "primary" | "neutral";
  action: () => void;
};

/* --------------------------------- Modal --------------------------------- */

export function ConciergeModal() {
  const open = useUiStore((s) => s.conciergeOpen);
  const close = useUiStore((s) => s.closeConcierge);
  const openCx = useUiStore((s) => s.openConcierge);

  const clients = useStore((s) => s.clients);
  const products = useStore((s) => s.products);
  const openClient = useStore((s) => s.openClient);

  const permissions = usePermissions();
  const roles = permissions.access?.roles ?? [];
  const canUseAI = useMemo(
    () =>
      roles.some((r) =>
        ["admin_master", "admin", "gerente", "manager"].includes(r),
      ),
    [roles],
  );

  const alert = usePriorityAlert();

  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [activeCard, setActiveCard] = useState<DashboardCardId | null>(null);
  const [ambiguous, setAmbiguous] = useState<{
    title: string;
    matches: Client[];
    followup?: (c: Client) => void;
  } | null>(null);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const resolveIntent = useServerFn(resolveConciergeIntent);

  const hasText = text.trim().length > 0;

  // foco ao abrir
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, [open]);

  // limpa estados ao fechar
  useEffect(() => {
    if (!open) {
      setText("");
      setAmbiguous(null);
      setRunning(false);
    }
  }, [open]);

  /* ----------------------------- Execução ----------------------------- */

  const goToClient = useCallback(
    (clientId: string) => {
      openClient(clientId);
      close();
      setTimeout(() => scrollToSection("clientes"), 60);
    },
    [openClient, close],
  );

  const openCard = useCallback(
    (cardId: ConciergeCardId) => {
      setActiveCard(cardId as DashboardCardId);
      close();
    },
    [close],
  );

  const goToSection = useCallback(
    (section: ConciergeSection) => {
      close();
      setTimeout(() => scrollToSection(sectionToDom(section)), 60);
    },
    [close],
  );

  const dispatchNewClient = useCallback(() => {
    close();
    setTimeout(() => {
      scrollToSection("clientes");
      window.dispatchEvent(new CustomEvent("concierge:new-client"));
    }, 80);
  }, [close]);

  const dispatchAddProduct = useCallback(
    (clientId?: string) => {
      close();
      setTimeout(() => {
        scrollToSection("clientes");
        if (clientId) openClient(clientId);
        window.dispatchEvent(
          new CustomEvent("concierge:add-product", { detail: { clientId } }),
        );
      }, 80);
    },
    [close, openClient],
  );

  const handleSearchClient = useCallback(
    (
      query: string,
      onPicked?: (c: Client) => void,
      titleWhenMany = "Vários clientes encontrados",
    ) => {
      const matches = searchClients(clients, query);
      if (matches.length === 0) {
        toast.info(`Nenhum cliente encontrado com "${query}".`);
        return;
      }
      if (matches.length === 1) {
        if (onPicked) onPicked(matches[0]);
        else goToClient(matches[0].id);
        return;
      }
      setAmbiguous({ title: titleWhenMany, matches: matches.slice(0, 12), followup: onPicked });
    },
    [clients, goToClient],
  );

  const applyIntent = useCallback(
    (intent: ConciergeIntentResult) => {
      switch (intent.intent) {
        case "search_client":
          if (intent.clientQuery) handleSearchClient(intent.clientQuery);
          else toast.info("Diga o nome ou telefone do cliente.");
          return;
        case "open_card":
          if (intent.cardId) {
            openCard(intent.cardId);
          } else {
            toast.info(intent.message || "Não consegui identificar o filtro.");
          }
          return;
        case "open_section":
          if (intent.section) {
            if (intent.section === "collection")
              setUiValue("collection.filter", "todos");
            goToSection(intent.section);
          }
          return;
        case "open_client_create":
          dispatchNewClient();
          return;
        case "open_product_create":
          if (intent.clientQuery) {
            handleSearchClient(
              intent.clientQuery,
              (c) => dispatchAddProduct(c.id),
              "Para qual cliente?",
            );
          } else {
            dispatchAddProduct();
          }
          return;
        case "ambiguous":
          toast.info(intent.message || "Pode reformular o pedido?");
          return;
        case "unknown":
        default:
          toast.info(intent.message || "Ainda não sei executar esse comando.");
      }
    },
    [dispatchAddProduct, dispatchNewClient, goToSection, handleSearchClient, openCard],
  );

  const submitText = useCallback(
    async (raw?: string) => {
      const value = (raw ?? text).trim();
      if (!value || running) return;
      if (!canUseAI) {
        toast.info("Você não tem permissão para usar comandos do Concierge.");
        return;
      }
      setRunning(true);
      try {
        const result = await resolveIntent({ data: { text: value } });
        setText("");
        applyIntent(result);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao interpretar comando");
      } finally {
        setRunning(false);
      }
    },
    [text, running, canUseAI, resolveIntent, applyIntent],
  );

  const voice = useVoiceCapture((transcript) => {
    setText(transcript);
    // executa automaticamente o comando transcrito
    void submitText(transcript);
  });

  /* ----------------------------- Sugestões ----------------------------- */

  const suggestions: SuggestionCard[] = useMemo(() => {
    const list: SuggestionCard[] = [];
    if (alert.count > 0 && alert.cardId) {
      list.push({
        id: "primary-alert",
        title: alert.message,
        body: "Abrir agora os itens prioritários.",
        tone: alert.tone === "neutral" ? "primary" : alert.tone,
        action: () => openCard(alert.cardId as ConciergeCardId),
      });
    }
    const paid = products.filter((p) => p.financialStatus === "Pago" && p.situation === "Em Aberto").length;
    if (paid > 0 && alert.cardId !== "paid-awaiting-shipment") {
      list.push({
        id: "paid-await",
        title: `${paid} pago(s) aguardando envio`,
        body: "Abrir lista de envios pendentes.",
        tone: "success",
        action: () => openCard("paid-awaiting-shipment"),
      });
    }
    const reviewNeeded = clients.filter((c) => c.mgmv?.reviewStatus === "review_required").length;
    if (reviewNeeded > 0) {
      list.push({
        id: "review-needed",
        title: `${reviewNeeded} acordo(s) MGMV para revisar`,
        body: "Abrir revisões pendentes.",
        tone: "warning",
        action: () => openCard("review-required"),
      });
    }
    if (list.length === 0) {
      list.push({
        id: "all-clear",
        title: "Nenhum alerta crítico agora",
        body: "Você pode cadastrar cliente, adicionar produto ou consultar pendências.",
        tone: "neutral",
        action: () => dispatchNewClient(),
      });
    }
    return list.slice(0, 3);
  }, [alert, products, clients, openCard, dispatchNewClient]);

  const handleQuickAction = (a: QuickAction) => {
    if (a.cardId) return openCard(a.cardId as ConciergeCardId);
    if (a.custom === "new-client") return dispatchNewClient();
    if (a.custom === "add-product") return dispatchAddProduct();
  };

  /* -------------------------- Picker de ambiguidade -------------------------- */

  const pickClient = (c: Client) => {
    const followup = ambiguous?.followup;
    setAmbiguous(null);
    if (followup) followup(c);
    else goToClient(c.id);
  };

  /* ------------------------------- Render ------------------------------- */

  const micEnabled =
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={(o) => (o ? null : close())}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className={cn(
              "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            )}
          />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className={cn(
              "fixed z-50 flex flex-col bg-background text-foreground shadow-2xl",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
              // Mobile: fullscreen
              "inset-0 w-screen h-[100dvh] max-w-none rounded-none border-0",
              // Tablet: quase tela cheia, centralizado
              "md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2",
              "md:w-[94vw] md:h-[90vh] md:max-w-3xl md:rounded-3xl md:border md:border-border",
              // Desktop: modal premium
              "lg:w-[82vw] lg:max-w-5xl lg:h-auto lg:max-h-[85vh] lg:rounded-[28px]",
              "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
            )}
            style={{
              paddingTop: "max(env(safe-area-inset-top), 0px)",
              paddingBottom: "max(env(safe-area-inset-bottom), 0px)",
            }}
          >
            <DialogPrimitive.Title className="sr-only">
              Concierge Operacional
            </DialogPrimitive.Title>

            {/* Header */}
            <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-border/60 px-5 py-4 md:px-7 md:py-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="relative shrink-0">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-[-6px] rounded-full bg-[radial-gradient(circle_at_center,color-mix(in_oklch,var(--color-primary)_45%,transparent)_0%,transparent_70%)] blur-md"
                  />
                  <img
                    src={mascotAsset.url}
                    alt=""
                    draggable={false}
                    className="relative size-12 rounded-full object-cover ring-1 ring-primary/30 md:size-14"
                  />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold leading-tight md:text-xl">
                    O que vamos fazer agora?
                  </h2>
                  <p className="truncate text-xs text-muted-foreground md:text-sm">
                    {canUseAI
                      ? "Fale ou escreva um comando — eu abro o filtro, cliente ou cadastro certo."
                      : "Escolha uma ação rápida para abrir o filtro correto."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Fechar Concierge"
                className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-background/60 text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </header>

            {/* Conteúdo rolável */}
            <div className="flex-1 overflow-y-auto px-5 py-4 md:px-7 md:py-5">
              {/* Ambiguidade */}
              {ambiguous && (
                <section className="mb-5 rounded-2xl border border-primary/30 bg-primary/5 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-semibold">{ambiguous.title}</p>
                    <button
                      type="button"
                      onClick={() => setAmbiguous(null)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      cancelar
                    </button>
                  </div>
                  <div className="grid gap-2">
                    {ambiguous.matches.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => pickClient(c)}
                        className="flex items-center gap-3 rounded-xl border border-border bg-background/60 px-3 py-2 text-left transition hover:bg-accent"
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                          <User className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{c.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{c.phone || "—"}</p>
                        </div>
                        <Tag variant={c.mgmv ? "primary" : "neutral"}>
                          {c.mgmv ? "MGMV" : "Comum"}
                        </Tag>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Ações rápidas */}
              <section className="mb-5">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Ações rápidas
                </h3>
                <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-4">
                  {QUICK_ACTIONS.map((a) => {
                    const Icon = a.icon;
                    return (
                      <button
                        key={a.id}
                        onClick={() => handleQuickAction(a)}
                        className={cn(
                          "group flex min-h-[64px] items-start gap-3 rounded-2xl border bg-background/40 px-3 py-3 text-left transition",
                          "hover:-translate-y-0.5",
                          TONE_CLASS[a.tone],
                        )}
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-foreground/5">
                          <Icon className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{a.label}</p>
                          <p className="truncate text-xs text-muted-foreground">{a.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Sugestões */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Sugestões para agora
                </h3>
                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      onClick={s.action}
                      className={cn(
                        "rounded-2xl border bg-background/40 p-4 text-left transition hover:-translate-y-0.5 hover:bg-accent",
                        s.tone === "danger" && "border-destructive/30",
                        s.tone === "warning" && "border-amber-500/30",
                        s.tone === "success" && "border-emerald-500/30",
                        s.tone === "primary" && "border-primary/30",
                        s.tone === "neutral" && "border-border",
                      )}
                    >
                      <p className="text-sm font-semibold">{s.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{s.body}</p>
                    </button>
                  ))}
                </div>
              </section>
            </div>

            {/* Footer: input dinâmico (apenas para roles com permissão) */}
            {canUseAI ? (
              <footer className="border-t border-border/60 bg-background/95 px-5 py-4 md:px-7 md:py-5">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitText();
                  }}
                  className="relative"
                >
                  <textarea
                    ref={inputRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void submitText();
                      }
                    }}
                    placeholder={
                      voice.state === "recording"
                        ? "Gravando… fale o comando."
                        : voice.state === "transcribing"
                        ? "Interpretando áudio…"
                        : "Diga ou escreva: abrir reservas vencidas, cobrar pendentes, buscar João…"
                    }
                    rows={1}
                    disabled={running || voice.state === "transcribing"}
                    className={cn(
                      "w-full resize-none rounded-2xl border border-border bg-background pl-4 pr-16 py-4",
                      "text-base leading-snug shadow-sm transition",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      "disabled:opacity-60",
                      "min-h-[56px] max-h-[140px]",
                    )}
                  />

                  <button
                    type={hasText ? "submit" : "button"}
                    onClick={
                      hasText
                        ? undefined
                        : voice.state === "recording"
                        ? voice.stop
                        : voice.start
                    }
                    disabled={
                      (!hasText && !micEnabled) ||
                      running ||
                      voice.state === "transcribing" ||
                      voice.state === "requesting"
                    }
                    aria-label={
                      hasText
                        ? "Enviar comando"
                        : voice.state === "recording"
                        ? "Parar gravação"
                        : "Falar comando"
                    }
                    className={cn(
                      "absolute right-2 top-1/2 -translate-y-1/2",
                      "grid size-11 place-items-center rounded-full transition shadow-md",
                      hasText
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : voice.state === "recording"
                        ? "bg-destructive text-destructive-foreground animate-pulse"
                        : voice.state === "denied"
                        ? "bg-muted text-muted-foreground"
                        : "bg-foreground/10 text-foreground hover:bg-foreground/20",
                      "disabled:opacity-60 disabled:cursor-not-allowed",
                    )}
                  >
                    {running || voice.state === "transcribing" || voice.state === "requesting" ? (
                      <Loader2 className="size-5 animate-spin" />
                    ) : hasText ? (
                      <ArrowUp className="size-5" />
                    ) : voice.state === "denied" ? (
                      <MicOff className="size-5" />
                    ) : (
                      <Mic className="size-5" />
                    )}
                  </button>
                </form>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        conciergePrefs.dismissToday();
                        close();
                      }}
                      className="rounded-full border border-border px-3 py-1 hover:bg-accent transition"
                    >
                      Não abrir hoje
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        conciergePrefs.disableForever();
                        close();
                      }}
                      className="rounded-full border border-border px-3 py-1 hover:bg-accent transition"
                    >
                      Não abrir automaticamente
                    </button>
                  </div>
                  <p className="hidden sm:block">
                    Enter envia · clique no microfone para falar
                  </p>
                </div>
              </footer>
            ) : (
              <footer className="border-t border-border/60 bg-background/95 px-5 py-4 text-xs text-muted-foreground md:px-7">
                Os comandos por texto e voz estão disponíveis para administradores e gerentes.
              </footer>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <DashboardDrilldownModal
        cardId={activeCard}
        onClose={() => setActiveCard(null)}
        onScrollTo={(id) => scrollToSection(id)}
        origin="Concierge Operacional"
        onBackToConcierge={() => {
          setActiveCard(null);
          setTimeout(() => openCx(), 50);
        }}
      />
    </>
  );
}