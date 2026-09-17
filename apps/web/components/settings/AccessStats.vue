<script setup lang="ts">
import type { AccessStatsDTO } from '@glimmer/shared'
import {
  Activity,
  BarChart3,
  Database,
  HardDrive,
  ImageIcon,
  Info,
  RefreshCw,
  Server,
  TrendingUp,
} from 'lucide-vue-next'

const api = useApi()
const toast = useToast()

const stats = ref<AccessStatsDTO | null>(null)
const loading = ref(false)

const days = ref('30')
const DAY_OPTIONS = [
  { label: '近 7 天', value: '7' },
  { label: '近 30 天', value: '30' },
  { label: '近 90 天', value: '90' },
]

async function load(silent = false): Promise<void> {
  if (!silent) loading.value = true
  try {
    stats.value = await api.get<AccessStatsDTO>('/stats', {
      days: Number(days.value),
      scope: 'auto',
    })
  } catch (error) {
    toast.error('统计加载失败', (error as Error).message)
  } finally {
    loading.value = false
  }
}

watch(days, () => void load(true))
onMounted(() => void load())

/* ------------------------------ KPI ------------------------------ */

const kpis = computed(() => {
  const t = stats.value?.totals
  if (!t) return []
  return [
    { key: 'images', label: '图片总数', value: String(t.images), icon: ImageIcon, hint: `${t.accessedImages} 张被访问过` },
    { key: 'variants', label: '存储产物', value: String(t.variants), icon: Database, hint: '含多后端冗余副本' },
    { key: 'bytes', label: '占用体积', value: readableSize(t.bytes), icon: HardDrive, hint: '全部变体字节数' },
    { key: 'views', label: '直链访问', value: String(t.views), icon: Activity, hint: `窗口内累计` },
    { key: 'served', label: '出口流量', value: readableSize(t.bytesServed), icon: TrendingUp, hint: '直链回源字节' },
  ]
})

/* ------------------------------ 趋势图 ------------------------------ */

const CHART = { w: 640, h: 150, top: 10 }

const chart = computed(() => {
  const daily = stats.value?.daily ?? []
  const n = daily.length
  if (n === 0) return null

  const slot = CHART.w / n
  const barW = Math.min(slot * 0.58, 22)
  const usable = CHART.h - CHART.top
  const maxViews = Math.max(1, ...daily.map((d) => d.views))
  const maxBytes = Math.max(1, ...daily.map((d) => d.bytes))

  const bars = daily.map((d, i) => {
    const h = d.views === 0 ? 0 : Math.max(2, (d.views / maxViews) * usable)
    return {
      ...d,
      x: i * slot + (slot - barW) / 2,
      y: CHART.top + usable - h,
      w: barW,
      h,
      cx: i * slot + slot / 2,
      cy: CHART.top + usable - (d.bytes / maxBytes) * usable,
    }
  })

  // x 轴只标 4 个刻度，避免拥挤
  const ticks = n <= 4 ? bars.map((b, i) => ({ i, label: b.day.slice(5) })) : [0, Math.floor((n - 1) / 3), Math.floor(((n - 1) * 2) / 3), n - 1].map((i) => ({ i, label: bars[i]!.day.slice(5) }))

  return {
    bars,
    baseline: CHART.top + usable,
    bytesLine: bars.map((b) => `${b.cx.toFixed(1)},${b.cy.toFixed(1)}`).join(' '),
    ticks,
    maxViews,
    totalViews: daily.reduce((sum, d) => sum + d.views, 0),
    totalBytes: daily.reduce((sum, d) => sum + d.bytes, 0),
  }
})

const hasTraffic = computed(() => (chart.value?.totalViews ?? 0) > 0)

/* ------------------------------ 重试概况 ------------------------------ */

const retry = computed(() => stats.value?.retry ?? null)

const statusRows = computed(() => {
  const s = stats.value?.status
  if (!s) return []
  return [
    { label: '已就绪', value: s.ready, tone: 'success' as const },
    { label: '处理中', value: s.pending, tone: 'warning' as const },
    { label: '失败', value: s.failed, tone: 'destructive' as const },
  ]
})
</script>

