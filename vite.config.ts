import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite 选项参考: https://vitejs.dev/config/
  // Tauri 开发时防止 Vite 遮挡 Rust 错误
  clearScreen: false,

  // Tauri 使用固定的端口，开发时不要用随机端口
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // 监听 src-tauri 目录变化会触发大量重启，忽略它们
      ignored: ["**/src-tauri/**"],
    },
  },
}));
