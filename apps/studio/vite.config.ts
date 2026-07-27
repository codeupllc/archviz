import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@archviz/schema': path.resolve(__dirname, '../../packages/schema/src'),
      '@archviz/core': path.resolve(__dirname, '../../packages/core/src'),
      '@archviz/provider-aws': path.resolve(__dirname, '../../packages/provider-aws/src'),
      '@archviz/codegen': path.resolve(__dirname, '../../packages/codegen/src'),
    },
  },
  server: {
    port: 5173,
  },
});
