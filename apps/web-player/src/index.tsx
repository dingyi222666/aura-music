import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@aura-music/view/style.css";
import { ToastProvider } from "@aura-music/view/components/Toast";
import { I18nProvider } from "@aura-music/view/hooks/useI18n";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const params = new URLSearchParams(window.location.search);
if (params.has("glassdebug")) {
  document.documentElement.dataset.glassDebug = "1";
}
if (params.has("slow")) {
  void import("@aura-music/view/glass/motion").then((m) => {
    m.setTimeScale(0.02);
    let paused = false;
    // space = one frame, right arrow = five, p = freeze/run
    window.addEventListener("keydown", (event) => {
      if (event.code === "Space") { event.preventDefault(); m.stepMorph(1); }
      else if (event.code === "ArrowRight") { event.preventDefault(); m.stepMorph(5); }
      else if (event.key === "p") { paused = !paused; m.setStepping(paused); }
    });
  });
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <I18nProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </I18nProvider>
  </React.StrictMode>,
);
