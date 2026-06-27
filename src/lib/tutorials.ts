import { useCallback, useEffect, useState } from "react";

export type TutorialAvatarPosition = "top" | "right" | "bottom" | "left";

export type TutorialStep = {
  id: string;
  targetSelector: string;
  title: string;
  description: string;
  avatarPosition?: TutorialAvatarPosition;
  onEnter?: () => void;
};

export type Tutorial = {
  id: string;
  title: string;
  description: string;
  estimatedTime: string;
  steps: TutorialStep[];
};

export type TutorialStatus = "not_started" | "started" | "skipped" | "completed";

export type TutorialProgress = {
  tutorialId: string;
  status: TutorialStatus;
  completedAt?: string;
  skippedAt?: string;
};

const STORAGE_KEY = "sg.tutorial.progress.v1";

function readProgress(): Record<string, TutorialProgress> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, TutorialProgress>;
  } catch {
    return {};
  }
}

function writeProgress(p: Record<string, TutorialProgress>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    window.dispatchEvent(new CustomEvent("sg:tutorial-progress"));
  } catch {
    /* ignore */
  }
}

export function useTutorialProgress() {
  const [progress, setProgress] = useState<Record<string, TutorialProgress>>(() => readProgress());

  useEffect(() => {
    const sync = () => setProgress(readProgress());
    window.addEventListener("storage", sync);
    window.addEventListener("sg:tutorial-progress", sync as EventListener);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("sg:tutorial-progress", sync as EventListener);
    };
  }, []);

  const markCompleted = useCallback((id: string) => {
    const next = { ...readProgress(), [id]: { tutorialId: id, status: "completed" as const, completedAt: new Date().toISOString() } };
    writeProgress(next);
  }, []);

  const markSkipped = useCallback((id: string) => {
    const next = { ...readProgress(), [id]: { tutorialId: id, status: "skipped" as const, skippedAt: new Date().toISOString() } };
    writeProgress(next);
  }, []);

  const markStarted = useCallback((id: string) => {
    const cur = readProgress();
    if (cur[id]?.status === "completed") return;
    const next = { ...cur, [id]: { tutorialId: id, status: "started" as const } };
    writeProgress(next);
  }, []);

  return { progress, markCompleted, markSkipped, markStarted };
}

