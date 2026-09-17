import type { Config } from 'tailwindcss'

/**
 * 浮光 / Glimmer —— 设计令牌
 * 采用 shadcn 风格的 CSS 变量映射，浅色为主、暗色可切换。
 */
export default {
  darkMode: 'class',
  content: [
    './app.vue',
    './error.vue',
    './assets/**/*.{css,scss}',
    './components/**/*.{vue,js,ts}',
    './composables/**/*.{js,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './plugins/**/*.{js,ts}',
    './utils/**/*.{js,ts}',
  ],
  theme: {
    container: {
      center: true,
      padding: '1.25rem',
      screens: { '2xl': '1440px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          soft: 'hsl(var(--primary-soft))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
          soft: 'hsl(var(--destructive-soft))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
          soft: 'hsl(var(--success-soft))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
          soft: 'hsl(var(--warning-soft))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar))',
          foreground: 'hsl(var(--sidebar-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          border: 'hsl(var(--sidebar-border))',
        },
      },
      borderRadius: {
        sm: 'calc(var(--radius) - 6px)',
        md: 'calc(var(--radius) - 3px)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 10px)',
      },
      fontFamily: {
        /**
         * 英文/数字字体排在前面：拉丁字形先命中它，
         * 中文字形因前者没有对应字模而自动落到后面的中文字体。
         * 两个变量由「个人偏好」写入，未设置时使用 var() 的回落值。
         */
        sans: [
          'var(--font-sans-en, Inter)',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'var(--font-sans-zh, "PingFang SC")',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Noto Sans SC"',
          'sans-serif',
        ],
        /**
         * 等宽栈同样以「英文与数字字体」打头 —— 这一点很关键：
         * 项目里复制链接、访问令牌、命名变量、预设字体名等都用 `font-mono` 呈现，
         * 如果这里固守硬编码字体族，它们就完全不受「个人偏好 → 字体」影响，
         * 用户看到的现象就是「字体设置只对一部分文字生效」。
         * 未设置时 `var()` 回落到 JetBrains Mono，行为与旧版一致。
         */
        mono: [
          'var(--font-sans-en, "JetBrains Mono")',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      boxShadow: {
        soft: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        card: '0 1px 3px 0 rgb(15 23 42 / 0.05), 0 8px 24px -12px rgb(15 23 42 / 0.12)',
        lift: '0 8px 32px -8px rgb(15 23 42 / 0.18), 0 2px 8px -4px rgb(15 23 42 / 0.08)',
        glow: '0 0 0 1px hsl(var(--primary) / 0.18), 0 12px 40px -12px hsl(var(--primary) / 0.45)',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.32, 0.72, 0, 1)',
        silk: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      transitionDuration: {
        250: '250ms',
        350: '350ms',
        450: '450ms',
        600: '600ms',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 320ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-up': 'fade-up 380ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'scale-in': 'scale-in 260ms cubic-bezier(0.32, 0.72, 0, 1) both',
        'slide-in-right': 'slide-in-right 320ms cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.6s infinite',
        float: 'float 5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config
