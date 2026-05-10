import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// In-workspace dev consumes the library directly from source so edits in
// packages/slidewise/src reflect immediately without a build step. Published
// consumers go through the package's `exports` map and get dist/.
const libRoot = path.resolve(__dirname, "../packages/slidewise");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@textcortex/slidewise/style.css": path.resolve(
        libRoot,
        "src/SlidewiseEditor.css"
      ),
      "@textcortex/slidewise/fonts.css": path.resolve(libRoot, "src/fonts.css"),
      "@textcortex/slidewise": path.resolve(libRoot, "src/index.ts"),
      "@": path.resolve(libRoot, "src"),
    },
  },
  server: {
    port: 3303,
  },
});
