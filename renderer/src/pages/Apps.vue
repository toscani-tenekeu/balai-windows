<script setup lang="ts">
import { CircleCheckIcon, RefreshCwIcon, SearchIcon, TriangleAlertIcon } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import LoadError from '@/components/LoadError.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useResource } from '@/composables/useResource'
import { api, messageOf, post } from '@/lib/api'
import { bytes } from '@/lib/format'
import type { ActionResult, AppUpdate, AppUpdates, InstalledApp, Job } from '@/lib/types'

type Pending = { kind: 'uninstall'; app: InstalledApp } | { kind: 'update'; update: AppUpdate | null }

const { data: apps, error, refresh: refreshApps } = useResource<InstalledApp[]>('/apps')
const { data: updates, loading: updatesLoading, refresh: refreshUpdates } = useResource<AppUpdates>('/apps/updates')

const tab = ref('installed')
const search = ref('')
const pending = ref<Pending | null>(null)
const checking = ref(false)
const job = ref<Job | null>(null)
const showJob = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

const busy = computed(() => job.value?.running === true)
const visible = computed(() => {
  const term = search.value.trim().toLowerCase()
  return (apps.value ?? []).filter(
    (item) => !term || item.name.toLowerCase().includes(term) || item.publisher.toLowerCase().includes(term),
  )
})
const totalSize = computed(() => (apps.value ?? []).reduce((sum, item) => sum + item.size, 0))

async function checkUpdates() {
  checking.value = true
  try {
    updates.value = await api<AppUpdates>('/apps/updates?fresh')
  } catch (failure) {
    toast.error(messageOf(failure))
  }
  checking.value = false
}

async function poll() {
  try {
    const state = await api<{ job: Job | null }>('/apps/job')
    const wasRunning = busy.value
    job.value = state.job
    if (state.job?.running) {
      timer ??= setInterval(() => void poll(), 1500)
    } else {
      clearInterval(timer)
      timer = undefined
      if (wasRunning) {
        if (state.job?.ok) toast.success(`${state.job.title}: done.`)
        else toast.error(`${state.job?.title ?? 'The update'} failed.`)
        void refreshUpdates()
        void refreshApps()
      }
    }
  } catch {
    // The next tick tries again.
  }
}

async function confirm() {
  const target = pending.value
  if (!target) return
  pending.value = null
  try {
    if (target.kind === 'uninstall') {
      const result = await post<ActionResult>('/apps/uninstall', { id: target.app.id })
      toast.success(result.message)
    } else {
      await post<ActionResult>('/apps/update', { id: target.update?.id ?? null })
      showJob.value = true
      await poll()
    }
  } catch (failure) {
    toast.error(messageOf(failure))
  }
}

