<script setup lang="ts">
import { EllipsisIcon, SearchIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import LoadError from '@/components/LoadError.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useResource } from '@/composables/useResource'
import { messageOf, post } from '@/lib/api'
import type { ActionResult, ServiceInfo } from '@/lib/types'

type Action = 'start' | 'stop' | 'restart' | 'automatic' | 'manual' | 'disabled'

const { data, error, refresh } = useResource<ServiceInfo[]>('/services', 15_000)
const search = ref('')
const filter = ref('running')
const busy = ref('')
const pending = ref<{ service: ServiceInfo; action: Action } | null>(null)

const counts = computed(() => ({
  running: data.value?.filter((item) => item.state === 'Running').length ?? 0,
  stopped: data.value?.filter((item) => item.state === 'Stopped').length ?? 0,
}))

const visible = computed(() => {
  const term = search.value.trim().toLowerCase()
  return (data.value ?? []).filter((item) => {
    if (filter.value === 'running' && item.state !== 'Running') return false
    if (filter.value === 'stopped' && item.state !== 'Stopped') return false
    if (filter.value === 'disabled' && item.start !== 'Disabled') return false
    return (
      !term ||
      item.name.toLowerCase().includes(term) ||
      item.display.toLowerCase().includes(term) ||
      item.description.toLowerCase().includes(term)
    )
  })
})

const START: Record<string, string> = { Auto: 'Automatic', Manual: 'Manual', Disabled: 'Disabled', Boot: 'Boot', System: 'System' }
const startLabel = (item: ServiceInfo) => `${START[item.start] ?? item.start}${item.delayed ? ', delayed' : ''}`

const REMOTE = /^(TermService|sshd|WinRM|RemoteRegistry|SessionEnv|UmRdpService)$/i
const PROTECTION = /^(WinDefend|mpssvc|wscsvc|SecurityHealthService|Sense|BFE|wuauserv|UsoSvc)$/i

const CONFIRM: Record<Action, { verb: string; text: string; destructive?: boolean }> = {
  start: { verb: 'Start', text: 'The service starts now.' },
  stop: {
    verb: 'Stop',
    text: 'The service stops now. Programs and features that use it stop working until it is started again or the computer restarts.',
    destructive: true,
  },
  restart: { verb: 'Restart', text: 'The service stops and starts again. What it was doing is interrupted.' },
  automatic: { verb: 'Set to automatic', text: 'The service will start by itself every time Windows starts.' },
  manual: { verb: 'Set to manual', text: 'The service will only start when a program or Windows asks for it.' },
  disabled: {
    verb: 'Disable',
    text: 'The service will not start at all, even when a program needs it. It keeps running until it is stopped or the computer restarts.',
    destructive: true,
  },
}

const warning = computed(() => {
  const target = pending.value
  if (!target || !['stop', 'disabled'].includes(target.action)) return ''
  if (REMOTE.test(target.service.name)) return 'This service lets people connect to this computer remotely. Remote sessions will be cut.'
  if (PROTECTION.test(target.service.name)) return 'This service protects or updates Windows. Turning it off leaves the computer less safe.'
  return ''
})

async function act(service: ServiceInfo, action: Action) {
  pending.value = null
  busy.value = service.name
  try {
    const result = await post<ActionResult>(`/services/${encodeURIComponent(service.name)}/${action}`)
    toast.success(result.message)
  } catch (failure) {
    toast.error(messageOf(failure))
  }
  await refresh()
  busy.value = ''
}
</script>

<template>
  <LoadError :message="error" />

  <div class="flex flex-wrap items-center gap-2">
    <div class="relative w-full max-w-sm">
      <SearchIcon class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
      <Input v-model="search" class="pl-8" placeholder="Filter services" aria-label="Filter services" />
    </div>
    <Tabs v-model="filter">
      <TabsList>
        <TabsTrigger value="running">Running {{ counts.running }}</TabsTrigger>
        <TabsTrigger value="stopped">Stopped {{ counts.stopped }}</TabsTrigger>
        <TabsTrigger value="disabled">Disabled</TabsTrigger>
        <TabsTrigger value="all">All</TabsTrigger>
      </TabsList>
    </Tabs>
  </div>

  <Card class="py-0">
    <CardContent class="px-0">
      <Table v-if="data">
        <TableHeader>
          <TableRow>
            <TableHead class="pl-4">Service</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Startup</TableHead>
            <TableHead class="w-10 pr-4"><span class="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="item in visible" :key="item.name">
            <TableCell class="w-full max-w-0 pl-4">
              <p class="truncate font-medium">{{ item.display }}</p>
              <p class="text-muted-foreground truncate text-xs" :title="item.description">
                {{ item.name }}<template v-if="item.description"> · {{ item.description }}</template>
              </p>
            </TableCell>
            <TableCell>
              <StatusBadge :tone="item.state === 'Running' ? 'good' : 'idle'">{{ item.state }}</StatusBadge>
            </TableCell>
            <TableCell class="text-muted-foreground whitespace-nowrap">{{ startLabel(item) }}</TableCell>
            <TableCell class="pr-4">
              <Spinner v-if="busy === item.name" class="mx-auto" />
              <DropdownMenu v-else>
                <DropdownMenuTrigger as-child>
                  <Button variant="ghost" size="icon-sm" :aria-label="`Actions for ${item.display}`">
                    <EllipsisIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem v-if="item.state !== 'Running'" :disabled="item.start === 'Disabled'" @select="pending = { service: item, action: 'start' }">
                    Start
                  </DropdownMenuItem>
                  <DropdownMenuItem v-if="item.state === 'Running'" @select="pending = { service: item, action: 'restart' }">Restart</DropdownMenuItem>
                  <DropdownMenuItem v-if="item.state === 'Running'" @select="pending = { service: item, action: 'stop' }">Stop</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Startup type</DropdownMenuLabel>
                  <DropdownMenuItem :disabled="item.start === 'Auto'" @select="pending = { service: item, action: 'automatic' }">Automatic</DropdownMenuItem>
                  <DropdownMenuItem :disabled="item.start === 'Manual'" @select="pending = { service: item, action: 'manual' }">Manual</DropdownMenuItem>
                  <DropdownMenuItem
                    :disabled="item.start === 'Disabled'"
                    variant="destructive"
                    @select="pending = { service: item, action: 'disabled' }"
                  >
                    Disabled
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
          <TableEmpty v-if="!visible.length" :colspan="4">No service matches.</TableEmpty>
        </TableBody>
      </Table>
      <div v-else class="flex flex-col gap-2 p-4">
        <Skeleton v-for="index in 8" :key="index" class="h-10" />
      </div>
    </CardContent>
  </Card>

  <AlertDialog :open="!!pending" @update:open="(open: boolean) => { if (!open) pending = null }">
    <AlertDialogContent v-if="pending">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ CONFIRM[pending.action].verb }}: {{ pending.service.display }}?</AlertDialogTitle>
        <AlertDialogDescription>
          {{ CONFIRM[pending.action].text }}
          <template v-if="warning"> {{ warning }}</template>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          :variant="CONFIRM[pending.action].destructive ? 'destructive' : 'default'"
          @click="act(pending.service, pending.action)"
        >
          {{ CONFIRM[pending.action].verb }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
