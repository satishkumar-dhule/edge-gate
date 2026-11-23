import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  const disableHmr =
    process.env.DISABLE_HMR === 'true' ||
    Boolean(process.env.CONTROL_PLANE_PORT || process.env.K_SERVICE);

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    optimizeDeps: {
      entries: ['index.html'],
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        '@monaco-editor/react',
        'monaco-editor/editor',
        '@xterm/xterm',
        '@xterm/addon-fit',
      ],
      exclude: ['echarts'],
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      // HMR is disabled in AI Studio via DISABLE_HMR env var or sandbox control plane.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: !disableHmr,
      // Disable file watching when HMR is disabled to save CPU/RAM during startup & edits.
      watch: disableHmr ? null : {},
    },
  };
});