<template>
  <div class="space-y-5">
    <!-- 概况 -->
    <AppCard
      title="访问统计"
      :description="
        stats?.scope === 'global'
          ? '全站口径：包含所有成员上传的图片。'
          : '个人口径：只统计你自己上传的图片。'
      "
    >
      <template #actions>
        <AppSegment v-model="days" :options="DAY_OPTIONS" size="sm" />
        <AppButton variant="ghost" size="icon-sm" :disabled="loading" @click="load()">
          <RefreshCw class="h-3.5 w-3.5" :class="loading && 'animate-spin'" />
        </AppButton>
      </template>

      <div v-if="loading && !stats" class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <AppSkeleton v-for="i in 6" :key="i" class="h-[68px] w-full" rounded="rounded-lg" />
      </div>

      <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div
          v-for="kpi in kpis"
          :key="kpi.key"
          class="rounded-lg border border-border/70 px-3.5 py-3 transition-colors duration-250 hover:border-border"
        >
          <div class="flex items-center gap-1.5 text-muted-foreground">
            <component :is="kpi.icon" class="h-3.5 w-3.5" />
            <p class="text-[11px]">{{ kpi.label }}</p>
          </div>
          <p class="mt-1.5 text-[19px] font-semibold tabular-nums tracking-tight text-foreground">
            {{ kpi.value }}
          </p>
          <p class="mt-0.5 truncate text-[10px] text-muted-foreground">{{ kpi.hint }}</p>
        </div>
      </div>

      <!-- 状态分布 -->
      <div v-if="stats" class="mt-4 flex flex-wrap items-center gap-2 border-t border-border/70 pt-4">
        <span
          v-for="row in statusRows"
          :key="row.label"
          class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
          :class="{
            'bg-success-soft text-success': row.tone === 'success',
            'bg-warning-soft text-warning': row.tone === 'warning',
            'bg-destructive-soft text-destructive': row.tone === 'destructive',
          }"
        >
          {{ row.label }}
          <span class="tabular-nums">{{ row.value }}</span>
        </span>
      </div>
    </AppCard>

    <!-- 访问趋势 -->
    <AppCard title="访问趋势" description="柱状为每日直链访问次数，虚线为每日出口流量（各自独立缩放）。">
      <template #actions>
        <span v-if="chart" class="text-[11px] tabular-nums text-muted-foreground">
          窗口内 {{ chart.totalViews }} 次 · {{ readableSize(chart.totalBytes) }}
        </span>
      </template>

      <div v-if="!chart" class="py-8">
        <AppEmpty compact icon="📈" title="暂无趋势数据" description="统计窗口内还没有任何直链访问。" />
      </div>

      <template v-else>
        <div class="gl-clip-rounded relative overflow-hidden rounded-lg">
          <svg
            :viewBox="`0 0 ${CHART.w} ${CHART.h}`"
            class="h-40 w-full"
            preserveAspectRatio="none"
            role="img"
            aria-label="每日访问趋势"
          >
            <!-- 基线 -->
            <line
              :x1="0"
              :y1="chart.baseline"
              :x2="CHART.w"
              :y2="chart.baseline"
              class="stroke-border"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
            />

            <!-- 访问量柱 -->
            <rect
              v-for="bar in chart.bars"
              :key="bar.day"
              :x="bar.x"
              :y="bar.y"
              :width="bar.w"
              :height="bar.h"
              rx="2"
              class="fill-primary"
              :opacity="hasTraffic ? 0.86 : 0.25"
            >
              <title>{{ bar.day }} · {{ bar.views }} 次 · {{ readableSize(bar.bytes) }}</title>
            </rect>

            <!-- 流量折线 -->
            <polyline
              v-if="hasTraffic"
              :points="chart.bytesLine"
              fill="none"
              class="stroke-muted-foreground"
              stroke-width="1.5"
              stroke-dasharray="5 4"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
          </svg>
        </div>

        <div class="mt-2 flex justify-between text-[10px] tabular-nums text-muted-foreground">
          <span v-for="tick in chart.ticks" :key="tick.i">{{ tick.label }}</span>
        </div>

        <p v-if="!hasTraffic" class="mt-3 rounded-lg bg-muted/50 px-3.5 py-2.5 text-[11px] text-muted-foreground">
          统计窗口内还没有直链访问记录。访问数据在每次请求直链时累计。
        </p>
      </template>
    </AppCard>

    <!-- 自动重试概况 -->
    <AppCard v-if="retry" title="失败与自动重试" description="后台调度器按指数退避自动重试失败的存储同步。">
      <div class="grid grid-cols-3 gap-3">
        <div class="rounded-lg border border-destructive/30 bg-destructive-soft/40 px-3.5 py-3">
          <p class="text-[11px] text-destructive">失败记录</p>
          <p class="mt-1 text-[19px] font-semibold tabular-nums text-destructive">{{ retry.failedRecords }}</p>
        </div>
        <div class="rounded-lg border border-warning/30 bg-warning-soft/40 px-3.5 py-3">
          <p class="text-[11px] text-warning">已排期</p>
          <p class="mt-1 text-[19px] font-semibold tabular-nums text-warning">{{ retry.scheduled }}</p>
        </div>
        <div class="rounded-lg border border-border/70 px-3.5 py-3">
          <p class="text-[11px] text-muted-foreground">配额耗尽</p>
          <p class="mt-1 text-[19px] font-semibold tabular-nums text-foreground">{{ retry.exhausted }}</p>
        </div>
      </div>

      <p v-if="retry.exhausted > 0" class="mt-3 flex items-start gap-2 text-[11px] text-muted-foreground">
        <Info class="mt-0.5 h-3 w-3 shrink-0" />
        <span>配额耗尽的记录不会再自动重试，可在图片详情中手动触发「重试失败同步」。</span>
      </p>
    </AppCard>

    <!-- 热门图片 -->
    <AppCard title="热门图片" description="按窗口内直链访问次数排序。">
      <div v-if="!stats || stats.topImages.length === 0" class="py-6">
        <AppEmpty compact icon="🔥" title="暂无访问记录" description="还没有图片被直链访问过。" />
      </div>

      <ul v-else class="space-y-1.5">
        <li
          v-for="(item, index) in stats.topImages"
          :key="item.id"
          class="flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors duration-250 hover:bg-muted/50"
        >
          <span
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums"
            :class="index === 0 ? 'bg-primary-soft text-accent-foreground' : 'bg-muted text-muted-foreground'"
          >
            {{ index + 1 }}
          </span>

          <div class="min-w-0 flex-1">
            <p class="truncate text-[12px] font-medium text-foreground">{{ item.filename }}</p>
            <p class="truncate text-[10px] text-muted-foreground">
              {{ item.username }}
              <template v-if="item.lastAccessAt"> · 最近 {{ relativeTime(item.lastAccessAt) }}</template>
            </p>
          </div>

          <div class="shrink-0 text-right">
            <p class="text-[12px] font-medium tabular-nums text-foreground">{{ item.views }} 次</p>
            <p class="text-[10px] tabular-nums text-muted-foreground">{{ readableSize(item.bytesServed) }}</p>
          </div>
        </li>
      </ul>
    </AppCard>

    <!-- 后端分布 -->
    <AppCard title="存储后端分布" description="各后端承载的存储记录与同步状态。">
      <div v-if="!stats || stats.backends.length === 0" class="py-6">
        <AppEmpty compact icon="🗄️" title="暂无后端数据" />
      </div>

      <ul v-else class="space-y-1.5">
        <li
          v-for="backend in stats.backends"
          :key="backend.backendId"
          class="flex items-center gap-3 rounded-lg border border-border/70 px-3.5 py-2.5"
        >
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Server class="h-3.5 w-3.5" />
          </span>

          <div class="min-w-0 flex-1">
            <p class="truncate text-[12px] font-medium text-foreground">{{ backend.name }}</p>
            <p class="text-[10px] uppercase text-muted-foreground">{{ backend.type }}</p>
          </div>

          <div class="flex shrink-0 items-center gap-3 text-[11px] tabular-nums">
            <span class="text-muted-foreground">{{ backend.records }} 条</span>
            <span v-if="backend.failed > 0" class="text-destructive">{{ backend.failed }} 失败</span>
            <span v-else class="text-success">{{ backend.ready }} 就绪</span>
            <span class="text-muted-foreground">{{ readableSize(backend.bytes) }}</span>
          </div>
        </li>
      </ul>
    </AppCard>

    <!-- 口径说明 -->
    <div class="flex items-start gap-2.5 rounded-lg bg-muted/50 px-3.5 py-3">
      <BarChart3 class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <p class="text-[11px] leading-relaxed text-muted-foreground">
        计数发生在后端返回本地存储文件时，按
        <span class="font-medium text-foreground">UTC 日</span>
        聚合。S3 / WebDAV 的直链由自有域名直出，Nginx 直服模式下的本地文件由 Nginx 直出，
        这两类请求都不经过本项目后端，因此不计入统计。
      </p>
    </div>
  </div>
</template>
