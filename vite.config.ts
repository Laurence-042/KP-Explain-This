import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      onLog(level, log, handler) {
        if (log.code === 'INVALID_ANNOTATION') return
        handler(level, log)
      },
    },
  },
})
