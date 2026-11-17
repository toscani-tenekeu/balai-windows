<script setup lang="ts">
import { FileIcon, FolderIcon, Trash2Icon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import LoadError from '@/components/LoadError.vue'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useResource } from '@/composables/useResource'
import { api, messageOf, post } from '@/lib/api'
import { bytes, percent } from '@/lib/format'
import type { DiskUsage, Drive } from '@/lib/types'

type Entry = DiskUsage['entries'][number]

const { data: drives, error, refresh: refreshDrives } = useResource<Drive[]>('/drives', 30_000)

const path = ref('')
const usage = ref<DiskUsage | null>(null)
const usageError = ref('')
const loading = ref(false)
let request = 0

async function refresh() {
  if (!path.value) return
  const current = ++request
  loading.value = true
  try {
    const result = await api<DiskUsage>(`/disk?path=${encodeURIComponent(path.value)}`)
    if (current !== request) return
    usage.value = result
    usageError.value = ''
  } catch (failure) {
    if (current === request) usageError.value = messageOf(failure)
  } finally {
    if (current === request) loading.value = false
  }
}

function open(target: string) {
  path.value = target
}

watch(path, refresh)

const crumbs = computed(() => {
  const parts = path.value.split('\\').filter(Boolean)
  return parts.map((name, index) => ({
    name,
    path: index === 0 ? `${name}\\` : parts.slice(0, index + 1).join('\\'),
  }))
})
const largest = computed(() => usage.value?.entries[0]?.size || 1)

const pending = ref<Entry | null>(null)
const permanent = ref(false)
const deleting = ref('')

async function remove() {
  const entry = pending.value
  if (!entry) return
  pending.value = null
  deleting.value = entry.path
  try {
    if (entry.directory) await post('/files/delete-folder', { path: entry.path, permanent: permanent.value })
    else {
      const result = await post<{ failed: { message: string }[] }>('/files/delete', {
        paths: [entry.path],
        permanent: permanent.value,
      })
      if (result.failed.length) throw new Error(result.failed[0]!.message)
    }
    toast.success(
      permanent.value ? `Deleted ${entry.name}, ${bytes(entry.size)} freed.` : `${entry.name} moved to the Recycle Bin.`,
    )
  } catch (failure) {
    toast.error(messageOf(failure))
  }
  deleting.value = ''
  void refresh()
  void refreshDrives()
}
</script>

