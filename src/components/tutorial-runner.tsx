import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X, Check, AlertCircle } from "lucide-react";
import { TutorialAvatar } from "@/components/tutorial-avatar";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/lib/ui-store";
import { useTutorialProgress, getTutorial, type Tutorial } from "@/lib/tutorials";

type Rect = { top: number; left: number; width: number; height: number };

function getRect(selector: string): Rect | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function TutorialRunner() {
  const activeId = useUiStore((s) => s.activeTutorialId);
  const stopTutorial = useUiStore((s) => s.stopTutorial);
  const openImport = useUiStore((s) => s.openImport);
  const openSettings = useUiStore((s) => s.openSettings);
  const { markCompleted, markSkipped, markStarted } = useTutorialProgress();

  const tutorial = useMemo<Tutorial | undefined>(() => (activeId ? getTutorial(activeId) : undefined), [activeId]);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [tick, setTick] = useState(0);
  const lastSelectorRef = useRef<string | null>(null);

  // Reset state when tutorial changes.
  useEffect(() => {
    setStepIndex(0);
    if (activeId) markStarted(activeId);
  }, [activeId, markStarted]);

  const step = tutorial?.steps[stepIndex];

  // Side effects per step (e.g. abrir modal de importação/configurações).
  useEffect(() => {
    if (!tutorial || !step) return;
    if (tutorial.id === "como-importar-clientes" && step.id !== "upload-icon") {
      openImport();
    }
    if (tutorial.id === "como-usar-configuracoes" && step.id === "settings-modal") {
      openSettings();
    }
    if (typeof step.onEnter === "function") step.onEnter();
  }, [tutorial, step, openImport, openSettings]);

  // Locate the target element (with retries to handle modals abrindo).
  useLayoutEffect(() => {
    if (!step) {
      setRect(null);
      return;
    }
    lastSelectorRef.current = step.targetSelector;
    let cancelled = false;
    let attempts = 0;
    const tryFind = () => {
      if (cancelled) return;
      const r = getRect(step.targetSelector);
      if (r) {
        setRect(r);
        return;
      }
      attempts += 1;
      if (attempts < 20) setTimeout(tryFind, 120);
      else setRect(null);
    };
    tryFind();
    return () => {
      cancelled = true;
    };
  }, [step, tick]);

  // Re-measure on scroll/resize.
  useEffect(() => {
    if (!activeId) return;
    const onChange = () => setTick((t) => t + 1);
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [activeId]);

  // Esc fecha o tutorial.
  useEffect(() => {
    if (!activeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleSkip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  if (!activeId || !tutorial || !step) return null;
  if (typeof document === "undefined") return null;

  const isLast = stepIndex === tutorial.steps.length - 1;
  const isFirst = stepIndex === 0;

  const handlePrev = () => setStepIndex((i) => Math.max(0, i - 1));
  const handleNext = () => {
    if (isLast) {
      markCompleted(tutorial.id);
      stopTutorial();
    } else {
      setStepIndex((i) => i + 1);
    }
  };
  const handleSkip = () => {
    markSkipped(tutorial.id);
    stopTutorial();
  };

  // Highlight + balloon + avatar positions
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const padding = 8;
  const highlightStyle = rect
    ? {
        top: rect.top - padding,
        left: rect.left - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
      }
    : null;

  const balloonWidth = isMobile ? Math.min(window.innerWidth - 32, 380) : 360;
  const avatarSize = isMobile ? 56 : 76;

  let avatarTop = 100;
  let avatarLeft = 100;
  let balloonTop = 100;
  let balloonLeft = 100;

  if (rect && !isMobile) {
    const pos = step.avatarPosition ?? "bottom";
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (pos === "bottom") {
      avatarTop = Math.min(rect.top + rect.height + 16, vh - avatarSize - 16);
      avatarLeft = Math.min(Math.max(rect.left + rect.width / 2 - avatarSize / 2, 16), vw - avatarSize - 16);
    } else if (pos === "top") {
      avatarTop = Math.max(rect.top - avatarSize - 16, 16);
      avatarLeft = Math.min(Math.max(rect.left + rect.width / 2 - avatarSize / 2, 16), vw - avatarSize - 16);
    } else if (pos === "right") {
      avatarTop = Math.min(Math.max(rect.top + rect.height / 2 - avatarSize / 2, 16), vh - avatarSize - 16);
      avatarLeft = Math.min(rect.left + rect.width + 16, vw - avatarSize - 16);
    } else {
      avatarTop = Math.min(Math.max(rect.top + rect.height / 2 - avatarSize / 2, 16), vh - avatarSize - 16);
      avatarLeft = Math.max(rect.left - avatarSize - 16, 16);
    }
    // Balloon ao lado do avatar
    balloonTop = Math.min(Math.max(avatarTop, 16), vh - 220);
    balloonLeft = avatarLeft + avatarSize + 16;
    if (balloonLeft + balloonWidth > vw - 16) {
      balloonLeft = Math.max(avatarLeft - balloonWidth - 16, 16);
    }
  } else if (!rect && !isMobile) {
    // Centralizado quando alvo não existe
    avatarTop = window.innerHeight / 2 - avatarSize;
    avatarLeft = window.innerWidth / 2 - avatarSize / 2;
    balloonTop = avatarTop + avatarSize + 16;
    balloonLeft = window.innerWidth / 2 - balloonWidth / 2;
  }

  const tailSide: "left" | "right" | "bottom" = isMobile
    ? "bottom"
    : balloonLeft >= avatarLeft
      ? "left"
      : "right";

  const content = (
    <div className="tutorial-root" role="dialog" aria-modal="true" aria-label={`Tutorial: ${tutorial.title}`}>
      <div className="tutorial-overlay" onClick={handleSkip} />

      {highlightStyle && (
        <div className="tutorial-highlight" style={highlightStyle} />
      )}

      {/* Avatar */}
      <div
        className="tutorial-avatar-wrapper"
        style={
          isMobile
            ? { bottom: 220, left: 16, top: "auto" }
            : { top: avatarTop, left: avatarLeft }
        }
      >
        <TutorialAvatar size={avatarSize} expression={rect ? "pointing" : "warning"} />
      </div>

      {/* Balão */}
      <div
        className="tutorial-balloon"
        data-tail-side={tailSide}
        style={
          isMobile
            ? { bottom: 16, left: 16, right: 16, width: "auto", top: "auto" }
            : { top: balloonTop, left: balloonLeft, width: balloonWidth }
        }
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {tutorial.title} · Passo {stepIndex + 1}/{tutorial.steps.length}
          </span>
          <button
            onClick={handleSkip}
            aria-label="Fechar tutorial"
            className="grid size-7 place-items-center rounded-full text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <h3 className="mt-1 text-base font-semibold text-foreground">{step.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>

        {!rect && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs text-foreground">
            <AlertCircle className="mt-0.5 size-3.5 text-warning" />
            <span>Este item ainda não está disponível nesta tela. Você pode continuar o tutorial.</span>
          </div>
        )}

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
          <div
            className="h-full rounded-full bg-[oklch(0.82_0.16_85)] transition-all duration-300"
            style={{ width: `${((stepIndex + 1) / tutorial.steps.length) * 100}%` }}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={handleSkip}>
            Pular tutorial
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handlePrev} disabled={isFirst}>
              <ChevronLeft className="size-3.5" /> Anterior
            </Button>
            <Button size="sm" onClick={handleNext}>
              {isLast ? (
                <>
                  Finalizar <Check className="size-3.5" />
                </>
              ) : (
                <>
                  Próximo <ChevronRight className="size-3.5" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
