import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/app/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Remodex Web",
        short_name: "Remodex",
        description: "Local-first Remodex browser client",
        display: "standalone",
        start_url: "/app/",
        scope: "/app/",
        background_color: "#0b1112",
        theme_color: "#0b1112",
        icons: [
          {
            src: "favicon.svg",
            sizes: "any",
            type: "image/svg+xml"
          }
        ]
      },
      workbox: {
        navigateFallback: "/app/index.html",
        importScripts: ["push-sw.js"],
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"]
      }
    })
  ]
});