<template>
  <LoadError :message="error" />

  <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    <template v-if="drives">
      <Card v-for="drive in drives" :key="drive.letter">
        <CardHeader>
          <CardDescription class="truncate text-xs">{{ drive.label || 'Local disk' }} · {{ drive.fileSystem }}</CardDescription>
          <CardTitle>{{ drive.letter }}</CardTitle>
          <CardAction>
            <Button variant="outline" size="sm" @click="open(`${drive.letter}\\`)">Open</Button>
          </CardAction>
        </CardHeader>
        <CardContent class="flex flex-col gap-2">
          <Progress :model-value="drive.percent" />
          <div class="text-muted-foreground flex justify-between text-xs">
            <span>{{ bytes(drive.used) }} used ({{ percent(drive.percent) }})</span>
            <span>{{ bytes(drive.free) }} free of {{ bytes(drive.size) }}</span>
          </div>
        </CardContent>
      </Card>
    </template>
    <Skeleton v-else class="h-32" />
  </div>

  <Card>
    <CardHeader>
      <CardTitle>Where the space goes</CardTitle>
      <CardDescription>
        Open a folder to see what takes room inside it. Measuring a whole drive can take a minute or two.
        Folders and files Windows needs cannot be deleted from here.
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <div v-if="path" class="flex flex-wrap items-center gap-3">
        <Breadcrumb>
          <BreadcrumbList>
            <template v-for="(crumb, index) in crumbs" :key="crumb.path">
              <BreadcrumbSeparator v-if="index > 0" />
              <BreadcrumbItem>
                <BreadcrumbPage v-if="index === crumbs.length - 1">{{ crumb.name }}</BreadcrumbPage>
                <BreadcrumbLink v-else as-child>
                  <button type="button" @click="open(crumb.path)">{{ crumb.name }}</button>
                </BreadcrumbLink>
              </BreadcrumbItem>
            </template>
          </BreadcrumbList>
        </Breadcrumb>
        <Spinner v-if="loading" />
        <span v-else-if="usage" class="text-muted-foreground text-sm">{{ bytes(usage.total) }}</span>
        <Button v-if="usage?.parent" variant="outline" size="sm" class="ml-auto" @click="open(usage.parent)">Up one level</Button>
      </div>

      <LoadError :message="usageError" />

      <Table v-if="usage && !usageError">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead class="w-1/3">Share</TableHead>
            <TableHead class="text-right">Size</TableHead>
            <TableHead class="w-10"><span class="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody :class="loading ? 'opacity-50' : ''">
          <TableRow v-for="entry in usage.entries" :key="entry.path">
            <TableCell class="w-1/2 max-w-0">
              <Button v-if="entry.directory" variant="link" class="h-auto max-w-full justify-start p-0" @click="open(entry.path)">
                <FolderIcon data-icon="inline-start" />
                <span class="truncate">{{ entry.name }}</span>
              </Button>
              <span v-else class="flex items-center gap-1.5">
                <FileIcon class="text-muted-foreground size-4 shrink-0" />
                <span class="truncate">{{ entry.name }}</span>
              </span>
            </TableCell>
            <TableCell><Progress :model-value="(entry.size / largest) * 100" /></TableCell>
            <TableCell class="text-right tabular-nums">{{ bytes(entry.size) }}</TableCell>
            <TableCell>
              <Spinner v-if="deleting === entry.path" class="mx-auto" />
              <Button
                v-else-if="!entry.locked"
                variant="ghost"
                size="icon-sm"
                :disabled="!!deleting"
                :aria-label="`Delete ${entry.name}`"
                @click="pending = entry"
              >
                <Trash2Icon />
              </Button>
            </TableCell>
          </TableRow>
          <TableEmpty v-if="!usage.entries.length" :colspan="4">This folder is empty.</TableEmpty>
        </TableBody>
      </Table>
      <div v-else-if="!usageError && path" class="flex flex-col gap-2">
        <Skeleton v-for="index in 6" :key="index" class="h-9" />
      </div>
      <Empty v-else-if="!path">
        <EmptyHeader>
          <EmptyTitle>Choose a drive</EmptyTitle>
          <EmptyDescription>Select Open on one of the drives above to see what takes room on it.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </CardContent>
  </Card>

  <AlertDialog :open="!!pending" @update:open="(open: boolean) => { if (!open) pending = null }">
    <AlertDialogContent v-if="pending">
      <AlertDialogHeader>
        <AlertDialogTitle>Delete {{ pending.name }}?</AlertDialogTitle>
        <AlertDialogDescription>
          {{ pending.directory ? 'The folder and everything inside it' : 'The file' }} ({{ bytes(pending.size) }})
          <template v-if="permanent">is removed for good and cannot be restored.</template>
          <template v-else>goes to the Recycle Bin. The space is freed once the Recycle Bin is emptied.</template>
          A program that still needs it may stop working.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <p class="bg-muted rounded-md border p-3 font-mono text-xs break-all">{{ pending.path }}</p>
      <Field orientation="horizontal">
        <Checkbox id="disk-permanent" v-model="permanent" />
        <FieldContent>
          <FieldLabel for="disk-permanent">Delete permanently</FieldLabel>
          <FieldDescription>Skip the Recycle Bin and free the space now.</FieldDescription>
        </FieldContent>
      </Field>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction variant="destructive" @click="remove">{{ permanent ? 'Delete permanently' : 'Move to Recycle Bin' }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
