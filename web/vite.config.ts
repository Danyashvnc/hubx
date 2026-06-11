import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },

  resolve: { dedupe: ["react", "react-dom"] },
  optimizeDeps: { include: ["react", "react-dom", "react/jsx-runtime", "framer-motion"] },
});
