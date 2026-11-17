import { createRouter, createWebHistory } from 'vue-router'

export const pages = [
  { path: '/', name: 'Overview', component: () => import('@/pages/Overview.vue') },
  { path: '/processes', name: 'Processes', component: () => import('@/pages/Processes.vue') },
  { path: '/startup', name: 'Startup apps', component: () => import('@/pages/Startup.vue') },
  { path: '/services', name: 'Services', component: () => import('@/pages/Services.vue') },
  { path: '/cleanup', name: 'Cleanup', component: () => import('@/pages/Cleanup.vue') },
  { path: '/disk', name: 'Disk', component: () => import('@/pages/Disk.vue') },
  { path: '/files', name: 'Files', component: () => import('@/pages/Files.vue') },
  { path: '/apps', name: 'Programs', component: () => import('@/pages/Apps.vue') },
  { path: '/ports', name: 'Ports', component: () => import('@/pages/Ports.vue') },
  { path: '/activity', name: 'Activity', component: () => import('@/pages/Activity.vue') },
  { path: '/settings', name: 'Settings', component: () => import('@/pages/Settings.vue') },
]

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('@/components/AppLayout.vue'), children: pages },
    { path: '/:rest(.*)*', redirect: '/' },
  ],
})

router.afterEach((to) => {
  document.title = to.name && to.name !== 'Overview' ? `${String(to.name)} · Balai` : 'Balai'
})
