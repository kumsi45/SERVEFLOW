import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  envPrefix: ["VITE_", "PUBLIC_"],
  define: {
    __SERVEFLOW_BUILD_ID__: JSON.stringify(new Date().toISOString()),
  },
});
