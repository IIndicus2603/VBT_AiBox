import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'
import path from 'path'

export default defineConfig({
  server: {
    watch: {
      // out* = electron-builder artifacts (file .tmp bi khoa) -> FSWatcher EBUSY crash
      ignored: ['**/out*/**', '**/dist/**', '**/dist-electron/**'],
    },
  },
  plugins: [
    electron({
      main: {
        entry: 'electron/main.ts',
        onstart({ reload }) {
          if (process.env.BROWSER_ONLY) return
          reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: { external: ['electron'] },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: { build: { outDir: 'dist-electron' } },
      },
    }),
  ],
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
