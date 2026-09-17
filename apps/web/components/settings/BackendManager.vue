<script setup lang="ts">
import { SECRET_PLACEHOLDER, STORAGE_BACKEND_LABEL } from '@glimmer/shared'
import type { BackendConfig, StorageBackend } from '@glimmer/shared'
import { CheckCircle2, Cloud, HardDrive, Pencil, Plus, Server, Trash2, XCircle, Zap } from 'lucide-vue-next'
import type { Component } from 'vue'

const store = useSettingsStore()
const confirm = useConfirm()
const toast = useToast()

const ICONS: Record<StorageBackend, Component> = {
  local: HardDrive,
  s3: Cloud,
  webdav: Server,
}

const draftList = ref<BackendConfig[]>([])
const dirty = ref(false)

watch(
  () => store.settings?.backends,
  (value) => {
    draftList.value = value ? (JSON.parse(JSON.stringify(value)) as BackendConfig[]) : []
    dirty.value = false
  },
  { immediate: true, deep: true },
)

/* ------------------------------------------------------------------ */
/* 新增 / 编辑弹窗                                                      */
/* ------------------------------------------------------------------ */

const editorOpen = ref(false)
const editingIndex = ref(-1)
const draft = ref<BackendConfig | null>(null)
const testing = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)

function blankBackend(type: StorageBackend): BackendConfig {
  const stamp = Date.now().toString(36).slice(-4)
  const base = {
    id: `${type}-${stamp}`,
    name: STORAGE_BACKEND_LABEL[type],
    enabled: true,
    publicBaseUrl: '',
    pathPrefix: '',
  }

  if (type === 's3') {
    return {
      ...base,
      type: 's3',
      endpoint: '',
      region: 'auto',
      bucket: '',
      accessKeyId: '',
      secretAccessKey: '',
      forcePathStyle: false,
    }
  }

  if (type === 'webdav') {
    return { ...base, type: 'webdav', url: '', username: '', password: '', directory: '' }
  }

  return { ...base, type: 'local', directory: '' }
}

function openCreate(type: StorageBackend): void {
  draft.value = blankBackend(type)
  editingIndex.value = -1
  testResult.value = null
  editorOpen.value = true
}

function openEdit(index: number): void {
  const target = draftList.value[index]
  if (!target) return
  draft.value = JSON.parse(JSON.stringify(target)) as BackendConfig
  editingIndex.value = index
  testResult.value = null
  editorOpen.value = true
}

function commitDraft(): void {
  if (!draft.value) return
  const value = draft.value

  if (!value.name.trim()) {
    toast.warning('请填写后端名称')
    return
  }

  const duplicatedId = draftList.value.some(
    (item, index) => item.id === value.id && index !== editingIndex.value,
  )
  if (duplicatedId) {
    toast.warning('后端 ID 重复，请换一个')
    return
  }

  if (editingIndex.value >= 0) {
    draftList.value[editingIndex.value] = value
  } else {
    draftList.value.push(value)
  }

  dirty.value = true
  editorOpen.value = false
}

async function removeBackend(index: number): Promise<void> {
  const target = draftList.value[index]
  if (!target) return

  const ok = await confirm.confirm({
    title: `移除后端「${target.name}」？`,
    description: '保存后该后端将不再接收新上传；已存在的文件不会被自动删除。',
    confirmText: '移除',
    destructive: true,
  })
  if (!ok) return

  draftList.value.splice(index, 1)
  dirty.value = true
}

async function testDraft(): Promise<void> {
  if (!draft.value) return
  testing.value = true
  testResult.value = null
  testResult.value = await store.testBackend(draft.value)
  testing.value = false
}

async function saveAll(): Promise<void> {
  const saved = await store.save({ backends: draftList.value })
  if (saved) dirty.value = false
}
</script>

