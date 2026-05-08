import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import "./styles.css";

function syncThemeChrome() {
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  const color = dark ? "#0b1112" : "#f7f8f3";
  document.documentElement.style.backgroundColor = color;
  document.body.style.backgroundColor = color;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
}

syncThemeChrome();
window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener("change", syncThemeChrome);

const updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh() {
    void updateServiceWorker(true);
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