onMounted(poll)
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <LoadError :message="error" />

  <Alert v-if="job && (job.running || !showJob)" :variant="job.ok === false ? 'destructive' : 'default'">
    <Spinner v-if="job.running" />
    <CircleCheckIcon v-else-if="job.ok" />
    <TriangleAlertIcon v-else />
    <AlertTitle>{{ job.title }}{{ job.running ? '…' : job.ok ? ': done' : ': failed' }}</AlertTitle>
    <AlertDescription>
      <Button variant="link" class="h-auto p-0" @click="showJob = true">Show the output</Button>
    </AlertDescription>
  </Alert>

  <Tabs v-model="tab">
    <TabsList>
      <TabsTrigger value="installed">Installed</TabsTrigger>
      <TabsTrigger value="updates">Updates{{ updates?.updates.length ? ` ${updates.updates.length}` : '' }}</TabsTrigger>
    </TabsList>

    <TabsContent value="installed" class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <div class="relative w-full max-w-sm">
          <SearchIcon class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input v-model="search" class="pl-8" placeholder="Filter by name or publisher" aria-label="Filter programs" />
        </div>
        <Button variant="outline" size="sm" @click="refreshApps">
          <RefreshCwIcon data-icon="inline-start" />
          Refresh
        </Button>
        <p v-if="apps" class="text-muted-foreground ml-auto text-sm">
          {{ apps.length }} programs, about {{ bytes(totalSize) }}
        </p>
      </div>

      <Card class="py-0">
        <CardContent class="px-0">
          <Table v-if="apps">
            <TableHeader>
              <TableRow>
                <TableHead class="pl-4">Program</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Installed</TableHead>
                <TableHead class="text-right">Size</TableHead>
                <TableHead class="w-28 pr-4"><span class="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="item in visible" :key="item.id">
                <TableCell class="w-full max-w-0 pl-4">
                  <p class="truncate font-medium">{{ item.name }}</p>
                  <p class="text-muted-foreground truncate text-xs">{{ item.publisher }}<template v-if="item.publisher"> · </template>{{ item.scope }}</p>
                </TableCell>
                <TableCell class="text-muted-foreground max-w-32 truncate font-mono text-xs">{{ item.version }}</TableCell>
                <TableCell class="text-muted-foreground whitespace-nowrap">{{ item.installed }}</TableCell>
                <TableCell class="text-right tabular-nums">{{ item.size ? bytes(item.size) : '' }}</TableCell>
                <TableCell class="pr-4 text-right">
                  <Button
                    v-if="item.canUninstall"
                    variant="outline"
                    size="sm"
                    @click="pending = { kind: 'uninstall', app: item }"
                  >
                    Uninstall
                  </Button>
                </TableCell>
              </TableRow>
              <TableEmpty v-if="!visible.length" :colspan="5">No program matches.</TableEmpty>
            </TableBody>
          </Table>
          <div v-else class="flex flex-col gap-2 p-4">
            <Skeleton v-for="index in 8" :key="index" class="h-10" />
          </div>
        </CardContent>
      </Card>
    </TabsContent>

    <TabsContent value="updates">
      <Card>
        <CardHeader>
          <CardTitle>
            <template v-if="updates?.available">
              {{ updates.updates.length }} {{ updates.updates.length === 1 ? 'update' : 'updates' }} available
            </template>
            <template v-else>Program updates</template>
          </CardTitle>
          <CardDescription>Found and installed with winget, the package manager built into Windows.</CardDescription>
          <CardAction class="flex gap-2">
            <Button variant="outline" size="sm" :disabled="checking || busy" @click="checkUpdates">
              <Spinner v-if="checking" data-icon="inline-start" />
              <RefreshCwIcon v-else data-icon="inline-start" />
              Check again
            </Button>
            <Button
              v-if="updates?.updates.length"
              size="sm"
              :disabled="busy"
              @click="pending = { kind: 'update', update: null }"
            >
              Update all
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Alert v-if="updates?.error" variant="destructive">
            <TriangleAlertIcon />
            <AlertDescription>{{ updates.error }}</AlertDescription>
          </Alert>
          <template v-else-if="updates && !updatesLoading">
            <Table v-if="updates.updates.length">
              <TableHeader>
                <TableRow>
                  <TableHead>Program</TableHead>
                  <TableHead>Installed</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead class="w-24"><span class="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="item in updates.updates" :key="item.id">
                  <TableCell class="w-full max-w-0">
                    <p class="truncate font-medium">{{ item.name }}</p>
                    <p class="text-muted-foreground truncate font-mono text-xs">{{ item.id }}</p>
                  </TableCell>
                  <TableCell class="text-muted-foreground font-mono text-xs">{{ item.current }}</TableCell>
                  <TableCell class="font-mono text-xs">{{ item.next }}</TableCell>
                  <TableCell class="text-right">
                    <Button variant="outline" size="sm" :disabled="busy" @click="pending = { kind: 'update', update: item }">
                      Update
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <Empty v-else>
              <EmptyHeader>
                <EmptyTitle>Everything is up to date</EmptyTitle>
                <EmptyDescription>winget found no newer version of your programs.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </template>
          <div v-else class="flex flex-col gap-2">
            <p class="text-muted-foreground text-sm">Looking for updates. This takes a few seconds.</p>
            <Skeleton v-for="index in 4" :key="index" class="h-9" />
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  </Tabs>

  <AlertDialog :open="!!pending" @update:open="(open: boolean) => { if (!open) pending = null }">
    <AlertDialogContent v-if="pending?.kind === 'uninstall'">
      <AlertDialogHeader>
        <AlertDialogTitle>Uninstall {{ pending.app.name }}?</AlertDialogTitle>
        <AlertDialogDescription>
          The program’s own uninstaller opens and guides you through the removal. Once it is done, the program and
          what it added to Windows are gone. Files you made with it are usually kept, but check before you continue.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction variant="destructive" @click="confirm">Open uninstaller</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
    <AlertDialogContent v-else-if="pending?.kind === 'update'">
      <AlertDialogHeader>
        <AlertDialogTitle>
          {{ pending.update ? `Update ${pending.update.name}?` : `Update all ${updates?.updates.length ?? ''} programs?` }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          The new {{ pending.update ? 'version is' : 'versions are' }} downloaded from the publisher and installed
          without questions. Close the {{ pending.update ? 'program' : 'programs' }} first: a program that is open may be
          closed during the update, and unsaved work in it is lost.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction @click="confirm">{{ pending.update ? 'Update' : 'Update all' }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <Dialog v-model:open="showJob">
    <DialogContent v-if="job" class="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{{ job.title }}</DialogTitle>
        <DialogDescription>
          <template v-if="job.running">Running. You can close this window; the update continues.</template>
          <template v-else-if="job.ok">Finished without errors.</template>
          <template v-else>Finished with an error. The last lines say why.</template>
        </DialogDescription>
      </DialogHeader>
      <ScrollArea class="bg-muted h-80 rounded-md border">
        <pre class="p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{{ job.output.join('\n') || 'Waiting for output…' }}</pre>
      </ScrollArea>
      <DialogFooter>
        <Spinner v-if="job.running" class="mr-auto self-center" />
        <Button variant="outline" @click="showJob = false">Close</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
