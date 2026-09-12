import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/App";
import { Providers } from "@/components/providers";
import "@/index.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("#root is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
