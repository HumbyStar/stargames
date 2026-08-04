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
  const openClient = useStore((s) => s.openClient);
  const [targetId, setTargetId] = useState<string | null>(null);
  /** Acordos já sinalizados nesta sessão (evita reabrir em loop). */
  const notified = useRef<Set<string>>(new Set());

  useEffect(() => {
    let toOpen: string | null = null;
    for (const c of clients) {
      if (!c.mgmv) continue;
      const fullyPaid = !c.mgmv.completedAt && isAgreementFullyPaid(c.mgmv);
      if (fullyPaid && !notified.current.has(c.id)) {
        notified.current.add(c.id);
        toOpen = toOpen ?? c.id;
      }
      if (!fullyPaid) notified.current.delete(c.id);
    }
    if (toOpen) setTargetId(toOpen);
  }, [clients]);

  if (!targetId) return null;
  const client = clients.find((c) => c.id === targetId);
  if (!client?.mgmv || client.mgmv.completedAt) return null;

  const mgmvProducts = products.filter(
    (p) => p.clientId === client.id && p.financialStatus === "MGMV",
  );

  return (
    <MgmvCompleteModal
      open
      contentClassName="z-[80]"
      clientName={client.name}
      agreement={client.mgmv}
      products={mgmvProducts}
      onClose={() => setTargetId(null)}
      onReview={() => {
        setTargetId(null);
        openClient(client.id);
      }}
      onConfirm={() => {
        const res = completeMGMVAgreement(client.id);
        setTargetId(null);
        if (res.ok) {
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