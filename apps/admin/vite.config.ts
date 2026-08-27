import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(() => {
  const apiTarget = process.env.VITE_DEV_API_TARGET || 'http://localhost:3000'
  const configuredBasePath = process.env.VITE_APP_BASE_PATH || '/'
  const appBasePath = `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/')

  return {
    base: appBasePath,
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
