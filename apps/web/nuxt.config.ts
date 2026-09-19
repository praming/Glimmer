import { EXT_TO_MIME } from '@glimmer/shared'
// 版本号唯一来源：仓库根 package.json
import pkg from '../../package.json'

/**
 * 「末段带图片扩展名」的正则，开发环境 devProxy 用它兜住**自定义**的直链前缀。
 * `^…$` 形式会被 Nuxt 当作正则而非路径前缀；扩展名取自 shared 的 `EXT_TO_MIME`，
 * 可避免两处各写一份而漂移。
 */
const IMAGE_PATH_RE = `^/.*\\.(?:${Object.keys(EXT_TO_MIME).join('|')})$`

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
      appVersion: pkg.version,
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
     * 仅开发环境生效：把 /api 与图片直链转发到本地 Hono API（3000）。
     * 生产环境由同源代理中间件负责（见 server/middleware/api-proxy.ts），Nuxt 不参与。
     *
     * 直链前缀是可配置的（默认 files，可改可留空），所以除了默认前缀那条，
     * 再用 IMAGE_PATH_RE 兜住自定义前缀；该正则若不被支持只会退化成「永不匹配」，
     * 不会破坏 `/files` 这条默认规则。图片规则的 target **不带路径**，
     * 原样保留 URL，交给 API 按当前前缀认领。
     */
    devProxy: {
      '/api': { target: 'http://127.0.0.1:3000/api', changeOrigin: true },
      '/files': { target: 'http://127.0.0.1:3000/files', changeOrigin: true },
      [IMAGE_PATH_RE]: { target: 'http://127.0.0.1:3000', changeOrigin: true },
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
