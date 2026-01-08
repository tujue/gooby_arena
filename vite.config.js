import { defineConfig } from 'vite';

export default defineConfig({
    optimizeDeps: {
        esbuildOptions: {
            sourcemap: false,
        },
    },
    css: {
        devSourcemap: false,
    },
    build: {
        sourcemap: false,
        minify: 'esbuild', // Faster than terser, built-in
        target: 'es2015',
        rollupOptions: {
            output: {
                manualChunks: {
                    'vendor': ['socket.io-client', 'peerjs']
                }
            }
        }
    },
    esbuild: {
        drop: ['console', 'debugger'], // Remove console.log & debugger in production
    },
    server: {
        hmr: {
            overlay: false
        }
    }
});
