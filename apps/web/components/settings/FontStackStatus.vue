<script setup lang="ts">
import { AlertTriangle, Check } from 'lucide-vue-next'
import type { FontStackReport } from '~/composables/useFontAvailability'

/**
 * 字体可用性反馈条。
 *
 * 浏览器对「本机没有这个字体」的处理是**安静回落**，用户看到的界面毫无变化，
 * 很容易误判成「字体设置不起作用」。这里把实测结果直接摊开讲。
 */
const props = defineProps<{ report: FontStackReport }>()

type State = 'default' | 'ok' | 'missing-primary' | 'all-missing'

const state = computed<State>(() => {
  const entries = props.report.entries
  if (entries.length === 0) return 'default'
  if (entries[0]?.installed) return 'ok'
  return props.report.fellBack ? 'all-missing' : 'missing-primary'
})

const primary = computed(() => props.report.entries[0]?.name ?? '')
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-relaxed">
    <!-- 未自定义 -->
    <template v-if="state === 'default'">
      <span class="text-muted-foreground/80">未自定义 · 当前实际使用</span>
      <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
        {{ report.effective }}
      </code>
    </template>

    <!-- 第一个字体本机没有，但后面的命中了 -->
    <template v-else-if="state === 'missing-primary'">
      <AlertTriangle class="h-3 w-3 shrink-0 text-warning" />
      <span class="text-warning">「{{ primary }}」本机未安装</span>
      <span class="text-muted-foreground/80">· 实际使用</span>
      <code class="rounded bg-warning-soft px-1.5 py-0.5 font-mono text-[10px] text-warning">
        {{ report.effective }}
      </code>
    </template>

    <!-- 填了但一个都没命中 -->
    <template v-else-if="state === 'all-missing'">
      <AlertTriangle class="h-3 w-3 shrink-0 text-warning" />
      <span class="text-warning">所填字体本机均未安装 · 已回落到</span>
      <code class="rounded bg-warning-soft px-1.5 py-0.5 font-mono text-[10px] text-warning">
        {{ report.effective }}
      </code>
    </template>

    <!-- 全部命中 -->
    <template v-else>
      <Check class="h-3 w-3 shrink-0 text-success" />
      <span class="text-muted-foreground/80">本机已安装 · 实际使用</span>
      <code class="rounded bg-success-soft px-1.5 py-0.5 font-mono text-[10px] text-success">
        {{ report.effective }}
      </code>
    </template>
  </div>
</template>
