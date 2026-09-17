export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',

  /**
   * 私有团队工具，无需 SEO 与首屏 SSR，
   * 采用 SPA 模式可彻底规避「服务端渲染时 Cookie / 内网 API 地址」的复杂性。
   */
  ssr: false,

  devtools: { enabled: false },

  modules: ['@nuxtjs/tailwindcss', '@pinia/nuxt'],

  pinia: {
    storesDirs: ['./stores/**'],
  },

  tailwindcss: {
    cssPath: '~/assets/css/main.css',
    configPath: 'tailwind.config.ts',
    viewer: false,
  },

  devServer: { port: 3001 },

  /** 组件按文件名自动导入，不带目录前缀（`components/ui/AppButton.vue` → `<AppButton />`） */
  components: [{ path: '~/components', pathPrefix: false }],

  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || '/api',
      appName: '浮光 · Glimmer',
      appVersion: '1.0.0',
    },
  },

  app: {
    head: {
      title: '浮光 · Glimmer',
      htmlAttrs: { lang: 'zh-CN' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#ffffff' },
        { name: 'description', content: '浮光掠影，一触即达。轻量团队图床。' },
        { name: 'format-detection', content: 'telephone=no' },
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
    pageTransition: { name: 'page', mode: 'out-in' },
    layoutTransition: { name: 'page', mode: 'out-in' },
  },

  nitro: {
    preset: 'node-server',
    /**
     * 仅开发环境生效：把 /api 与 /files 转发到本地 Hono API（3000）。
     * 生产环境由 Nginx 同源代理，Nuxt 不参与转发。
     */
    devProxy: {
      '/api': { target: 'http://127.0.0.1:3000/api', changeOrigin: true },
      '/files': { target: 'http://127.0.0.1:3000/files', changeOrigin: true },
    },
  },

  typescript: {
    strict: true,
    typeCheck: false,
    shim: false,
  },

  experimental: {
    payloadExtraction: false,
  },

  features: {
    inlineStyles: true,
  },
})
