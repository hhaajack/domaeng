import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/app/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.png",
        "favicon-32.png",
        "apple-touch-icon.png",
        "icons/domaeng-icon-192.png",
        "icons/domaeng-icon-512.png"
      ],
      manifest: {
        name: "Domaeng Web",
        short_name: "Domaeng",
        description: "Local-first Domaeng browser client",
        display: "standalone",
        start_url: "/app/",
        scope: "/app/",
        background_color: "#0b1112",
        theme_color: "#0b1112",
        icons: [
          {
            src: "icons/domaeng-icon-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "icons/domaeng-icon-512.png",
            sizes: "512x512",
            type: "image/png"
          },
          {
            src: "icons/domaeng-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
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
