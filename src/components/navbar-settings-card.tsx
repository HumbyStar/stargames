import { useState, type DragEvent } from "react";
import { GripVertical, Eye, EyeOff, Lock, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  useNavbarConfig,
  NAVBAR_ICON_CATALOG,
  DEFAULT_NAVBAR_ORDER,
  type NavbarIconId,
} from "@/lib/navbar-config";
import { usePermissions } from "@/lib/use-permissions";
import { cn } from "@/lib/utils";

export function NavbarSettingsCard() {
  const { hasPermission } = usePermissions();
  const { config, setOrder, toggleHidden, setAnimation, reset } =
    useNavbarConfig();
  const [dragId, setDragId] = useState<NavbarIconId | null>(null);
  const [overId, setOverId] = useState<NavbarIconId | null>(null);

  // Lista de itens que o usuário tem permissão para enxergar
  const items = config.order
    .map((id) => NAVBAR_ICON_CATALOG.find((m) => m.id === id))
    .filter(
      (m): m is (typeof NAVBAR_ICON_CATALOG)[number] =>
        Boolean(m) && (!m!.permission || hasPermission(m!.permission)),
    );

  // Bloqueados por permissão (apenas informativo)
  const blockedByPermission = NAVBAR_ICON_CATALOG.filter(
    (m) => m.permission && !hasPermission(m.permission),
  );

  const handleDrop = (target: NavbarIconId) => {
    if (!dragId || dragId === target) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const ids = items.map((i) => i.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(target);
    if (from < 0 || to < 0) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const next = ids.slice();
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    // Mantém ícones sem permissão na posição original (no final, escondidos)
    const merged: NavbarIconId[] = [
      ...next,
      ...config.order.filter((id) => !ids.includes(id)),
    ];
    setOrder(merged);
    setDragId(null);
    setOverId(null);
  };

  return (
    <Card title="Navbar">
      <div className="space-y-5">
        <p className="text-xs text-muted-foreground">
          Reordene os ícones do lado direito da navbar arrastando-os.
          Os links de seção (Dashboard, Clientes, Equipe, MGMV, Collection) são fixos.
          Ícones de funções sem permissão não aparecem na navbar.
        </p>

        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Ícones da navbar
          </Label>
          <ul className="rounded-lg border border-border bg-background/40 p-1">
            {items.map((item) => {
              const Icon = item.icon;
              const isHidden = config.hidden.includes(item.id);
              const isDragging = dragId === item.id;
              const isOver = overId === item.id && dragId !== item.id;
              return (
                <li
                  key={item.id}
                  draggable
                  onDragStart={(e: DragEvent) => {
                    setDragId(item.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e: DragEvent) => {
                    e.preventDefault();
                    setOverId(item.id);
                  }}
                  onDragLeave={() => setOverId((c) => (c === item.id ? null : c))}
                  onDrop={(e: DragEvent) => {
                    e.preventDefault();
                    handleDrop(item.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-2 py-2 transition-colors",
                    isDragging && "opacity-50",
                    isOver && "bg-primary/10 ring-1 ring-primary/40",
                    isHidden && "opacity-60",
                  )}
                >
                  <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" />
                  <div className="grid size-8 place-items-center rounded-full bg-foreground/5 text-foreground">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                  {item.locked ? (
                    <span
                      title="Sempre visível"
                      className="inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2 py-1 text-[10px] text-muted-foreground"
                    >
                      <Lock className="size-3" /> Fixo
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleHidden(item.id)}
                      className="inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2 py-1 text-[10px] text-foreground transition-colors hover:bg-foreground/10"
                      title={isHidden ? "Mostrar na navbar" : "Ocultar da navbar"}
                    >
                      {isHidden ? (
                        <>
                          <EyeOff className="size-3" /> Oculto
                        </>
                      ) : (
                        <>
                          <Eye className="size-3" /> Visível
                        </>
                      )}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {blockedByPermission.length > 0 && (
            <p className="pt-1 text-[11px] text-muted-foreground">
              Sem acesso (ocultos automaticamente):{" "}
              {blockedByPermission.map((m) => m.label).join(", ")}.
            </p>
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-border bg-background/40 p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Desativar animações da navbar</p>
              <p className="text-xs text-muted-foreground">
                Ignora hover, pulse e anel de progresso.
              </p>
            </div>
            <Switch
              checked={config.animation.disabled}
              onCheckedChange={(v) => setAnimation({ disabled: v })}
            />
          </div>

          <SliderRow
            label="Velocidade do hover/expansão"
            value={config.animation.hoverMs}
            min={100}
            max={2000}
            step={50}
            unit="ms"
            disabled={config.animation.disabled}
            onChange={(v) => setAnimation({ hoverMs: v })}
          />
          <SliderRow
            label="Duração do efeito de saída (pulse-out)"
            value={config.animation.leaveMs}
            min={500}
            max={6000}
            step={100}
            unit="ms"
            disabled={config.animation.disabled}
            onChange={(v) => setAnimation({ leaveMs: v })}
          />
          <SliderRow
            label="Velocidade do anel de progresso"
            value={config.animation.ringMs}
            min={600}
            max={6000}
            step={100}
            unit="ms"
            disabled={config.animation.disabled}
            onChange={(v) => setAnimation({ ringMs: v })}
          />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">
            Ordem padrão: {DEFAULT_NAVBAR_ORDER.length} ícones, sem ocultos.
          </p>
          <Button variant="outline" size="sm" onClick={reset} className="gap-2">
            <RotateCcw className="size-3.5" /> Restaurar padrão
          </Button>
        </div>
      </div>
    </Card>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className={cn("space-y-1.5", disabled && "opacity-50")}>
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <span className="tabular-nums text-xs text-muted-foreground">
          {value}
          {unit}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(v) => onChange(v[0] ?? value)}
      />
    </div>
  );
}