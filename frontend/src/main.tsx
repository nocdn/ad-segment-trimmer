import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App.tsx"

if (import.meta.env.DEV) {
  document.title = `${document.title} (dev)`
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
