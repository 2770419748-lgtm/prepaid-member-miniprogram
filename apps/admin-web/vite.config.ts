import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    // 组件库单独成块，业务页面改动时浏览器缓存仍可复用。
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia', 'axios', 'dayjs'],
          antd: ['ant-design-vue', '@ant-design/icons-vue'],
        },
      },
    },
    chunkSizeWarningLimit: 1600,
  },
});
