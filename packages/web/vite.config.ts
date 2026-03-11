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
      host: true,
      proxy: {
        // 开发时将 /api 请求转发到 bcc-server（pnpm bcc-server）
        '/bcc_server': {
          target: env.VITE_BASE_API_PROXY,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/bcc_server/, ''),
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
