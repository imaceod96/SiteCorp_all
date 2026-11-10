import { defineConfig } from "vite";
import dyadComponentTagger from "@dyad-sh/react-vite-component-tagger";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const backendProxyTarget =
  process.env.VITE_BACKEND_PROXY_TARGET?.trim() || "http://127.0.0.1:4010";

export default defineConfig(() => ({
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true as const,
    proxy: {
      "/api": {
        target: backendProxyTarget,
        changeOrigin: true,
        secure: false,
      },
      "/health": {
        target: backendProxyTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true as const,
    proxy: {
      "/api": {
        target: backendProxyTarget,
        changeOrigin: true,
        secure: false,
      },
      "/health": {
        target: backendProxyTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  plugins: [dyadComponentTagger(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-dom/client", "next-themes", "sonner"],
  },
}));

