import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
      "/upload": { target: "http://localhost:5280", changeOrigin: true },
      "/ws": { target: "ws://localhost:5280", ws: true, changeOrigin: true },
    },
  },

  resolve: { dedupe: ["react", "react-dom"] },
  optimizeDeps: { include: ["react", "react-dom", "react/jsx-runtime", "framer-motion"] },
});
