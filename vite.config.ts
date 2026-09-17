import { defineConfig } from 'vite'

export default defineConfig({
  // Relative base so the built bundle can be dropped into a GitHub Pages
  // subpath (e.g. /portfolio/) without rewriting asset URLs.
  base: 'portfolio-26',
  build: {
    target: 'es2020',
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: 'index.html',
        pv: 'pv.html',
        liveguard: 'liveguard.html',
        un: 'un.html',
        callie: 'callie.html',
        tempo: 'tempo.html',
      },
    },
  },
})
