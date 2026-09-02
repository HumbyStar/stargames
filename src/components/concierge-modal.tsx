import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Tag } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { useStore, type Client } from "@/lib/store";
import { useEnsureData } from "@/lib/use-ensure-data";
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
import {
  ConciergeTaskConfirmModal,
  type ConciergeTaskDraft,
} from "@/components/concierge-task-confirm-modal";
import type { ConciergeTaskType, ConciergePriority } from "@/lib/concierge-tasks.functions";
import { DataIntegrityPanel } from "@/components/data-integrity-panel";
import { OnlineUsersStrip } from "@/components/online-presence";

/* ----------------------------- Quick actions ------------------------------ */

type QuickAction = {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  cardId?: DashboardCardId;
  custom?: "new-client" | "add-product" | "validate-data";
  tone: "primary" | "danger" | "warning" | "success" | "neutral";
};

const QUICK_ACTIONS: QuickAction[] = [
  { id: "new-client", label: "Cadastrar cliente", description: "Abrir novo cliente.", icon: UserPlus, custom: "new-client", tone: "primary" },
  { id: "add-product", label: "Adicionar produto", description: "Vincular produto a cliente.", icon: Package, custom: "add-product", tone: "primary" },
  { id: "charge", label: "Cobrar cliente", description: "Cobranças elegíveis.", icon: CreditCard, cardId: "pending", tone: "primary" },
  { id: "view-pending", label: "Ver pendentes", description: "Pendências em aberto.", icon: AlertTriangle, cardId: "pending", tone: "primary" },
  { id: "validate-data", label: "Validar dados", description: "Detecta inconsistências e sugere correções seguras.", icon: ShieldCheck, custom: "validate-data", tone: "success" },
];

const SUGGESTION_STYLE: Record<
  "danger" | "warning" | "success" | "primary" | "neutral",
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    wrap: string;
    iconWrap: string;
    title: string;
  }
