import { defineConfig } from 'vite'

export default defineConfig({
  // Relative base so the built bundle can be dropped into a GitHub Pages
  // subpath (e.g. /portfolio/) without rewriting asset URLs.
  base: './',
  build: {
    target: 'es2020',
    // Case-study pages are their own documents, not routes in a SPA, so each
    // one has to be named here or the build ships only the home page. Paths are
    // resolved against Vite's root, so they stay relative.
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
