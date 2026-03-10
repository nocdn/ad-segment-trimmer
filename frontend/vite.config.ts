import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig, loadEnv } from "vite"
import tsconfigPaths from "vite-tsconfig-paths"

export default defineConfig(({ mode }) => {
  const sharedEnv = loadEnv(mode, resolve(process.cwd(), ".."), "")
  const localEnv = loadEnv(mode, process.cwd(), "")

  for (const [key, value] of Object.entries({ ...sharedEnv, ...localEnv })) {
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }

  return {
    server: {
      port: 6030,
    },
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
