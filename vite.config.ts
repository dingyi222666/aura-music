import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const productionBase = env.VITE_BASE_PATH || "/aura-music/";
  return {
    base: mode === "production" ? productionBase : "/",
    server: {
      port: 3000,
      host: "0.0.0.0",
    },
    plugins: [
      react(),
      VitePWA({
        registerType: "prompt",
        includeAssets: ["pwa-icon.svg"],
        manifest: {
          name: "Aura Music",
          short_name: "Aura Music",
          description: "A polished music player with animated lyrics and immersive visuals.",
          start_url: ".",
          scope: ".",
          display: "standalone",
          background_color: "#00150a",
          theme_color: "#16a34a",
          icons: [
            {
              src: "pwa-icon.svg",
              sizes: "512x512",
              type: "image/svg+xml",
              purpose: "any maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,webp,woff2}"],
          navigateFallback: "index.html",
        },
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (id.includes("@react-spring")) return "spring";
            if (id.includes("react") || id.includes("scheduler")) return "react";
            if (
              id.includes("colorthief") ||
              id.includes("jsmediatags") ||
              id.includes("fast-xml-parser")
            ) {
              return "media";
            }
            return "vendor";
          },
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
  };
});
