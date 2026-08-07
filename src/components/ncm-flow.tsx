import { ArrowDown, CheckCircle2, HelpCircle } from "lucide-react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { NCM_FALLBACK, NCM_RULES } from "@/lib/ncm-rules";
import { formatNcm } from "@/lib/nf-format";
import { cn } from "@/lib/utils";

type Step = {
  id: string;
  pergunta: string;
  ncm: string;
  descricao: string;
  palavras: string[];
  explicacao: string;
};

const PERGUNTAS: Record<string, { pergunta: string; explicacao: string }> = {
  videogame: {
    pergunta: "Tem menção a videogame ou jogo?",
    explicacao:
      "Primeiro filtro da regra StarGames: se o nome ou a plataforma citam console, jogo ou marca de videogame, o item é fiscalmente um videogame/jogo.",
  },
  original: {
    pergunta: "É boneco original?",
    explicacao:
      "Colecionáveis licenciados de fabricantes originais (Bandai, Banpresto, Good Smile, Kotobukiya, MegaHouse, Alter, Max Factory) entram como boneco colecionável.",
  },
  pop: {
    pergunta: "É pop alternativo ou pelúcia?",
    explicacao:
      "Pop alternativo e pelúcias seguem o NCM de boneco de pelúcia, mesmo quando o título traz outras palavras.",
  },
  "3d": {
    pergunta: "É 3D?",
    explicacao:
      "Impressões e figures 3D têm classificação própria, aplicada somente quando nenhuma regra anterior foi acionada.",
  },
};

const STEPS: Step[] = NCM_RULES.map((r) => ({
  id: r.id,
  pergunta: PERGUNTAS[r.id]?.pergunta ?? r.nome,
  ncm: r.ncm,
  descricao: r.descricao,
  palavras: r.palavras,
  explicacao: PERGUNTAS[r.id]?.explicacao ?? "Regra de negócio StarGames.",
}));

export function NcmFlow() {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-4">
      <div className="flex items-center justify-between gap-2 pb-3">
        <p className="text-sm font-semibold">Fluxo da regra de negócio (AderirNCM)</p>
        <p className="text-xs text-muted-foreground">
          Passe o mouse em cada card para ver a regra
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <Entry />
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex flex-col gap-1">
            <Connector />
            <StepCard step={s} index={i + 1} />
          </div>
        ))}
        <Connector />
        <FallbackCard />
      </div>
    </div>
  );
}

function Entry() {
  return (
    <div className="mx-auto rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary">
      Nome do produto + plataforma (texto normalizado)
    </div>
  );
}

function Connector() {
  return (
    <div className="flex justify-center">
      <ArrowDown className="size-4 text-muted-foreground/60" />
    </div>
  );
}

function StepCard({ step, index }: { step: Step; index: number }) {
  return (
    <HoverCard openDelay={80}>
      <HoverCardTrigger asChild>
        <div
          className={cn(
            "group grid cursor-help grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-border bg-card/60 p-3",
            "transition-colors hover:border-primary/60 hover:bg-card",
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-xs font-semibold tabular-nums">
              {index}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{step.pergunta}</p>
              <p className="truncate text-xs text-muted-foreground">
                {step.palavras.slice(0, 5).join(", ")}
                {step.palavras.length > 5 ? "…" : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-right">
            <div>
              <p className="text-sm font-semibold tabular-nums">{formatNcm(step.ncm)}</p>
              <p className="text-xs text-muted-foreground">{step.descricao}</p>
            </div>
            <CheckCircle2 className="size-4 text-primary/70" />
          </div>
        </div>
      </HoverCardTrigger>
      <HoverCardContent className="w-80 space-y-2 text-sm">
        <p className="font-semibold">{step.pergunta}</p>
        <p className="text-muted-foreground">{step.explicacao}</p>
        <p>
          <span className="text-muted-foreground">Resultado: </span>
          <span className="font-medium tabular-nums">{formatNcm(step.ncm)}</span> — {step.descricao}
        </p>
        <div className="flex flex-wrap gap-1 pt-1">
          {step.palavras.map((p) => (
            <span
              key={p}
              className="rounded border border-border bg-muted/60 px-1.5 py-0.5 text-xs text-muted-foreground"
            >
              {p}
            </span>
          ))}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function FallbackCard() {
  return (
    <HoverCard openDelay={80}>
      <HoverCardTrigger asChild>
        <div className="flex cursor-help items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-3 transition-colors hover:border-primary/50">
          <div className="flex items-center gap-2">
            <HelpCircle className="size-4 text-muted-foreground" />
            <p className="text-sm font-medium">Nenhum dos casos acima</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold tabular-nums">{formatNcm(NCM_FALLBACK.ncm)}</p>
            <p className="text-xs text-muted-foreground">{NCM_FALLBACK.descricao}</p>
          </div>
        </div>
      </HoverCardTrigger>
      <HoverCardContent className="w-80 space-y-2 text-sm">
        <p className="font-semibold">Padrão StarGames</p>
        <p className="text-muted-foreground">
          Quando nenhuma palavra-chave é reconhecida, o item recebe o NCM padrão de “Figure”. Você
          pode corrigir manualmente qualquer produto — edições manuais nunca são sobrescritas pela
          regra nem pela IA.
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
