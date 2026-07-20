import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Stamp the build time (≈ Netlify deploy time) and short commit into the bundle
// so the app can show "Last deployed …" and you always know which version of
// Caalano360 you're looking at. COMMIT_REF is provided by Netlify at build time.
export default defineConfig({
  plugins: [react()],
  base: '/',
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __COMMIT_REF__: JSON.stringify((process.env.COMMIT_REF || '').slice(0, 7)),
  },
})
