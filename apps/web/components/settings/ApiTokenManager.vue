<script setup lang="ts">
import type { ApiTokenDTO, CreatedApiTokenDTO } from '@glimmer/shared'
import { AlertTriangle, Ban, Check, Copy, KeyRound, Plus, ShieldAlert, Trash2 } from 'lucide-vue-next'

const api = useApi()
const toast = useToast()
const confirm = useConfirm()

const tokens = ref<ApiTokenDTO[]>([])
const limit = ref(10)
const loading = ref(false)
const creating = ref(false)
const revokingId = ref('')
const purgingId = ref('')

/* ------------------------------ 新建 ------------------------------ */

const createOpen = ref(false)
const draft = reactive({ name: '', expiresInDays: '0' })
const createError = ref('')

const EXPIRES_OPTIONS = [
  { label: '永不过期', value: '0' },
  { label: '30 天', value: '30' },
  { label: '90 天', value: '90' },
  { label: '365 天', value: '365' },
]

/** 仅创建时返回一次，关闭后无法再取回 */
const freshToken = ref<CreatedApiTokenDTO | null>(null)
const copied = ref(false)

const activeCount = computed(() => tokens.value.filter((t) => t.active).length)
const reachLimit = computed(() => activeCount.value >= limit.value)

async function load(): Promise<void> {
  loading.value = true
  try {
    const data = await api.get<{ tokens: ApiTokenDTO[]; limit: number }>('/me/tokens')
    tokens.value = data.tokens
    limit.value = data.limit
  } catch (error) {
    toast.error('令牌列表加载失败', (error as Error).message)
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  draft.name = ''
  draft.expiresInDays = '0'
  createError.value = ''
  createOpen.value = true
}

async function submitCreate(): Promise<void> {
  const name = draft.name.trim()
  if (!name) {
    createError.value = '请填写用途备注，便于日后辨认'
    return
  }

  creating.value = true
  createError.value = ''
  try {
    const created = await api.post<CreatedApiTokenDTO>('/me/tokens', {
      name,
      expiresInDays: Number(draft.expiresInDays) || 0,
    })
    freshToken.value = created
    copied.value = false
    createOpen.value = false
    await load()
  } catch (error) {
    createError.value = (error as Error).message
  } finally {
    creating.value = false
  }
}

async function copyFresh(): Promise<void> {
  if (!freshToken.value) return
  copied.value = await copyText(freshToken.value.token)
  if (copied.value) toast.success('已复制到剪贴板', '请立即妥善保存')
}

function closeFresh(): void {
  freshToken.value = null
  copied.value = false
}

async function revoke(token: ApiTokenDTO): Promise<void> {
  const ok = await confirm.confirm({
    title: `撤销令牌「${token.name}」？`,
    description: '使用该令牌的脚本会立即失去访问权限，此操作不可恢复。',
    confirmText: '撤销',
    destructive: true,
  })
  if (!ok) return

  revokingId.value = token.id
  try {
    await api.del(`/me/tokens/${token.id}`)
    toast.success('令牌已撤销')
    await load()
  } catch (error) {
    toast.error('撤销失败', (error as Error).message)
  } finally {
    revokingId.value = ''
  }
}

/** 从列表中彻底删除记录（撤销只是让它失效，记录会一直留着） */
async function purge(token: ApiTokenDTO): Promise<void> {
  const ok = await confirm.confirm({
    title: `删除令牌「${token.name}」？`,
    description: '该记录将从列表中移除，无法恢复。已经失效的令牌不再有安全影响，删除只是让列表更清爽。',
    confirmText: '删除',
    destructive: true,
  })
  if (!ok) return

  purgingId.value = token.id
  try {
    await api.del(`/me/tokens/${token.id}?purge=1`)
    toast.success('令牌已删除')
    await load()
  } catch (error) {
    toast.error('删除失败', (error as Error).message)
  } finally {
    purgingId.value = ''
  }
}

/** 令牌状态：有效 / 已撤销 / 已过期 */
function stateOf(token: ApiTokenDTO): { label: string; variant: 'success' | 'muted' | 'destructive' } {
  if (token.revokedAt) return { label: '已撤销', variant: 'muted' }
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
    return { label: '已过期', variant: 'destructive' }
  }
  return { label: '有效', variant: 'success' }
}

onMounted(load)
</script>

