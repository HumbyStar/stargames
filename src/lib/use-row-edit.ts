import { useCallback, useState } from "react";
import { toast } from "sonner";

/**
 * Hook genérico de edição por linha nas tabelas operacionais.
 *
 * Regras (não negociáveis):
 * - editar não é salvar; alterar campo não confirma.
 * - blur / click fora nunca salva e nunca cancela.
 * - só `confirm()` persiste, e só `close()` descarta.
 * - somente uma linha pode ser editada por vez: se houver `hasUnsavedChanges`,
 *   `startEdit` para outra linha é bloqueado com toast.
 */
export interface UseRowEditResult<T extends Record<string, unknown>> {
  editingRowId: string | null;
  draftValues: T | null;
  originalValues: T | null;
  hasUnsavedChanges: boolean;
  isEditing: (id: string) => boolean;
  startEdit: (id: string, values: T) => boolean;
  setField: <K extends keyof T>(key: K, value: T[K]) => void;
  setDraft: (patch: Partial<T>) => void;
  confirm: (
    onSave: (draft: T, original: T) => Promise<void> | void,
    opts?: { validate?: (draft: T) => string | null },
  ) => Promise<void>;
  close: () => void;
}

export function useRowEdit<T extends Record<string, unknown>>(): UseRowEditResult<T> {
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [draftValues, setDraftValues] = useState<T | null>(null);
  const [originalValues, setOriginalValues] = useState<T | null>(null);

  const hasUnsavedChanges =
    !!draftValues &&
    !!originalValues &&
    JSON.stringify(draftValues) !== JSON.stringify(originalValues);

  const startEdit = useCallback(
    (id: string, values: T): boolean => {
      if (editingRowId && editingRowId !== id && hasUnsavedChanges) {
        toast.error(
          "Existe uma edição pendente. Confirme ou feche antes de editar outra linha.",
        );
        return false;
      }
      setEditingRowId(id);
      setDraftValues({ ...values });
      setOriginalValues({ ...values });
      return true;
    },
    [editingRowId, hasUnsavedChanges],
  );

  const setField = useCallback(
    <K extends keyof T>(key: K, value: T[K]) => {
      setDraftValues((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    [],
  );

  const setDraft = useCallback((patch: Partial<T>) => {
    setDraftValues((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const close = useCallback(() => {
    setEditingRowId(null);
    setDraftValues(null);
    setOriginalValues(null);
  }, []);

  const confirm = useCallback(
    async (
      onSave: (draft: T, original: T) => Promise<void> | void,
      opts?: { validate?: (draft: T) => string | null },
    ) => {
      if (!draftValues || !originalValues) return;
      if (opts?.validate) {
        const err = opts.validate(draftValues);
        if (err) {
          toast.error(err);
          return;
        }
      }
      try {
        await onSave(draftValues, originalValues);
        setEditingRowId(null);
        setDraftValues(null);
        setOriginalValues(null);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao salvar");
      }
    },
    [draftValues, originalValues],
  );

  return {
    editingRowId,
    draftValues,
    originalValues,
    hasUnsavedChanges,
    isEditing: (id) => editingRowId === id,
    startEdit,
    setField,
    setDraft,
    confirm,
    close,
  };
}