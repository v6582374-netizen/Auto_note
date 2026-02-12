import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      input: {
        background: resolve(rootDir, "src/background/index.ts"),
        content: resolve(rootDir, "src/content/index.ts"),
        "manager/index": resolve(rootDir, "manager/index.html"),
        "options/index": resolve(rootDir, "options/index.html")
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "background" || chunk.name === "content") {
            return "[name].js";
          }
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
