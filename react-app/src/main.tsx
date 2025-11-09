import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import init_bindings, { ready } from "{{project-name}}-wasm-bindings";

function isMobileSafari() {
  const ua = navigator.userAgent;
  return /iP(ad|hone|od)/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua);
}

// Mobile Safari workaround: viewport units don't work reliably, so we use explicit pixel dimensions
if (isMobileSafari()) {
  const applyDimensions = () => {
    // Use visualViewport height if available (accounts for keyboard), otherwise fall back to innerHeight
    const w = Math.floor(window.visualViewport?.width || window.innerWidth);
    const h = Math.floor(window.visualViewport?.height || window.innerHeight);
    const props = ["width", "max-width", "height", "max-height"];
    const values = [w, w, h, h];

    [document.documentElement, document.body, document.getElementById("root")].forEach(el => {
      if (el) props.forEach((prop, i) => el.style.setProperty(prop, values[i] + "px", "important"));
    });

    // Counter iOS's automatic window scroll when keyboard appears
    if (window.scrollY !== 0) {
      window.scrollTo(0, 0);
    }
  };

  applyDimensions();
  window.visualViewport?.addEventListener("resize", applyDimensions);
  window.addEventListener("resize", applyDimensions);

  // Also prevent scrolling on the window itself
  window.addEventListener("scroll", () => {
    if (window.scrollY !== 0) {
      window.scrollTo(0, 0);
    }
  }, { passive: false });
}

(async () => {
  console.log("Initializing application");
  await init_bindings();
  await ready();
  createRoot(document.getElementById("root")!).render(<App />);
})();