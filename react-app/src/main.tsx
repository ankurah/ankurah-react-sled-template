import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import init_bindings, { ready } from "ankurah-template-wasm-bindings";

function isMobileSafari() {
  const ua = navigator.userAgent;
  return /iP(ad|hone|od)/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua);
}

// Mobile Safari workaround: viewport units don't work reliably, so we use explicit pixel dimensions
if (isMobileSafari()) {
  const applyDimensions = () => {
    const w = Math.floor(window.innerWidth);
    const h = Math.floor(window.innerHeight);
    const props = ["width", "max-width", "height", "max-height"];
    const values = [w, w, h, h];

    [document.documentElement, document.body, document.getElementById("root")].forEach(el => {
      if (el) props.forEach((prop, i) => el.style.setProperty(prop, values[i] + "px", "important"));
    });
  };

  applyDimensions();
  window.visualViewport?.addEventListener("resize", applyDimensions);
  window.addEventListener("resize", applyDimensions);
}

(async () => {
  console.log("Initializing application");
  await init_bindings();
  await ready();
  createRoot(document.getElementById("root")!).render(<App />);
})();