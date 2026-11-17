<script setup lang="ts">
import { useColorMode } from '@vueuse/core'
import {
  AppWindowIcon, BrushCleaningIcon, CpuIcon, FileSearchIcon, HardDriveIcon, HistoryIcon, LayoutDashboardIcon,
  MoonIcon, NetworkIcon, PowerIcon, ServerCogIcon, SettingsIcon, SunIcon, Trash2Icon,
} from '@lucide/vue'
import { onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarRail, SidebarTrigger,
} from '@/components/ui/sidebar'
import { loadUpdateState, updateAvailable } from '@/composables/useSession'

const route = useRoute()
const mode = useColorMode()

const links = [
  { to: '/', label: 'Overview', icon: LayoutDashboardIcon },
  { to: '/processes', label: 'Processes', icon: CpuIcon },
  { to: '/startup', label: 'Startup apps', icon: PowerIcon },
  { to: '/services', label: 'Services', icon: ServerCogIcon },
  { to: '/cleanup', label: 'Cleanup', icon: Trash2Icon },
  { to: '/disk', label: 'Disk', icon: HardDriveIcon },
  { to: '/files', label: 'Files', icon: FileSearchIcon },
  { to: '/apps', label: 'Programs', icon: AppWindowIcon },
  { to: '/ports', label: 'Ports', icon: NetworkIcon },
  { to: '/activity', label: 'Activity', icon: HistoryIcon },
]

onMounted(loadUpdateState)
</script>

<template>
  <SidebarProvider>
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" as-child>
              <RouterLink to="/">
                <div class="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <BrushCleaningIcon class="size-4" />
                </div>
                <div class="grid flex-1 text-left leading-tight">
                  <span class="truncate font-semibold">Balai</span>
                  <span class="text-muted-foreground truncate text-xs">PC care</span>
                </div>
              </RouterLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="link in links" :key="link.to">
                <SidebarMenuButton as-child :is-active="route.path === link.to" :tooltip="link.label">
                  <RouterLink :to="link.to">
                    <component :is="link.icon" />
                    <span>{{ link.label }}</span>
                  </RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton as-child :is-active="route.path === '/settings'" tooltip="Settings">
              <RouterLink to="/settings">
                <SettingsIcon />
                <span>Settings</span>
              </RouterLink>
            </SidebarMenuButton>
            <SidebarMenuBadge v-if="updateAvailable">Update</SidebarMenuBadge>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>

    <SidebarInset>
      <header class="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger class="-ml-1" />
        <Separator orientation="vertical" class="mr-2 h-4! self-center!" />
        <h1 class="text-sm font-medium">{{ route.name }}</h1>
        <Button
          variant="ghost"
          size="icon"
          class="ml-auto"
          :aria-label="mode === 'dark' ? 'Use light theme' : 'Use dark theme'"
          @click="mode = mode === 'dark' ? 'light' : 'dark'"
        >
          <SunIcon v-if="mode === 'dark'" />
          <MoonIcon v-else />
        </Button>
      </header>
      <main class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4 md:p-6">
        <RouterView />
      </main>
    </SidebarInset>
  </SidebarProvider>
</template>
