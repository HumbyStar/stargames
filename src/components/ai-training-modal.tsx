import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Brain, FileText, Loader2, Play, Sparkles, Upload, Check, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  startOnboarding,
  submitOnboardingAnswer,
  addTrainingDocument,
  analyzeAndSuggestAutomations,
  listAutomations,
  setAutomationStatus,
  getAiTrainingProfile,
  type AutomationSuggestion,
} from "@/lib/ai-training.functions";

type Step = "intro" | "onboarding" | "docs" | "analysis" | "review";

export function AiTrainingModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const start = useServerFn(startOnboarding);
  const submit = useServerFn(submitOnboardingAnswer);
  const addDoc = useServerFn(addTrainingDocument);
  const analyze = useServerFn(analyzeAndSuggestAutomations);
  const list = useServerFn(listAutomations);
  const setStatus = useServerFn(setAutomationStatus);
  const getProfile = useServerFn(getAiTrainingProfile);

  const [step, setStep] = useState<Step>("intro");
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState<string>("");
  const [answer, setAnswer] = useState("");
  const [progress, setProgress] = useState({ answered: 0, total: 8 });
  const [docName, setDocName] = useState("");
  const [docContent, setDocContent] = useState("");
  const [docsCount, setDocsCount] = useState(0);
  const [insights, setInsights] = useState<string[]>([]);
  const [automations, setAutomations] = useState<AutomationSuggestion[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const profile = await getProfile();
        setDocsCount(profile.documents?.length ?? 0);
        setProgress({ answered: profile.onboarding_answers?.length ?? 0, total: 8 });
        if (profile.onboarding_completed) {
          const auto = await list();
          setAutomations(auto);
          setStep(auto.length ? "review" : "analysis");
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, [open, getProfile, list]);

  async function beginOnboarding() {
    setLoading(true);
    try {
      const r = await start();
      setQuestion(r.question);
      setAnswer("");
      setStep("onboarding");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao iniciar.");
    } finally {
      setLoading(false);
    }
  }

  async function sendAnswer(finish = false) {
    if (!answer.trim()) {
      toast.error("Responda antes de continuar.");
      return;
    }
    setLoading(true);
    try {
      const r = await submit({ data: { question, answer: answer.trim(), finish } });
      setProgress((p) => ({ ...p, answered: p.answered + 1 }));
      setAnswer("");
      if (r.completed || !r.nextQuestion) {
        toast.success("Onboarding concluído. Vamos analisar o sistema.");
        setStep("docs");
      } else {
        setQuestion(r.nextQuestion);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setLoading(false);
    }
  }

  async function uploadDoc() {
    if (!docContent.trim()) {
      toast.error("Cole o conteúdo do documento.");
      return;
    }
    setLoading(true);
    try {
      const r = await addDoc({ data: { name: docName || "regra.txt", content: docContent } });
      setDocsCount(r.total);
      setDocName("");
      setDocContent("");
      toast.success("Documento adicionado ao treinamento.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setLoading(false);
    }
  }

  async function runAnalysis() {
    setLoading(true);
    setStep("analysis");
    try {
      const r = await analyze();
      setInsights(r.insights);
      const all = await list();
      setAutomations(all);
      setStep("review");
      toast.success(`${r.suggestions.length} automação(ões) sugerida(s).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na análise.");
      setStep("docs");
    } finally {
      setLoading(false);
    }
  }

  async function approve(id: string, status: "approved" | "archived") {
    try {
      await setStatus({ data: { id, status } });
      setAutomations((arr) => arr.map((a) => (a.id === id ? { ...a, status } : a)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="size-5 text-primary" />
            Treinar I.A — Modo CEO
          </DialogTitle>
          <DialogDescription>
            A IA aprende o seu sistema como se fosse parte do time. Depois sugere automações em Python
            para reduzir o uso de IA conversacional em tarefas repetitivas.
          </DialogDescription>
        </DialogHeader>

        {step === "intro" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StepCard num={1} label="Perguntas guiadas" desc="A IA faz perguntas para entender seu negócio." />
              <StepCard num={2} label="Documentos & regras" desc="Você envia processos internos em texto." />
              <StepCard num={3} label="Análise + Python" desc="A IA varre o sistema e gera automações." />
            </div>
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              Já respondidas: <b>{progress.answered}/{progress.total}</b> · Documentos: <b>{docsCount}</b>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={beginOnboarding} disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {progress.answered > 0 ? "Continuar onboarding" : "Começar"}
              </Button>
              <Button variant="outline" onClick={() => setStep("docs")}>
                <Upload className="size-4" /> Enviar documentos
              </Button>
              <Button variant="outline" onClick={runAnalysis} disabled={loading}>
                <Play className="size-4" /> Análise para estudo da IA
              </Button>
            </div>
          </div>
        )}

        {step === "onboarding" && (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">Pergunta {progress.answered + 1} de {progress.total}</div>
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">{question}</div>
            <Textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Responda como se estivesse explicando ao seu sócio..."
              rows={5}
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => sendAnswer(false)} disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Próxima
              </Button>
              <Button variant="outline" onClick={() => sendAnswer(true)} disabled={loading}>
                Encerrar agora
              </Button>
              <Button variant="ghost" onClick={() => setStep("intro")}>Voltar</Button>
            </div>
          </div>
        )}

        {step === "docs" && (
          <div className="space-y-3">
            <div className="text-sm">Cole processos internos, regras ou políticas. Documentos enviados: <b>{docsCount}</b></div>
            <Input value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="Nome do documento (ex: regra-cobranca.txt)" />
            <Textarea
              value={docContent}
              onChange={(e) => setDocContent(e.target.value)}
              placeholder="Cole aqui o conteúdo (regras, fluxo de cobrança, política de envio...)"
              rows={8}
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={uploadDoc} disabled={loading}>
                <FileText className="size-4" /> Salvar documento
              </Button>
              <Button variant="default" onClick={runAnalysis} disabled={loading}>
                <Play className="size-4" /> Rodar análise agora
              </Button>
              <Button variant="ghost" onClick={() => setStep("intro")}>Voltar</Button>
            </div>
          </div>
        )}

        {step === "analysis" && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader2 className="size-8 animate-spin text-primary" />
            <div className="text-sm">A IA está varrendo o sistema, audit log, importações, MGMV e tarefas…</div>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-3">
            {insights.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="text-xs font-semibold mb-1">Insights da IA-CEO</div>
                <ul className="text-xs list-disc pl-4 space-y-1">
                  {insights.map((i, k) => <li key={k}>{i}</li>)}
                </ul>
              </div>
            )}
            {automations.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                Nenhuma automação ainda. Rode uma análise.
              </div>
            ) : (
              <div className="space-y-2">
                {automations.map((a) => (
                  <div key={a.id} className="rounded-md border border-border bg-card/50 p-3">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-sm">{a.name}</span>
                          <Badge variant="outline" className="text-[10px]">{a.scope}</Badge>
                          <Badge variant="outline" className="text-[10px]">{a.trigger}</Badge>
                          <Badge
                            variant={a.status === "approved" ? "default" : a.status === "archived" ? "secondary" : "outline"}
                            className="text-[10px]"
                          >
                            {a.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{a.description}</p>
                        <p className="text-[11px] mt-1"><b>Aplica em:</b> {a.applies_to}</p>
                        <p className="text-[11px] text-muted-foreground"><b>Reduz IA:</b> {a.estimated_ai_savings}</p>
                      </div>
                      <div className="flex flex-col gap-1">
                        <Button size="sm" variant="outline" onClick={() => setExpanded((e) => e === a.id ? null : a.id!)}>
                          {expanded === a.id ? "Fechar" : "Ver código"}
                        </Button>
                        {a.id && a.status !== "approved" && (
                          <Button size="sm" onClick={() => approve(a.id!, "approved")}>
                            <Check className="size-3" /> Aprovar
                          </Button>
                        )}
                        {a.id && a.status !== "archived" && (
                          <Button size="sm" variant="ghost" onClick={() => approve(a.id!, "archived")}>
                            <X className="size-3" /> Arquivar
                          </Button>
                        )}
                      </div>
                    </div>
                    {expanded === a.id && (
                      <div className="mt-3 space-y-2">
                        <div className="text-[11px] text-muted-foreground"><b>Por quê:</b> {a.reasoning}</div>
                        <pre className="text-[11px] bg-background border border-border rounded p-2 overflow-x-auto max-h-72">
                          <code>{a.python_code}</code>
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" onClick={runAnalysis} disabled={loading}>
                <Play className="size-4" /> Rodar nova análise
              </Button>
              <Button variant="ghost" onClick={() => setStep("intro")}>Voltar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StepCard({ num, label, desc }: { num: number; label: string; desc: string }) {
  return (
    <div className="rounded-md border border-border bg-card/50 p-3">
      <div className="text-xs text-muted-foreground">Passo {num}</div>
      <div className="text-sm font-semibold">{label}</div>
      <div className="text-xs text-muted-foreground mt-1">{desc}</div>
    </div>
  );
}