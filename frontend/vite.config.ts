import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // GitHub Pages serves the site from /<repo>/; everywhere else it is /.
  base: process.env.BASE_PATH ?? '/',
  server: {
    // The backend (FastAPI on :8000) is reached through the dev server, so the
    // browser only ever talks to one origin and no CORS setup is needed.
    proxy: { '/api': 'http://localhost:8000' },
  },
  test: {
    // Pure logic tests run in Node; component tests opt into jsdom with a
    // `// @vitest-environment jsdom` comment at the top of the file.
    environment: 'node',
  },
})
