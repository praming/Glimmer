import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
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
