/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const isLib = mode === "lib";

  return {
    plugins: isLib ? [react()] : [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 3303,
    },
    build: isLib
      ? {
          outDir: "dist",
          emptyOutDir: false,
          sourcemap: true,
          cssCodeSplit: false,
          lib: {
            entry: path.resolve(__dirname, "src/index.ts"),
            formats: ["es"],
            fileName: () => "index.mjs",
          },
          rollupOptions: {
            external: ["react", "react-dom", "react/jsx-runtime"],
            output: {
              assetFileNames: (asset) =>
                asset.name?.endsWith(".css") ? "caracas.css" : "assets/[name][extname]",
            },
          },
        }
      : {},
    test: {
      environment: "node",
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      globals: false,
    },
  };
});
