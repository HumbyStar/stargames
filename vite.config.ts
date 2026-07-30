// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      // Só no bundle do cliente — evita o worker ser emitido no build do servidor.
      ...pwaClientOnly(),
    ],
  },
});

/** Plugins do PWA restritos ao bundle do cliente. */
function pwaClientOnly() {
  const plugins = ([] as unknown[]).concat(
      // Instalação local (Windows) + funcionamento offline.
      // O registro é feito só em produção, pelo wrapper src/lib/pwa.ts.
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: null,
        filename: "sw.js",
        devOptions: { enabled: false },
        manifest: {
          id: "/",
          name: "Star Games — Sistema",
          short_name: "Star Games",
          description:
            "Gestão de clientes, MGMV, cobrança e finanças da Star Games, com modo local offline.",
          start_url: "/",
          scope: "/",
          display: "standalone",
          background_color: "#0b0f19",
          theme_color: "#0b0f19",
          lang: "pt-BR",
          icons: [
            {
              src: "/__l5e/assets-v1/3f064917-5ab7-43c8-891d-1a1ae3483292/mascot-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/__l5e/assets-v1/3b83e5fc-b434-4e11-9857-e8597e7924d9/mascot-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/__l5e/assets-v1/3b83e5fc-b434-4e11-9857-e8597e7924d9/mascot-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,woff2}"],
          navigateFallback: null,
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              // Documentos: rede primeiro; offline usa a última página visitada.
              urlPattern: ({ request, url }: { request: Request; url: URL }) =>
                request.mode === "navigate" && !url.pathname.startsWith("/~oauth"),
              handler: "NetworkFirst",
              options: {
                cacheName: "sg-pages",
                networkTimeoutSeconds: 5,
                expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
                sameOrigin && (url.pathname.startsWith("/__l5e/") || url.pathname.startsWith("/_build/")),
              handler: "CacheFirst",
              options: {
                cacheName: "sg-assets",
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 90 },
              },
            },
          ],
        },
      }) as unknown,
  );
  return plugins.map((plugin) => ({
    ...(plugin as Record<string, unknown>),
    applyToEnvironment: (env: { name: string }) => env.name === "client",
  })) as never[];
}
