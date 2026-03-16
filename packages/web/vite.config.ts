import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 5173,
      cors: true,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      proxy: {
        // SSE 长连接单独配置：禁用缓冲、不超时
        '/api/events': {
          target: env.VITE_BASE_API_PROXY,
          changeOrigin: true,
          secure: false,
        },
        '/api': {
          target: env.VITE_BASE_API_PROXY,
          changeOrigin: true,
          secure: false,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              console.log('代理转发:', req.url, '->', proxyReq.getHeader('host'))
            })
          }
        },
      },
    },
  }
});
