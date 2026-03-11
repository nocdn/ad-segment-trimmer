import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig, loadEnv } from "vite"
import tsconfigPaths from "vite-tsconfig-paths"

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, resolve(process.cwd()), "")

  for (const [key, value] of Object.entries(rootEnv)) {
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }

  return {
    plugins: [
      devtools(),
      nitro({
        preset: "bun",
        rollupConfig: {
          external: [/^@sentry\//],
        },
      }),
      tsconfigPaths({ projects: ["./tsconfig.json"] }),
      tailwindcss(),
      tanstackStart(),
      react(),
    ],
  }
})
