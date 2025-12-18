// Buffer shim MUST be first - Solana libraries need Buffer at module load time
import { Buffer } from 'buffer';
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./variables.css";  // Import CSS variables first to ensure they're available
import "./index.css";

// Ensure dark mode is applied in production before React mounts
if (typeof document !== 'undefined') {
  document.documentElement.classList.add('dark');
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
