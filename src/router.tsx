import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

if (import.meta.env.DEV && typeof window !== "undefined" && !(window as any).__loopDbg) {
  (window as any).__loopDbg = true;
  const orig = console.error;
  console.error = (...args: any[]) => {
    if (typeof args[0] === "string" && args[0].includes("Maximum update depth")) {
      (window as any).__loopStack = new Error("loop").stack;
    }
    orig(...args);
  };
}

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
