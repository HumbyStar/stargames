import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface CustomerDataModalProps {
  open: boolean;
  onClose: () => void;
  clientName: string;
  initialData?: string;
  onSave: (data: string) => void;
}

export function CustomerDataModal({
  open,
  onClose,
  clientName,
  initialData,
  onSave,
}: CustomerDataModalProps) {
  const [data, setData] = useState(initialData ?? "");

  useEffect(() => {
    setData(initialData ?? "");
  }, [initialData, open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Preencher Dados do Cliente</DialogTitle>
          <DialogDescription>
            Dados completos de <strong>{clientName}</strong> — este campo é livre
            e não substitui nome e telefone.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={data}
          onChange={(e) => setData(e.target.value)}
          placeholder="Cole ou digite aqui as informações completas do cliente: Nome, CPF, Endereço, CEP, E-mail, etc."
          className="min-h-64"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onSave(data);
              onClose();
            }}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
