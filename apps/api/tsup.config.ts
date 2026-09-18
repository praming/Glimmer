import { defineConfig } from 'tsup'

export default defineConfig({
  // 两个入口：服务器进程，以及维护用的密码重置 CLI
  // （产出 dist/index.js 与 dist/cli/reset-password.js，后者随镜像一起发布，
  //   供 `docker exec glimmer-api node apps/api/dist/cli/reset-password.js` 使用）
  entry: ['src/index.ts', 'src/cli/reset-password.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  // 原生模块与依赖保持外部引用，由 node_modules 提供
  external: [
    'better-sqlite3',
    'sharp',
    '@node-rs/argon2',
    '@aws-sdk/client-s3',
    'webdav',
    'p-queue',
    'drizzle-orm',
    'hono',
    '@hono/node-server',
    'dotenv',
    'zod',
    '@glimmer/shared',
  ],
  banner: {
    js: "import { createRequire as __glimmerCreateRequire } from 'node:module';\nconst require = __glimmerCreateRequire(import.meta.url);",
  },
})
