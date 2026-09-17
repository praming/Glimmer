import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Tailwind 类名合并（shadcn-vue 同款实现） */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
