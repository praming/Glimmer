/**
 * 全局登录守卫。
 * 未登录访问受保护页面 → 跳转 /login；已登录访问 /login → 回首页。
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useAuthStore()

  // 首次进入时等待会话恢复完成
  if (!auth.ready) {
    await auth.fetchMe()
  }

  const isPublic = to.meta.public === true

  if (!auth.user && !isPublic) {
    return navigateTo({ path: '/login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : undefined })
  }

  if (auth.user && to.path === '/login') {
    return navigateTo('/')
  }

  // 管理员页面二次校验
  if (to.meta.admin === true && auth.user?.role !== 'admin') {
    return navigateTo('/')
  }
})
