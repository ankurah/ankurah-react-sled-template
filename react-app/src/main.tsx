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

  // Show loading message
  const root = document.getElementById("root")!;
  root.innerHTML = `
    <style>
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      .spinner {
        width: 40px;
        height: 40px;
        border: 4px solid #f3f3f3;
        border-top: 4px solid #3498db;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 20px;
      }
    </style>
    <div style="display: flex; align-items: center; justify-content: center; height: 100vh; font-family: system-ui, -apple-system, sans-serif; color: #666;">
      <div style="text-align: center;">
        <div class="spinner"></div>
        <div style="font-size: 18px; margin-bottom: 8px;">Waiting for server...</div>
        <div style="font-size: 14px; color: #999;">Initializing connection</div>
      </div>
    </div>
  `;

  await init_bindings();
  await ready();

  // Clear loading message and render app
  createRoot(root).render(<App />);
})();