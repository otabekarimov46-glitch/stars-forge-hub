import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Register Service Worker only in production, never in iframes / Lovable preview
(() => {
  if (!("serviceWorker" in navigator)) return;
  const inIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();
  const host = window.location.hostname;
  const isPreview = host.includes("lovableproject.com") || host.includes("lovable.app") || host === "localhost" || host.startsWith("127.");
  if (inIframe || isPreview || import.meta.env.DEV) {
    // Make sure no SW lingers in dev/preview
    navigator.serviceWorker.getRegistrations?.().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
})();
