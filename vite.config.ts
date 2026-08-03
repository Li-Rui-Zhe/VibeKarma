import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/.cache/**",
        "**/.cargo-home/**",
        "**/.corepack/**",
        "**/.pnpm-store/**",
        "**/target/**",
      ],
    },
  },
  optimizeDeps: {
    entries: ["index.html"],
    noDiscovery: true,
    include: [
      "@tauri-apps/api/core",
      "@tauri-apps/api/event",
      "@tauri-apps/plugin-dialog",
      "lucide-react",
      "react",
      "react/jsx-dev-runtime",
      "react/jsx-runtime",
      "react-dom/client",
      "react-markdown",
      "react-pageflip",
    ],
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
