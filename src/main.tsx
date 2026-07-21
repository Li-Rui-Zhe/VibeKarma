import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { OverlayApp } from "./OverlayApp";
import "./styles.css";

const isOverlay = new URLSearchParams(window.location.search).get("overlay") === "1";
document.documentElement.dataset.surface = isOverlay ? "overlay" : "main";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isOverlay ? <OverlayApp /> : <App />}
  </StrictMode>,
);
