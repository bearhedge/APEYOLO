import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Ensure dark mode is applied in production before React mounts
if (typeof document !== 'undefined') {
  document.documentElement.classList.add('dark');
}

createRoot(document.getElementById("root")!).render(<App />);
