import fs from 'node:fs'
import path from 'node:path'
import Database, { type Database as SqliteDatabase } from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { paths } from '../env'
import * as schema from './schema'

fs.mkdirSync(path.dirname(paths.database), { recursive: true })

/** 底层 better-sqlite3 连接（同步驱动，适合单进程 VPS 场景） */
export const sqlite: SqliteDatabase = new Database(paths.database)

sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')
sqlite.pragma('busy_timeout = 5000')
sqlite.pragma('synchronous = NORMAL')

export const db = drizzle(sqlite, { schema })

export type DB = typeof db
export { schema }
export * from './schema'
