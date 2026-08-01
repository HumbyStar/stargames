import { useEffect, useState } from "react";
import { isOnline as isBrowserOnline } from "@/lib/local-mode";
import { supabase } from "@/integrations/supabase/client";

/**
 * Status de conexão com o sistema: combina o estado do navegador
 * (eventos online/offline) com um ping leve ao backend.
 */
export function useConnectionStatus(): { online: boolean; checking: boolean } {
  const [online, setOnline] = useState(true);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (cancelled) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setOnline(false);
        setChecking(false);
        return;
      }
      if (!isBrowserOnline()) {
        setOnline(false);
        setChecking(false);
        return;
      }
      try {
        const { error } = await supabase
          .from("app_settings")
          .select("id")
          .limit(1);
        if (!cancelled) setOnline(!error);
      } catch {
        if (!cancelled) setOnline(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    void check();
    const id = window.setInterval(check, 30_000);
    const onOnline = () => void check();
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", onOnline);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", onOnline);
    };
  }, []);

  return { online, checking };
}
