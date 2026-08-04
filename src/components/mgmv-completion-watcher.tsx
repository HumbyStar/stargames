import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { isAgreementFullyPaid } from "@/lib/mgmv-schedule";
import { MgmvCompleteModal } from "@/components/mgmv-complete-modal";

/**
 * Observador global de acordos MGMV.
 *
 * Assim que a última parcela de um acordo é marcada como paga (não importa de
 * onde: seção MGMV, ficha do cliente, cobrança ou dashboard), abre o modal de
 * conclusão para o usuário confirmar a quitação. Se ele fechar sem concluir, o
 * modal não reabre para o mesmo acordo nesta sessão — a faixa de aviso
 * continua disponível nas telas.
 */
export function MgmvCompletionWatcher() {
  const clients = useStore((s) => s.clients);
  const products = useStore((s) => s.products);
  const completeMGMVAgreement = useStore((s) => s.completeMGMVAgreement);
  const ensureMGMVProductsLoaded = useStore((s) => s.ensureMGMVProductsLoaded);
  const openClient = useStore((s) => s.openClient);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [productsLoading, setProductsLoading] = useState(false);
  const loading = useRef<Set<string>>(new Set());
  /** Acordos já sinalizados nesta sessão (evita reabrir em loop). */
  const notified = useRef<Set<string>>(new Set());

  useEffect(() => {
    let toOpen: string | null = null;
    for (const c of clients) {
      if (!c.mgmv) continue;
      const fullyPaid = !c.mgmv.completedAt && isAgreementFullyPaid(c.mgmv);
      if (fullyPaid && !notified.current.has(c.id) && !loading.current.has(c.id)) {
        const alreadyLoaded = products.some(
          (p) => p.clientId === c.id && p.financialStatus === "MGMV",
        );
        if (alreadyLoaded) {
          notified.current.add(c.id);
          toOpen = toOpen ?? c.id;
        } else {
          loading.current.add(c.id);
          setProductsLoading(true);
          void ensureMGMVProductsLoaded(c.id)
            .then((loaded) => {
              if (loaded.length === 0) {
                toast.error("Não foi possível carregar os produtos do MGMV. A conclusão foi bloqueada.");
                return;
              }
              notified.current.add(c.id);
              setTargetId(c.id);
            })
            .catch(() => {
              toast.error("Falha ao carregar os produtos do MGMV. Tente novamente antes de concluir.");
            })
            .finally(() => {
              loading.current.delete(c.id);
              setProductsLoading(false);
            });
        }
      }
      if (!fullyPaid) notified.current.delete(c.id);
    }
    if (toOpen) setTargetId(toOpen);
  }, [clients, products, ensureMGMVProductsLoaded]);

  if (!targetId) return null;
  const client = clients.find((c) => c.id === targetId);
  if (!client?.mgmv || client.mgmv.completedAt) return null;

  const mgmvProducts = products.filter(
    (p) => p.clientId === client.id && p.financialStatus === "MGMV",
  );

  return (
    <MgmvCompleteModal
      open
      contentClassName="z-[100]"
      clientName={client.name}
      agreement={client.mgmv}
      products={mgmvProducts}
      productsLoading={productsLoading}
      onClose={() => setTargetId(null)}
      onReview={() => {
        setTargetId(null);
        openClient(client.id);
      }}
      onConfirm={async () => {
        const res = await completeMGMVAgreement(client.id);
        if (res.ok) {
          setTargetId(null);
          toast.success(
            `MGMV concluído. ${res.movedProducts} produto(s) agora estão como Pago / Em Aberto.`,
          );
        } else {
          toast.error("Não foi possível concluir o acordo.");
        }
      }}
    />
  );
}