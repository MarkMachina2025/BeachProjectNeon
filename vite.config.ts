import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  resolve: {
    dedupe: ['three']
  },
  optimizeDeps: {
    include: [
      'three',
      'three/addons/loaders/GLTFLoader.js',
      'three/addons/utils/BufferGeometryUtils.js',
      'three-custom-shader-material/vanilla'
    ]
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/fable5.2 beach project/**', '**/gemini4neonbeachprojectfirstversion/**', '**/*.zip']
    }
  },
  build: {
    target: 'es2022',
    sourcemap: false
  }
});
