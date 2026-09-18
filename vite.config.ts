import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/portfolio-26/',
  build: {
    target: 'es2020',
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        pv: resolve(__dirname, 'pv.html'),
        liveguard: resolve(__dirname, 'liveguard.html'),
        un: resolve(__dirname, 'un.html'),
        callie: resolve(__dirname, 'callie.html'),
        tempo: resolve(__dirname, 'tempo.html'),
        shapes: resolve(__dirname, 'shapes.html'),
      },
    },
  },
})