<template>
  <div class="space-y-4">
    <AppCard
      title="存储后端"
      description="每张图片会并行写入所有选中的后端；任一后端失败不影响其他后端。"
    >
      <template #actions>
        <AppDropdown align="end" width="w-48">
          <template #trigger>
            <AppButton variant="outline" size="sm">
              <Plus class="h-3.5 w-3.5" />
              添加后端
            </AppButton>
          </template>
          <template #default="{ close }">
            <AppMenuItem v-for="type in (['local', 's3', 'webdav'] as StorageBackend[])" :key="type" @click="openCreate(type); close()">
              <component :is="ICONS[type]" class="h-4 w-4" />
              {{ STORAGE_BACKEND_LABEL[type] }}
            </AppMenuItem>
          </template>
        </AppDropdown>
      </template>

      <div v-if="draftList.length === 0" class="py-6 text-center text-xs text-muted-foreground">
        还没有配置存储后端。
      </div>

      <ul v-else class="space-y-2.5">
        <li
          v-for="(backend, index) in draftList"
          :key="backend.id"
          class="flex items-center gap-3 rounded-lg border border-border/70 px-3.5 py-3 transition-colors duration-250 hover:bg-muted/30"
        >
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-accent-foreground">
            <component :is="ICONS[backend.type]" class="h-4 w-4" />
          </span>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="truncate text-[13px] font-medium text-foreground">{{ backend.name }}</p>
              <AppBadge :variant="backend.enabled ? 'success' : 'muted'" size="sm">
                {{ backend.enabled ? '已启用' : '已禁用' }}
              </AppBadge>
            </div>
            <p class="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
              {{ backend.type }}
              <template v-if="backend.type === 's3'"> · {{ backend.bucket || '未设置 Bucket' }} · {{ backend.endpoint || 'AWS 默认' }}</template>
              <template v-if="backend.type === 'webdav'"> · {{ backend.url || '未设置地址' }}</template>
              <template v-if="backend.type === 'local'"> · {{ backend.directory || '默认 LOCAL_STORAGE_DIR' }}</template>
            </p>
          </div>

          <div class="flex shrink-0 items-center gap-1">
            <AppButton variant="ghost" size="icon-sm" title="编辑" @click="openEdit(index)">
              <Pencil class="h-3.5 w-3.5" />
            </AppButton>
            <AppButton variant="ghost" size="icon-sm" title="移除" @click="removeBackend(index)">
              <Trash2 class="h-3.5 w-3.5 text-destructive" />
            </AppButton>
          </div>
        </li>
      </ul>

      <template #footer>
        <div class="flex items-center justify-between gap-3">
          <p class="text-[11px] text-muted-foreground">
            {{ dirty ? '有未保存的改动' : '配置已同步' }}
          </p>
          <AppButton size="sm" :loading="store.saving" :disabled="!dirty" @click="saveAll">
            保存后端配置
          </AppButton>
        </div>
      </template>
    </AppCard>

    <!-- 编辑弹窗 -->
    <AppModal
      v-model="editorOpen"
      :title="editingIndex >= 0 ? '编辑存储后端' : '添加存储后端'"
      :size="'lg'"
    >
      <div v-if="draft" class="space-y-4">
        <div class="grid gap-3.5 sm:grid-cols-2">
          <AppInput v-model="draft.name" label="显示名称" required placeholder="如：Cloudflare R2" />
          <AppInput
            v-model="draft.id"
            label="后端 ID"
            required
            mono
            hint="用于数据库标识，建议小写字母与连字符"
            :readonly="editingIndex >= 0"
          />
        </div>

        <div class="grid gap-3.5 sm:grid-cols-2">
          <AppInput
            v-model="draft.publicBaseUrl"
            label="访问域名（publicBaseUrl）"
            placeholder="留空则使用全局域名"
          />
          <AppInput v-model="draft.pathPrefix" label="路径前缀" placeholder="如 images/2026" />
        </div>

        <!-- 本地 -->
        <template v-if="draft.type === 'local'">
          <AppInput
            v-model="draft.directory"
            label="存储目录"
            mono
            placeholder="留空则使用 LOCAL_STORAGE_DIR"
          />
        </template>

        <!-- S3 -->
        <template v-else-if="draft.type === 's3'">
          <div class="grid gap-3.5 sm:grid-cols-2">
            <AppInput v-model="draft.endpoint" label="Endpoint" mono placeholder="https://xxx.r2.cloudflarestorage.com" />
            <AppInput v-model="draft.region" label="Region" mono placeholder="auto / us-east-1" />
            <AppInput v-model="draft.bucket" label="Bucket" mono required />
            <AppInput v-model="draft.accessKeyId" label="Access Key ID" mono />
          </div>

          <AppInput
            v-model="draft.secretAccessKey"
            label="Secret Access Key"
            mono
            :type="draft.secretAccessKey === SECRET_PLACEHOLDER ? 'text' : 'password'"
            :hint="draft.secretAccessKey === SECRET_PLACEHOLDER ? '已保存的密钥，留空或保持原值即不修改' : '将使用 ENCRYPTION_KEY 加密后存库'"
          />

          <AppSwitch
            v-model="draft.forcePathStyle"
            label="使用 Path-Style 访问"
            description="MinIO、部分自建 S3 服务需要开启；Cloudflare R2 通常不需要。"
          />
        </template>

        <!-- WebDAV -->
        <template v-else>
          <AppInput v-model="draft.url" label="服务地址" mono required placeholder="https://dav.jianguoyun.com/dav/" />
          <div class="grid gap-3.5 sm:grid-cols-2">
            <AppInput v-model="draft.username" label="用户名" />
            <AppInput
              v-model="draft.password"
              label="密码 / 应用密码"
              type="password"
              :hint="draft.password === SECRET_PLACEHOLDER ? '已保存的密码，留空即不修改' : undefined"
            />
          </div>
          <AppInput v-model="draft.directory" label="远端子目录" placeholder="如 glimmer" />
        </template>

        <div class="border-t border-border/70 pt-4">
          <AppSwitch v-model="draft.enabled" label="启用该后端" description="禁用后不再接收新上传，但已存文件保留。" />
        </div>

        <Transition name="pop">
          <div
            v-if="testResult"
            class="flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-xs"
            :class="testResult.ok ? 'bg-success-soft text-success' : 'bg-destructive-soft text-destructive'"
          >
            <component :is="testResult.ok ? CheckCircle2 : XCircle" class="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span class="break-all">{{ testResult.message }}</span>
          </div>
        </Transition>
      </div>

      <template #footer>
        <AppButton variant="outline" size="sm" :loading="testing" @click="testDraft">
          <Zap class="h-3.5 w-3.5" />
          测试连接
        </AppButton>
        <AppButton size="sm" @click="commitDraft">确定</AppButton>
      </template>
    </AppModal>
  </div>
</template>
