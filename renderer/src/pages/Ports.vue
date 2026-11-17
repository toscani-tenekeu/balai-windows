<script setup lang="ts">
import { EllipsisIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import LoadError from '@/components/LoadError.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useResource } from '@/composables/useResource'
import { messageOf, post } from '@/lib/api'
import type { ActionResult, Listener } from '@/lib/types'

type Action = 'restart-service' | 'stop-service' | 'kill'

const { data, error, refresh } = useResource<Listener[]>('/ports', 15_000)
const protocol = ref('tcp')
const pending = ref<{ listener: Listener; action: Action } | null>(null)

const visible = computed(() => (data.value ?? []).filter((item) => item.protocol === protocol.value))
const single = (item: Listener) => (item.services.length === 1 ? item.services[0]! : null)
const windowsOwned = (item: Listener) => item.pid <= 4 || (item.process === 'svchost' && item.services.length !== 1)

const dialog = computed(() => {
  const target = pending.value
  if (!target) return null
  const { listener, action } = target
  const service = single(listener)
  if (action === 'restart-service') {
    return { title: `Restart ${service}?`, text: `Port ${listener.port} closes for a moment and opens again. Open connections are dropped.`, verb: 'Restart', destructive: false }
  }
  if (action === 'stop-service') {
    return { title: `Stop ${service}?`, text: `Port ${listener.port} closes until the service starts again, at the latest when the computer restarts.`, verb: 'Stop service', destructive: true }
  }
  return {
    title: `End ${listener.process || `process ${listener.pid}`}?`,
    text: `Port ${listener.port} closes at once. The program is ended without saving its work.${service ? ' Windows may start its service again.' : ''}`,
    verb: 'End task',
    destructive: true,
  }
})

async function confirm() {
  const target = pending.value
  if (!target) return
  pending.value = null
  const { listener, action } = target
  const service = single(listener)
  const path =
    action === 'kill' ? `/processes/${listener.pid}/kill` : `/services/${encodeURIComponent(service!)}/${action === 'stop-service' ? 'stop' : 'restart'}`
  try {
    const result = await post<ActionResult>(path)
    toast.success(result.message)
  } catch (failure) {
    toast.error(messageOf(failure))
  }
  setTimeout(() => void refresh(), 800)
}
</script>

<template>
  <LoadError :message="error" />

  <Card>
    <CardHeader>
      <CardTitle>Open ports</CardTitle>
      <CardDescription>
        Programs waiting for connections. “Reachable” means other devices can connect unless Windows Firewall blocks it.
        To close a port, stop the program or service behind it.
      </CardDescription>
      <CardAction>
        <Tabs v-model="protocol">
          <TabsList>
            <TabsTrigger value="tcp">TCP</TabsTrigger>
            <TabsTrigger value="udp">UDP</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardAction>
    </CardHeader>
    <CardContent>
      <Table v-if="data">
        <TableHeader>
          <TableRow>
            <TableHead>Port</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>Program</TableHead>
            <TableHead>Exposure</TableHead>
            <TableHead class="w-10"><span class="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="item in visible" :key="`${item.protocol}-${item.address}-${item.port}`">
            <TableCell class="font-medium tabular-nums">{{ item.port }}</TableCell>
            <TableCell class="font-mono text-xs">{{ item.address }}</TableCell>
            <TableCell class="max-w-72">
              <p class="truncate">
                {{ item.process || 'Unknown' }} <span class="text-muted-foreground text-xs">({{ item.pid }})</span>
              </p>
              <p v-if="item.services.length" class="text-muted-foreground truncate text-xs" :title="item.services.join(', ')">
                {{ item.services.join(', ') }}
              </p>
            </TableCell>
            <TableCell>
              <StatusBadge :tone="item.public ? 'good' : 'idle'">{{ item.public ? 'Reachable' : 'This computer only' }}</StatusBadge>
            </TableCell>
            <TableCell>
              <DropdownMenu v-if="!windowsOwned(item)">
                <DropdownMenuTrigger as-child>
                  <Button variant="ghost" size="icon-sm" :aria-label="`Actions for port ${item.port}`">
                    <EllipsisIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <template v-if="single(item)">
                    <DropdownMenuItem @select="pending = { listener: item, action: 'restart-service' }">Restart service</DropdownMenuItem>
                    <DropdownMenuItem @select="pending = { listener: item, action: 'stop-service' }">Stop service</DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </template>
                  <DropdownMenuItem variant="destructive" @select="pending = { listener: item, action: 'kill' }">End task</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
          <TableEmpty v-if="!visible.length" :colspan="5">Nothing is listening.</TableEmpty>
        </TableBody>
      </Table>
      <div v-else class="flex flex-col gap-2">
        <Skeleton v-for="index in 6" :key="index" class="h-9" />
      </div>
    </CardContent>
  </Card>

  <AlertDialog :open="!!pending" @update:open="(open: boolean) => { if (!open) pending = null }">
    <AlertDialogContent v-if="dialog">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ dialog.title }}</AlertDialogTitle>
        <AlertDialogDescription>{{ dialog.text }}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction :variant="dialog.destructive ? 'destructive' : 'default'" @click="confirm">{{ dialog.verb }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
