import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useUiStore } from "@/lib/ui-store";

export const Route = createFileRoute("/_authenticated/nikostart")({
  component: NikostartRedirect,
});

function NikostartRedirect() {
  const openConcierge = useUiStore((s) => s.openConcierge);
  useEffect(() => {
    openConcierge();
  }, [openConcierge]);
  return <Navigate to="/" replace />;
}