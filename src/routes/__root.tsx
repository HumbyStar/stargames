import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { GlobalErrorBoundary } from "@/components/global-error-boundary";
import faviconIco from "@/assets/favicons/favicon.ico.asset.json";
import favicon32 from "@/assets/favicons/mascot-32.png.asset.json";
import favicon180 from "@/assets/favicons/mascot-180.png.asset.json";
import favicon192 from "@/assets/favicons/mascot-192.png.asset.json";
import favicon512 from "@/assets/favicons/mascot-512.png.asset.json";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "stargamesmgmv" },
      { name: "description", content: "Star Games — Gestão Operacional" },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "stargamesmgmv" },
      { property: "og:description", content: "Star Games — Gestão Operacional" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "stargamesmgmv" },
      { name: "twitter:description", content: "Star Games — Gestão Operacional" },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/f44b2d19-92eb-4c1a-8721-4386b7044396/id-preview-15b0ecb7--9675ace6-1d0a-4259-a33a-8378153df5fa.lovable.app-1782423492922.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/f44b2d19-92eb-4c1a-8721-4386b7044396/id-preview-15b0ecb7--9675ace6-1d0a-4259-a33a-8378153df5fa.lovable.app-1782423492922.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", type: "image/x-icon", href: faviconIco.url },
      { rel: "icon", type: "image/png", sizes: "32x32", href: favicon32.url },
      { rel: "icon", type: "image/png", sizes: "192x192", href: favicon192.url },
      { rel: "icon", type: "image/png", sizes: "512x512", href: favicon512.url },
      { rel: "apple-touch-icon", sizes: "180x180", href: favicon180.url },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        useStore.getState().reset();
        router.invalidate();
      } else if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        router.invalidate();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [router]);

  return (
    <QueryClientProvider client={queryClient}>
      <GlobalErrorBoundary>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
      </GlobalErrorBoundary>
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  );
}