export const TUTORIALS: Tutorial[] = [
  {
    id: "primeiros-passos",
    title: "Primeiros passos",
    description: "Conheça as principais áreas do sistema Star Games.",
    estimatedTime: "2 minutos",
    steps: [
      { id: "navbar", targetSelector: "[data-tour='navbar']", title: "Navbar principal", description: "Aqui ficam os acessos principais do sistema e as ações rápidas.", avatarPosition: "bottom" },
      { id: "global-search", targetSelector: "[data-tour='global-search']", title: "Pesquisa global", description: "Use a busca para encontrar clientes, telefones, produtos ou plataformas.", avatarPosition: "bottom" },
      { id: "dashboard", targetSelector: "[data-tour='dashboard-section']", title: "Dashboard", description: "Aqui você acompanha os principais indicadores da operação." },
      { id: "clientes", targetSelector: "[data-tour='clients-section']", title: "Clientes", description: "Toda a base de clientes, com produtos, MGMV e histórico financeiro." },
      { id: "collection", targetSelector: "[data-tour='collection-section']", title: "Collection", description: "Centralize aqui as cobranças em aberto e copie mensagens prontas." },
      { id: "import", targetSelector: "[data-tour='upload-button']", title: "Importação", description: "Importe dados em massa a partir do ZIP do Notion." },
      { id: "settings", targetSelector: "[data-tour='settings-button']", title: "Configurações", description: "Ajuste preferências, regras de cobrança e notificações." },
    ],
  },
  {
    id: "como-importar-clientes",
    title: "Como importar clientes",
    description: "Aprenda a abrir a importação, enviar ZIP e revisar o preview antes de salvar.",
    estimatedTime: "2 minutos",
    steps: [
      { id: "upload-icon", targetSelector: "[data-tour='upload-button']", title: "Ícone de upload", description: "Clique aqui para abrir a importação de dados." },
      { id: "import-modal", targetSelector: "[data-tour='import-modal']", title: "Modal de importação", description: "Esta é a área de importação. Vamos abrir automaticamente para você." },
      { id: "import-zip-tab", targetSelector: "[data-tour='import-zip-tab']", title: "Aba ZIP Notion", description: "Escolha o tipo de importação por ZIP exportado do Notion." },
      { id: "import-dropzone", targetSelector: "[data-tour='import-dropzone']", title: "Envio do arquivo", description: "Arraste o arquivo ZIP ou clique para selecionar." },
      { id: "import-preview", targetSelector: "[data-tour='import-preview']", title: "Preview da importação", description: "Revise o que será importado antes de confirmar." },
      { id: "import-confirm", targetSelector: "[data-tour='import-confirm']", title: "Confirmar importação", description: "Quando tudo estiver certo, confirme para salvar." },
    ],
  },
  {
    id: "como-revisar-clientes",
    title: "Como revisar clientes",
    description: "Aprenda a navegar pela base de clientes e abrir uma ficha completa.",
    estimatedTime: "2 minutos",
    steps: [
      { id: "clients-section", targetSelector: "[data-tour='clients-section']", title: "Seção Clientes", description: "Esta é a base completa de clientes." },
      { id: "global-search", targetSelector: "[data-tour='global-search']", title: "Buscar cliente", description: "Use a busca para localizar um cliente por nome, telefone ou produto." },
    ],
  },
  {
    id: "como-usar-collection",
    title: "Como usar a Collection",
    description: "Aprenda a revisar cobranças, filtrar e copiar mensagens prontas.",
    estimatedTime: "3 minutos",
    steps: [
      { id: "collection-section", targetSelector: "[data-tour='collection-section']", title: "Seção Collection", description: "Esta é a central de cobranças." },
      { id: "collection-metrics", targetSelector: "[data-tour='collection-metrics']", title: "Cards de indicadores", description: "Veja o panorama das cobranças em aberto." },
      { id: "collection-filters", targetSelector: "[data-tour='collection-filters']", title: "Filtros de cobrança", description: "Filtre por status, vencimento e tipo de cobrança." },
      { id: "collection-table", targetSelector: "[data-tour='collection-table']", title: "Tabela de cobranças", description: "Aqui ficam as cobranças, agrupadas por cliente." },
      { id: "collection-copy", targetSelector: "[data-tour='collection-copy']", title: "Copiar mensagem", description: "Copie a mensagem de cobrança pronta para enviar ao cliente." },
    ],
  },
  {
    id: "como-entender-mgmv",
    title: "Como entender MGMV",
    description: "Entenda o acordo MGMV e como ele aparece em clientes e cobranças.",
    estimatedTime: "2 minutos",
    steps: [
      { id: "mgmv-client", targetSelector: "[data-tour='mgmv-client']", title: "Cliente com MGMV", description: "Clientes com acordo MGMV ativo aparecem com um indicador especial." },
      { id: "mgmv-block", targetSelector: "[data-tour='mgmv-block']", title: "Bloco do acordo MGMV", description: "Aqui ficam os detalhes do acordo, parcelas e valores." },
      { id: "mgmv-products", targetSelector: "[data-tour='mgmv-products']", title: "Produtos incluídos", description: "Estes são os produtos agrupados pelo acordo MGMV." },
      { id: "mgmv-collection", targetSelector: "[data-tour='mgmv-collection']", title: "Cobrança consolidada", description: "Na Collection, o MGMV aparece como uma única cobrança por parcela." },
    ],
  },
  {
    id: "como-usar-configuracoes",
    title: "Como usar configurações",
    description: "Aprenda a ajustar preferências, regras e zonas perigosas.",
    estimatedTime: "1 minuto",
    steps: [
      { id: "settings-button", targetSelector: "[data-tour='settings-button']", title: "Abrir Configurações", description: "Clique no ícone de engrenagem para abrir as configurações." },
      { id: "settings-modal", targetSelector: "[data-tour='settings-modal']", title: "Painel de configurações", description: "Aqui você ajusta preferências, regras de cobrança e notificações." },
    ],
  },
];

export function getTutorial(id: string): Tutorial | undefined {
  return TUTORIALS.find((t) => t.id === id);
}
