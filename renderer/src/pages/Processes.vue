<script setup lang="ts">
import { EllipsisIcon, SearchIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import LoadError from '@/components/LoadError.vue'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useResource } from '@/composables/useResource'
import { messageOf, post } from '@/lib/api'
import { bytes, duration } from '@/lib/format'
import type { ActionResult, ProcessInfo } from '@/lib/types'

const { data, error, refresh } = useResource<ProcessInfo[]>('/processes', 5000)
const search = ref('')
const sort = ref('cpu')
const pending = ref<{ process: ProcessInfo; action: 'stop' | 'kill' } | null>(null)

const visible = computed(() => {
  const term = search.value.trim().toLowerCase()
  const list = (data.value ?? []).filter(
    (item) =>
      !term ||
      item.name.toLowerCase().includes(term) ||
      item.path.toLowerCase().includes(term) ||
      item.user.toLowerCase().includes(term) ||
      String(item.pid) === term,
  )
  const key = sort.value === 'memory' ? 'memory' : 'cpu'
  return [...list].sort((a, b) => b[key] - a[key]).slice(0, 150)
})

const userName = (user: string) => user.split('\\').at(-1) ?? user
const age = (started: number | null) => (started ? duration((Date.now() - started) / 1000) : '')

async function confirm() {
  const target = pending.value
  if (!target) return
  pending.value = null
  try {
    const result = await post<ActionResult>(`/processes/${target.process.pid}/${target.action}`)
    toast.success(result.message)
  } catch (failure) {
    toast.error(messageOf(failure))
  }
  await refresh()
}
</script>

<template>
  <LoadError :message="error" />

  <div class="flex flex-wrap items-center gap-2">
    <div class="relative w-full max-w-sm">
      <SearchIcon class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
      <Input v-model="search" class="pl-8" placeholder="Filter by name, path, user or PID" aria-label="Filter processes" />
    </div>
    <Select v-model="sort">
      <SelectTrigger class="w-48" aria-label="Sort by">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="cpu">Highest processor first</SelectItem>
        <SelectItem value="memory">Most memory first</SelectItem>
      </SelectContent>
    </Select>
    <p v-if="data" class="text-muted-foreground ml-auto text-sm">{{ data.length }} running</p>
  </div>

  <Card class="py-0">
    <CardContent class="px-0">
      <Table v-if="data">
        <TableHeader>
          <TableRow>
            <TableHead class="pl-4">Process</TableHead>
            <TableHead>PID</TableHead>
            <TableHead>User</TableHead>
            <TableHead class="text-right">Processor</TableHead>
            <TableHead class="text-right">Memory</TableHead>
            <TableHead class="text-right">Running</TableHead>
            <TableHead class="w-10 pr-4"><span class="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="item in visible" :key="item.pid">
            <TableCell class="w-full max-w-0 pl-4">
              <p class="truncate font-medium">{{ item.name }}</p>
              <p class="text-muted-foreground truncate font-mono text-xs" :title="item.path">{{ item.path }}</p>
            </TableCell>
            <TableCell class="tabular-nums">{{ item.pid }}</TableCell>
            <TableCell class="max-w-32 truncate" :title="item.user">{{ userName(item.user) }}</TableCell>
            <TableCell class="text-right tabular-nums">{{ item.cpu.toFixed(1) }}%</TableCell>
            <TableCell class="text-right tabular-nums">{{ bytes(item.memory) }}</TableCell>
            <TableCell class="text-right tabular-nums">{{ age(item.started) }}</TableCell>
            <TableCell class="pr-4">
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button variant="ghost" size="icon-sm" :aria-label="`Actions for ${item.name}`">
                    <EllipsisIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem @select="pending = { process: item, action: 'stop' }">Close</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" @select="pending = { process: item, action: 'kill' }">
                    End task
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
          <TableEmpty v-if="!visible.length" :colspan="7">No process matches that filter.</TableEmpty>
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
        <AlertDialogTitle>{{ pending.action === 'kill' ? 'End' : 'Close' }} {{ pending.process.name }}?</AlertDialogTitle>
        <AlertDialogDescription>
          <template v-if="pending.action === 'kill'">
            Process {{ pending.process.pid }} and the processes it started are ended at once. Unsaved work in them is lost.
          </template>
          <template v-else>
            The program is asked to close, as if you clicked its close button. It may ask to save your work first.
            Background programs without a window can only be ended.
          </template>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction :variant="pending.action === 'kill' ? 'destructive' : 'default'" @click="confirm">
          {{ pending.action === 'kill' ? 'End task' : 'Close' }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
