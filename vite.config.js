import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Stamp the build time (≈ Netlify deploy time) and short commit into the bundle
// so the app can show "Last deployed …" and you always know which version of
// Caalano360 you're looking at. COMMIT_REF is provided by Netlify at build time.
export default defineConfig({
  plugins: [react()],
  base: '/',
  // jsPDF's html() path does a dynamic import of 'html2canvas'; the app renders
  // with html2canvas-pro (same API, a maintained fork), so point jsPDF at that
  // and ship one copy instead of two.
  resolve: { alias: { html2canvas: 'html2canvas-pro' } },
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __COMMIT_REF__: JSON.stringify((process.env.COMMIT_REF || '').slice(0, 7)),
  },
  build: {
    // Split the big, stable vendor libs into their own chunks. They change far
    // less often than the app code, so once a visitor has them cached a normal
    // deploy only re-downloads the (smaller) app chunk — much faster repeat
    // loads. Charts (recharts + d3) are the heaviest always-used dependency, so
    // they get their own chunk that loads in parallel with the app code.
    // jspdf / html2canvas / leaflet / aupostcodes stay lazy (dynamic import), so
    // they're intentionally NOT grouped here — they must load only on demand.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('recharts') || id.includes('/d3-') || id.includes('victory-vendor')) return 'charts'
          if (id.includes('react-dom') || id.includes('/scheduler/') || id.includes('/react/')) return 'react-vendor'
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
})