> = {
  warning: {
    label: "Sugestão",
    icon: Lightbulb,
    wrap: "border-amber-300/60 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10",
    iconWrap: "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300",
    title: "text-amber-700 dark:text-amber-300",
  },
  danger: {
    label: "Alerta",
    icon: Bell,
    wrap: "border-rose-300/60 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10",
    iconWrap: "bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300",
    title: "text-rose-700 dark:text-rose-300",
  },
  success: {
    label: "Atalho",
    icon: Link2,
    wrap: "border-emerald-300/60 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10",
    iconWrap: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300",
    title: "text-emerald-700 dark:text-emerald-300",
  },
  primary: {
    label: "Atalho",
    icon: Sparkles,
    wrap: "border-primary/40 bg-primary/5",
    iconWrap: "bg-primary/10 text-primary",
    title: "text-primary",
  },
  neutral: {
    label: "Sugestão",
    icon: Lightbulb,
    wrap: "border-border bg-background",
    iconWrap: "bg-foreground/5 text-foreground",
    title: "text-foreground",
  },
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

  // Só carrega a base quando o assistente é realmente aberto.
  useEnsureData(open);
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
  const [taskDraft, setTaskDraft] = useState<ConciergeTaskDraft | null>(null);
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [integrityOpen, setIntegrityOpen] = useState(false);

  const canCreateTasks = useMemo(
    () =>
      roles.some((r) =>
        ["admin_master", "admin", "gerente", "manager"].includes(r),
      ),
    [roles],
  );

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
      setTaskPickerOpen(false);
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
        case "create_task":
          if (!canCreateTasks) {
            toast.info("Apenas administradores e gerentes podem criar tarefas pelo Concierge.");
            return;
          }
          if (!intent.taskType) {
            setTaskPickerOpen(true);
            return;
          }
          setTaskDraft({
            taskType: intent.taskType,
            title: intent.suggestedTitle || "Nova tarefa",
            description: intent.suggestedDescription || "",
            priority: (intent.suggestedPriority as ConciergePriority) || "media",
            linkedFilter: (intent.linkedFilter as Record<string, unknown> | null) ?? null,
            linkedEntityType: intent.linkedEntityType ?? null,
            linkedEntityId: null,
          });
          return;
        case "ambiguous":
          toast.info(intent.message || "Pode reformular o pedido?");
          return;
        case "unknown":
        default:
          toast.info(intent.message || "Ainda não sei executar esse comando.");
      }
    },
    [canCreateTasks, dispatchAddProduct, dispatchNewClient, goToSection, handleSearchClient, openCard],
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
        const result = (await resolveIntent({ data: { text: value } })) as ConciergeIntentResult;
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
    if (a.custom === "validate-data") return setIntegrityOpen(true);
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
              "md:w-[94vw] md:h-auto md:max-h-[92vh] md:max-w-2xl md:rounded-3xl md:border md:border-border",
              // Desktop: modal premium
              "lg:w-[70vw] lg:max-w-2xl lg:max-h-[90vh] lg:rounded-[28px]",
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

            {/* Close button (absolute) */}
            <button
              type="button"
              onClick={close}
              aria-label="Fechar Concierge"
              className="absolute right-4 top-4 z-10 grid size-10 place-items-center rounded-2xl border border-border bg-background/80 text-muted-foreground shadow-sm transition hover:bg-accent hover:text-foreground md:right-5 md:top-5"
            >
              <X className="size-5" />
            </button>

            {/* Conteúdo rolável */}
            <div className="flex-1 overflow-y-auto px-6 pb-6 pt-8 md:px-10 md:pb-8 md:pt-10">
              {/* Hero: avatar + título centralizado */}
              <div className="flex flex-col items-center text-center">
                <span className="relative">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-[-10px] rounded-full bg-[radial-gradient(circle_at_center,color-mix(in_oklch,var(--color-primary)_45%,transparent)_0%,transparent_70%)] blur-lg"
                  />
                  <img
                    src={mascotAsset.url}
                    alt=""
                    draggable={false}
                    className="relative size-24 rounded-full object-cover ring-2 ring-primary/40 md:size-28"
                  />
                </span>
                <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-primary">
                  <Sparkles className="size-3.5" />
                  Concierge Operacional
                </div>
                <h2 className="mt-2 text-2xl font-extrabold tracking-tight md:text-3xl">
                  O que vamos fazer agora?
                </h2>
                <p className="mt-2 max-w-md text-sm text-muted-foreground md:text-[15px]">
                  {canUseAI
                    ? "Digite ou fale. Eu encontro a sessão certa, aplico os filtros e te levo direto para a ação."
                    : "Escolha uma ação rápida para abrir o filtro correto."}
                </p>
                <OnlineUsersStrip active={open} />
              </div>

              {/* Ambiguidade */}
              {ambiguous && (
                <section className="mt-6 rounded-2xl border border-primary/30 bg-primary/5 p-4">
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

              {/* Ações rápidas — grid 2x2 */}
              <section className="mt-6 grid grid-cols-2 gap-3">
                {QUICK_ACTIONS.map((a) => {
                  const Icon = a.icon;
                  return (
                    <button
                      key={a.id}
                      onClick={() => handleQuickAction(a)}
                      className={cn(
                        "group flex items-center gap-3 rounded-2xl border border-border bg-background px-4 py-4 text-left transition",
                        "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
                      )}
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1 text-[15px] font-semibold leading-tight">
                        {a.label}
                      </span>
                    </button>
                  );
                })}
              </section>

              {/* Input + botão circular separados */}
              {canUseAI && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitText();
                  }}
                  className="mt-5 flex items-center gap-3"
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
                        : "Ex.: abrir cobranças de reservas vencidas"
                    }
                    rows={1}
                    disabled={running || voice.state === "transcribing"}
                    className={cn(
                      "flex-1 resize-none rounded-2xl border-2 border-primary/40 bg-background px-4 py-4",
                      "text-[15px] leading-snug shadow-sm transition",
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
                      "grid size-14 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition",
                      "hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed",
                      voice.state === "recording" && "animate-pulse bg-destructive",
                    )}
                  >
                    {running || voice.state === "transcribing" || voice.state === "requesting" ? (
                      <Loader2 className="size-6 animate-spin" />
                    ) : hasText ? (
                      <ArrowUp className="size-6" />
                    ) : voice.state === "denied" ? (
                      <MicOff className="size-6" />
                    ) : (
                      <Mic className="size-6" />
                    )}
                  </button>
                </form>
              )}

              {/* Sugestões em fieldset */}
              <fieldset className="mt-6 rounded-2xl border border-border px-4 pb-4 pt-3">
                <legend className="px-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  Sugestões para você
                </legend>
                <div className="flex flex-col gap-3">
                  {suggestions.map((s) => {
                    const styles = SUGGESTION_STYLE[s.tone];
                    const Icon = styles.icon;
                    return (
                      <button
                        key={s.id}
                        onClick={s.action}
                        className={cn(
                          "flex items-center gap-4 rounded-2xl border px-4 py-3 text-left transition hover:-translate-y-0.5",
                          styles.wrap,
                        )}
                      >
                        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", styles.iconWrap)}>
                          <Icon className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className={cn("text-sm font-bold", styles.title)}>{styles.label}</p>
                          <p className="text-[13px] leading-snug text-foreground/80">{s.title}</p>
                        </div>
                        <ChevronRight className={cn("size-5 shrink-0", styles.title)} />
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {/* Footnote */}
              <div className="mt-5 flex items-start justify-center gap-2 text-center text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                <p>O Concierge prioriza navegar para áreas já existentes do sistema.</p>
              </div>

              {/* Permissões / preferências */}
              {canUseAI ? (
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px] text-muted-foreground">
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
              ) : (
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  Os comandos por texto e voz estão disponíveis para administradores e gerentes.
                </p>
              )}
            </div>
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
      <ConciergeTaskConfirmModal
        open={!!taskDraft}
        draft={taskDraft}
        onClose={() => setTaskDraft(null)}
      />
      <ConciergeTaskTypePicker
        open={taskPickerOpen}
        onClose={() => setTaskPickerOpen(false)}
        onPick={(taskType) => {
          setTaskPickerOpen(false);
          setTaskDraft(makeDefaultDraft(taskType));
        }}
      />
      <DataIntegrityPanel open={integrityOpen} onClose={() => setIntegrityOpen(false)} />
    </>
  );
}

/* ------------------------ Picker quando intenção é vaga ----------------------- */

function makeDefaultDraft(taskType: ConciergeTaskType): ConciergeTaskDraft {
  const TYPES: Record<ConciergeTaskType, ConciergeTaskDraft> = {
    cobranca: {
      taskType, title: "Cobrar pendências em aberto",
      description: "Revisar e cobrar clientes com pendências em aberto.",
      priority: "alta",
      linkedFilter: { context: "collection", financialStatus: "Reserva", overdue: true },
      linkedEntityType: null, linkedEntityId: null,
    },
    mgmv: {
      taskType, title: "Revisar MGMV pendente",
      description: "Revisar acordos MGMV marcados como review_required.",
      priority: "alta",
      linkedFilter: { context: "mgmv", reviewStatus: "review_required" },
      linkedEntityType: null, linkedEntityId: null,
    },
    envio: {
      taskType, title: "Verificar produtos pagos aguardando envio",
      description: "Conferir e separar produtos pagos para envio.",
      priority: "media",
      linkedFilter: { context: "shipping", financialStatus: "Pago", situation: "Em Aberto" },
      linkedEntityType: null, linkedEntityId: null,
    },
    importacao: {
      taskType, title: "Revisar importações com erro",
      description: "Conferir batches de importação com pendências.",
      priority: "media",
      linkedFilter: { context: "import", status: "error" },
      linkedEntityType: null, linkedEntityId: null,
    },
    revisao_ia: {
      taskType, title: "Revisar análises de IA",
      description: "Validar revisões automatizadas pendentes.",
      priority: "media",
      linkedFilter: { context: "mgmv", reviewStatus: "ai_reviewed" },
      linkedEntityType: null, linkedEntityId: null,
    },
    cadastro: {
      taskType, title: "Conferir cadastros inconsistentes",
      description: "Verificar dados de cliente faltando ou inválidos.",
      priority: "media",
      linkedFilter: null, linkedEntityType: null, linkedEntityId: null,
    },
    financeiro: {
      taskType, title: "Verificar pagamentos pendentes",
      description: "Conciliar pagamentos no financeiro.",
      priority: "media",
      linkedFilter: null, linkedEntityType: null, linkedEntityId: null,
    },
    atendimento: {
      taskType, title: "Atender clientes pendentes",
      description: "Acompanhar clientes que aguardam retorno.",
      priority: "media",
      linkedFilter: null, linkedEntityType: null, linkedEntityId: null,
    },
    leiloes: {
      taskType, title: "Acompanhar leilões",
      description: "Verificar leilões e arremates em aberto.",
      priority: "media",
      linkedFilter: null, linkedEntityType: null, linkedEntityId: null,
    },
    dados_inconsistentes: {
      taskType, title: "Conferir dados inconsistentes",
      description: "Revisar registros com inconsistências de cadastro.",
      priority: "media",
      linkedFilter: null, linkedEntityType: null, linkedEntityId: null,
    },
  };
  return TYPES[taskType];
}

const TASK_TYPE_LABELS: { id: ConciergeTaskType; label: string }[] = [
  { id: "cobranca", label: "Cobrança" },
  { id: "mgmv", label: "MGMV" },
  { id: "envio", label: "Envio" },
  { id: "importacao", label: "Importação" },
  { id: "revisao_ia", label: "Revisão IA" },
  { id: "cadastro", label: "Cadastro" },
  { id: "financeiro", label: "Financeiro" },
  { id: "atendimento", label: "Atendimento" },
];

function ConciergeTaskTypePicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (t: ConciergeTaskType) => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-[60] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-6 shadow-2xl">
          <DialogPrimitive.Title className="text-lg font-semibold">
            Que tipo de tarefa você quer criar?
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
            Escolha um tipo para continuar.
          </DialogPrimitive.Description>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {TASK_TYPE_LABELS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onPick(t.id)}
                className="rounded-lg border border-border bg-background px-3 py-2 text-left text-sm font-medium transition hover:border-primary/40 hover:bg-accent"
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}