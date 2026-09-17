<script setup lang="ts">
import { Activity, Database, HardDrive, Server, Timer } from 'lucide-vue-next'

const store = useSettingsStore()

const rows = computed(() => {
  const runtime = store.runtime
  if (!runtime) return []
  return [
    { icon: Server, label: '运行环境', value: runtime.nodeEnv },
    { icon: Database, label: '数据库', value: runtime.database, mono: true },
    { icon: HardDrive, label: '本地存储目录', value: runtime.storageRoot, mono: true },
    { icon: Timer, label: '会话有效期', value: `${runtime.sessionTtlDays} 天` },
    { icon: Activity, label: '队列并发', value: String(runtime.queueConcurrency) },
  ]
})

const stats = computed(() => store.stats)
</script>

<template>
  <AppCard title="运行状态" description="进程级信息，只读。">
    <div v-if="!store.runtime" class="space-y-3">
      <AppSkeleton class="h-5 w-full" />
      <AppSkeleton class="h-5 w-full" />
      <AppSkeleton class="h-5 w-2/3" />
    </div>

    <div v-else class="space-y-5">
      <!-- 图片统计 -->
      <div v-if="stats" class="grid grid-cols-3 gap-3">
        <div class="rounded-lg border border-border/70 px-3.5 py-3">
          <p class="text-[11px] text-muted-foreground">已就绪</p>
          <p class="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {{ stats.images.ready }}
          </p>
        </div>
        <div class="rounded-lg border border-border/70 px-3.5 py-3">
          <p class="text-[11px] text-muted-foreground">处理中</p>
          <p class="mt-1 text-lg font-semibold tabular-nums text-warning">
            {{ stats.images.pending }}
          </p>
        </div>
        <div class="rounded-lg border border-border/70 px-3.5 py-3">
          <p class="text-[11px] text-muted-foreground">失败</p>
          <p class="mt-1 text-lg font-semibold tabular-nums text-destructive">
            {{ stats.images.failed }}
          </p>
        </div>
      </div>

      <!-- 队列 -->
      <div v-if="stats" class="rounded-lg bg-muted/50 px-3.5 py-3">
        <p class="text-[11px] font-medium text-muted-foreground">异步队列</p>
        <div class="mt-2 grid grid-cols-4 gap-3 text-[12px]">
          <span class="text-muted-foreground">等待 <b class="text-foreground">{{ stats.queue.waiting }}</b></span>
          <span class="text-muted-foreground">进行 <b class="text-foreground">{{ stats.queue.active }}</b></span>
          <span class="text-muted-foreground">完成 <b class="text-foreground">{{ stats.queue.completed }}</b></span>
          <span class="text-muted-foreground">失败 <b class="text-foreground">{{ stats.queue.failed }}</b></span>
        </div>
      </div>

      <!-- 环境信息 -->
      <dl class="divide-y divide-border/60">
        <div v-for="row in rows" :key="row.label" class="flex items-center gap-3 py-2.5">
          <component :is="row.icon" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <dt class="w-32 shrink-0 text-[12px] text-muted-foreground">{{ row.label }}</dt>
          <dd
            class="min-w-0 flex-1 truncate text-[12px] text-foreground"
            :class="row.mono && 'font-mono text-[11px]'"
            :title="row.value"
          >
            {{ row.value }}
          </dd>
        </div>
      </dl>
    </div>

    <template #actions>
      <AppButton variant="ghost" size="sm" :loading="store.loading" @click="store.load()">
        刷新
      </AppButton>
    </template>
  </AppCard>
</template>
