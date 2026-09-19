import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// constants.json (F19) lives at the repository root so the Python pipeline and
// the app read the very same file and can never drift. Vite needs explicit
// permission to serve it from outside the app root; it is a static import, so
// it is bundled into the build and works offline (C3).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { fs: { allow: ['..', '../..'] } },
})
