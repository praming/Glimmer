import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { hash as argonHash, verify as argonVerify, type Options as ArgonOptions } from '@node-rs/argon2'
import { env } from '../env'

/* ------------------------------------------------------------------ */
/* 密码哈希（Argon2id）                                                 */
/* ------------------------------------------------------------------ */

/**
 * OWASP 推荐参数：19 MiB 内存、2 次迭代、单通道。
 *
 * 注意：`@node-rs/argon2` 的 `Algorithm` 是 **ambient const enum**，
 * 在本项目的 `isolatedModules: true` 下不允许引用其成员（TS2748，
 * const enum 需要跨文件内联，与单文件转译冲突）。
 * 因此这里直接写枚举值 —— `Argon2id = 2` —— 并保留 `satisfies`，
 * 让编译器继续校验整个对象与 `Options` 的契约。
 */
const ARGON_OPTIONS = {
  algorithm: 2, // Algorithm.Argon2id
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} satisfies ArgonOptions

export function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTIONS)
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  if (!hash) return false
  try {
    return await argonVerify(hash, password, ARGON_OPTIONS)
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* 摘要与随机数                                                         */
/* ------------------------------------------------------------------ */

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

export function md5Hex(value: Buffer): string {
  return createHash('md5').update(value).digest('hex')
}

/** 32 字节 URL 安全随机 token */
export function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

/* ------------------------------------------------------------------ */
/* 敏感配置加解密（AES-256-GCM）                                         */
/* ------------------------------------------------------------------ */

/** 由 ENCRYPTION_KEY 派生 32 字节密钥 */
const encryptionKey = createHash('sha256').update(env.ENCRYPTION_KEY).digest()

const ENC_PREFIX = 'v1'

/**
 * 加密敏感字段（S3 Secret Key、WebDAV 密码）。
 * 输出格式：`v1:{iv}:{tag}:{ciphertext}`（各段 base64url）
 */
export function encryptSecret(plain: string): string {
  if (!plain) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    ENC_PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':')
}

/**
 * 解密敏感字段。若数据不是本模块产出的密文（例如历史明文），原样返回，
 * 保证升级路径平滑。
 */
export function decryptSecret(payload: string): string {
  if (!payload) return ''
  const parts = payload.split(':')
  if (parts.length !== 4 || parts[0] !== ENC_PREFIX) return payload
  try {
    const iv = Buffer.from(parts[1]!, 'base64url')
    const tag = Buffer.from(parts[2]!, 'base64url')
    const data = Buffer.from(parts[3]!, 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    return ''
  }
}
