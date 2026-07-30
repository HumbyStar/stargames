import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportLovableError } from "@/lib/lovable-error-reporting";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string | null;
}

function isRenderLoop(error: Error | null): boolean {
  return Boolean(error?.message && /Maximum update depth|Too many re-renders/i.test(error.message));
}

/**
 * Captura erros de render em qualquer ponto da árvore (inclusive loops de
 * atualização) e mostra uma tela amigável em vez da página em branco.
 */
export class GlobalErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[GlobalErrorBoundary]", error, info);
    this.setState({ info: info.componentStack ?? null });
    try {
      reportLovableError(error, { boundary: "global_error_boundary" });
    } catch {
      // relatório é best-effort
    }
  }

  private handleReload = () => {
    // Em loop de render, limpa apenas o estado de interface persistido —
    // sessão e dados do usuário permanecem intactos.
    if (isRenderLoop(this.state.error)) {
      try {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("sg:ui") || key.startsWith("ui:") || key.startsWith("onepage:")) {
            localStorage.removeItem(key);
          }
        }
      } catch {
        // storage indisponível: segue para o reload
      }
    }
    window.location.reload();
  };

  private handleRetry = () => {
    this.setState({ error: null, info: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const loop = isRenderLoop(error);

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-foreground">
            Algo travou por aqui
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {loop
              ? "A tela entrou em um ciclo de atualização e precisou ser interrompida. Recarregue a página — as preferências de exibição serão redefinidas e seus dados continuam salvos."
              : "Não conseguimos carregar esta parte do sistema. Você pode tentar novamente ou recarregar a página. Nenhum dado foi perdido."}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={this.handleReload}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Recarregar página
            </button>
            {!loop && (
              <button
                onClick={this.handleRetry}
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                Tentar novamente
              </button>
            )}
            <a
              href="/"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Voltar ao início
            </a>
          </div>

          <details className="mt-5 rounded-md border border-border bg-muted/30 p-3 text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Detalhe técnico
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
              {error.message}
              {this.state.info ? `\n${this.state.info}` : ""}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
