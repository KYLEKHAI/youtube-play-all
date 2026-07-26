import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import resolveChannelHandler from './api/resolve-channel.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-api-resolve-channel',
      configureServer(server) {
        server.middlewares.use('/api/resolve-channel', (request, response) => {
          resolveChannelHandler(request, response)
        })
      },
    },
  ],
})
