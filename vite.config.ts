import { defineConfig, loadEnv } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig(({ mode }) => {
  // expose server-only env (DATABASE_URL, secrets) to process.env in dev
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return {
    plugins: [tsconfigPaths(), tanstackStart(), viteReact()],
  }
})
