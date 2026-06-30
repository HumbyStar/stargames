"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Mobile: tratado como uma "sessão" — mesmo chrome das páginas
        // (.one-page-section): padding superior para liberar o espaço da
        // navbar flutuante, rolagem vertical interna, sem rolagem horizontal.
        "dialog-as-section fixed inset-0 z-50 flex flex-col w-screen h-[100dvh] max-w-none gap-0 overflow-y-auto overflow-x-hidden border-0 bg-background px-6 pt-[120px] pb-14 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        // Desktop (≥640px): mesmo padrão visual do modal de Finanças — ocupa
        // 95vw até 1280px (xl:max-w-7xl), altura limitada a 92vh, distribuindo
        // o conteúdo internamente sem cortes e sem scroll horizontal.
        "sm:fixed sm:inset-auto sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:w-full sm:h-auto sm:max-w-[95vw] xl:max-w-7xl sm:max-h-[92vh] sm:gap-4 sm:grid sm:rounded-lg sm:border sm:p-8 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        aria-label="Fechar"
        className="fixed sm:absolute right-4 sm:right-3 top-[76px] sm:top-3 z-20 grid size-11 sm:size-9 place-items-center rounded-full border border-border/60 bg-background/90 backdrop-blur-md shadow-sm opacity-90 ring-offset-background cursor-pointer transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:text-muted-foreground"
      >
        <X className="h-5 w-5 sm:h-4 sm:w-4" />
        <span className="sr-only">Fechar</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col text-left",
      // Mobile: cabeçalho idêntico ao PageHeader das sessões (sem sticky, sem fundo, sem borda).
      "gap-2 mb-6 pr-14",
      // Desktop: comportamento original.
      "sm:gap-0 sm:space-y-1.5 sm:mb-0 sm:pr-0",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // Mobile: rodapé flui no fim da "sessão", botões full-width empilhados.
      "mt-8 flex flex-col-reverse gap-2 [&>button]:w-full [&>button]:min-h-11",
      // Desktop: comportamento original em linha, sem sticky.
      "sm:mt-0 sm:flex-row sm:justify-end sm:gap-0 sm:space-x-2 sm:[&>button]:w-auto sm:[&>button]:min-h-0",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      // Mobile: mesmo tamanho de título das páginas de sessão (PageHeader).
      "text-2xl font-semibold tracking-tight leading-tight",
      // Desktop: mantém o tamanho compacto original.
      "sm:text-lg sm:leading-none",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