<template>
  <AppCard
    title="访问令牌"
    description="供脚本 / CI / 第三方工具调用 API，无需在客户端保存账号密码。"
  >
    <template #actions>
      <AppButton size="sm" :disabled="reachLimit" @click="openCreate">
        <Plus class="h-3.5 w-3.5" />
        创建令牌
      </AppButton>
    </template>

    <!-- 用量提示 -->
    <div class="mb-4 flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3.5 py-2.5">
      <div class="flex items-center gap-2.5">
        <span class="flex h-7 w-7 items-center justify-center rounded-md bg-primary-soft text-accent-foreground">
          <KeyRound class="h-3.5 w-3.5" />
        </span>
        <p class="text-[11px] text-muted-foreground">
          已启用 <span class="font-medium tabular-nums text-foreground">{{ activeCount }}</span> /
          {{ limit }} 个令牌
        </p>
      </div>
      <p v-if="reachLimit" class="text-[11px] text-warning">已达上限，请先撤销不再使用的令牌</p>
    </div>

    <!-- 加载骨架 -->
    <div v-if="loading && tokens.length === 0" class="space-y-2">
      <AppSkeleton class="h-16 w-full" rounded="rounded-lg" />
      <AppSkeleton class="h-16 w-full" rounded="rounded-lg" />
    </div>

    <!-- 空状态 -->
    <div
      v-else-if="tokens.length === 0"
      class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center"
    >
      <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-lg">🔑</span>
      <p class="text-[13px] font-medium text-foreground">还没有访问令牌</p>
      <p class="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
        创建一个令牌后，即可用
        <code class="rounded bg-muted px-1 py-0.5 font-mono">Authorization: Bearer …</code>
        调用上传与查询接口。
      </p>
    </div>

    <!-- 令牌列表 -->
    <ul v-else class="space-y-2">
      <li
        v-for="token in tokens"
        :key="token.id"
        class="flex items-start gap-3 rounded-lg border border-border/70 px-3.5 py-3 transition-colors duration-250 hover:border-border"
      >
        <div class="min-w-0 flex-1 space-y-1.5">
          <div class="flex flex-wrap items-center gap-2">
            <p class="truncate text-[13px] font-medium text-foreground">{{ token.name }}</p>
            <AppBadge :variant="stateOf(token).variant" size="sm" dot>
              {{ stateOf(token).label }}
            </AppBadge>
          </div>

          <code class="block truncate font-mono text-[11px] text-muted-foreground">
            {{ token.prefix }}••••••••
          </code>

          <p class="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>创建于 {{ readableDate(token.createdAt) }}</span>
            <span>{{ token.expiresAt ? `过期于 ${readableDate(token.expiresAt)}` : '永不过期' }}</span>
            <span>
              {{ token.lastUsedAt ? `最近使用 ${relativeTime(token.lastUsedAt)}` : '尚未使用' }}
            </span>
          </p>
        </div>

        <div class="flex shrink-0 items-center gap-0.5">
          <!-- 仍然有效 → 撤销：立即失效，但保留记录便于回溯 -->
          <button
            v-if="token.active"
            type="button"
            class="gl-focus rounded-md p-1.5 text-muted-foreground transition-colors duration-200 hover:bg-warning-soft hover:text-warning disabled:opacity-50"
            title="撤销令牌（立即失效，记录保留在列表中）"
            :disabled="revokingId === token.id"
            @click="revoke(token)"
          >
            <Ban class="h-3.5 w-3.5" />
          </button>

          <!-- 删除：把这条记录从列表中彻底移除 -->
          <button
            type="button"
            class="gl-focus rounded-md p-1.5 text-muted-foreground transition-colors duration-200 hover:bg-destructive-soft hover:text-destructive disabled:opacity-50"
            :title="token.active ? '删除令牌（同样会立即失效，且不留记录）' : '删除这条令牌记录'"
            :disabled="purgingId === token.id"
            @click="purge(token)"
          >
            <Trash2 class="h-3.5 w-3.5" />
          </button>
        </div>
      </li>
    </ul>

    <!-- 创建弹窗 -->
    <AppModal v-model="createOpen" title="创建访问令牌" description="令牌明文仅在创建后显示一次。" size="sm">
      <div class="space-y-4">
        <AppInput v-model="draft.name" label="用途备注" placeholder="例如：PicGo / 博客同步脚本" required />
        <AppSelect
          v-model="draft.expiresInDays"
          :options="EXPIRES_OPTIONS"
          label="有效期"
          :placeholder-option="false"
        />

        <Transition name="pop">
          <p v-if="createError" class="rounded-lg bg-destructive-soft px-3 py-2 text-xs text-destructive">
            {{ createError }}
          </p>
        </Transition>
      </div>

      <template #footer>
        <AppButton variant="ghost" size="sm" @click="createOpen = false">取消</AppButton>
        <AppButton size="sm" :loading="creating" @click="submitCreate">
          <KeyRound class="h-3.5 w-3.5" />
          生成令牌
        </AppButton>
      </template>
    </AppModal>

    <!-- 明文一次性展示弹窗 -->
    <AppModal
      :model-value="Boolean(freshToken)"
      title="令牌已生成"
      description="请立即复制保存，关闭后将无法再次查看。"
      size="sm"
      @update:model-value="!$event && closeFresh()"
    >
      <div class="space-y-3.5">
        <div class="flex items-start gap-2.5 rounded-lg bg-warning-soft px-3.5 py-3 text-[11px] text-warning">
          <AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p class="leading-relaxed">
            服务端只保存令牌的 SHA-256 摘要，无法找回明文。若丢失，请撤销后重新创建。
          </p>
        </div>

        <div class="space-y-1.5">
          <p class="text-xs font-medium text-muted-foreground">{{ freshToken?.name }}</p>
          <code
            class="block break-all rounded-lg border border-border bg-muted px-3 py-2.5 font-mono text-[11px] leading-relaxed text-foreground"
          >
            {{ freshToken?.token }}
          </code>
        </div>

        <div class="rounded-lg bg-muted/50 px-3.5 py-2.5">
          <p class="text-[11px] text-muted-foreground">命令行调用示例</p>
          <code class="mt-1 block break-all font-mono text-[11px] text-foreground">
            curl -H "Authorization: Bearer {{ freshToken?.token.slice(0, 14) }}…" \
            {{ api.base }}/images
          </code>
        </div>
      </div>

      <template #footer>
        <AppButton variant="outline" size="sm" @click="copyFresh">
          <component :is="copied ? Check : Copy" class="h-3.5 w-3.5" />
          {{ copied ? '已复制' : '复制令牌' }}
        </AppButton>
        <AppButton size="sm" @click="closeFresh">我已保存</AppButton>
      </template>
    </AppModal>

    <!-- 安全提示 -->
    <div class="mt-4 flex items-start gap-2.5 border-t border-border/70 pt-4">
      <ShieldAlert class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <p class="text-[11px] leading-relaxed text-muted-foreground">
        令牌与你的账号权限完全等价。修改密码会自动撤销该账号名下所有令牌。
      </p>
    </div>
  </AppCard>
</template>
