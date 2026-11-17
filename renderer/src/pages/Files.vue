<script setup lang="ts">
import { SearchIcon, Trash2Icon, TriangleAlertIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import StatusBadge from '@/components/StatusBadge.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, messageOf, post } from '@/lib/api'
import { bytes, dateTime } from '@/lib/format'
import type { DeleteResult, FileSearch, FoundFile } from '@/lib/types'

const PRESETS = [
  { label: 'Archives', value: 'zip, tar, gz, tgz, bz2, xz, 7z, rar' },
  { label: 'Backups', value: 'bak, old, orig, sql, dump' },
  { label: 'Logs', value: 'log' },
  { label: 'Installers', value: 'exe, msi, msix' },
  { label: 'Disk images', value: 'iso, img, vhd, vhdx' },
  { label: 'Videos', value: 'mp4, mkv, avi, mov, webm' },
]

const MB = 1024 ** 2

const folder = ref('C:\\')
const extensions = ref('')
const minimum = ref('0')
const age = ref('0')

const searching = ref(false)
const deleting = ref(false)
const confirming = ref(false)
const result = ref<FileSearch | null>(null)
const failure = ref('')
const outcome = ref<DeleteResult | null>(null)
const selected = ref<Record<string, boolean>>({})
const permanent = ref(false)

const canSearch = computed(() => extensions.value.trim() !== '' || minimum.value !== '0')
const deletable = computed(() => result.value?.files.filter((file) => !file.locked) ?? [])
const chosen = computed(() => deletable.value.filter((file) => selected.value[file.path]))
const chosenSize = computed(() => chosen.value.reduce((sum, file) => sum + file.size, 0))
const allChosen = computed(() => deletable.value.length > 0 && chosen.value.length === deletable.value.length)

async function search() {
  if (!canSearch.value) return
  searching.value = true
  failure.value = ''
  outcome.value = null
  const query = new URLSearchParams({
    path: folder.value.trim() || 'C:\\',
    ext: extensions.value,
    min: String(Number(minimum.value) * MB),
    days: age.value,
  })
  try {
    result.value = await api<FileSearch>(`/files?${query}`)
    selected.value = {}
  } catch (error) {
    result.value = null
    failure.value = messageOf(error)
  }
  searching.value = false
}

function toggleAll() {
  const next = !allChosen.value
  selected.value = Object.fromEntries(deletable.value.map((file) => [file.path, next]))
}

async function remove() {
  confirming.value = false
  deleting.value = true
  const paths = chosen.value.map((file) => file.path)
  try {
    outcome.value = await post<DeleteResult>('/files/delete', { paths, permanent: permanent.value })
    if (outcome.value.deleted) {
      toast.success(
        permanent.value
          ? `${outcome.value.deleted} deleted, ${bytes(outcome.value.freed)} freed.`
          : `${outcome.value.deleted} moved to the Recycle Bin. Empty it to free the space.`,
      )
    }
    const gone = new Set(paths.filter((path) => !outcome.value?.failed.some((entry) => entry.path === path)))
    if (result.value) {
      const kept = result.value.files.filter((file: FoundFile) => !gone.has(file.path))
      result.value = {
        ...result.value,
        files: kept,
        count: result.value.count - gone.size,
        total: Math.max(0, result.value.total - chosenSize.value),
      }
    }
    selected.value = {}
  } catch (error) {
    toast.error(messageOf(error))
  }
  deleting.value = false
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Find files</CardTitle>
      <CardDescription>
        Look for files by type, size or age on any drive, then choose which ones to delete.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <form id="file-search" @submit.prevent="search">
        <FieldGroup>
          <div class="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel for="extensions">File extensions</FieldLabel>
              <Input id="extensions" v-model="extensions" placeholder="zip, iso, log" autocomplete="off" />
              <div class="flex flex-wrap gap-1">
                <Button
                  v-for="preset in PRESETS"
                  :key="preset.label"
                  type="button"
                  variant="outline"
                  size="xs"
                  @click="extensions = preset.value"
                >
                  {{ preset.label }}
                </Button>
              </div>
            </Field>
            <Field>
              <FieldLabel for="folder">Folder</FieldLabel>
              <Input id="folder" v-model="folder" class="font-mono" placeholder="C:\" autocomplete="off" />
              <FieldDescription>Use a drive such as C:\ or D:\ to search all of it.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel for="minimum">Size</FieldLabel>
              <Select v-model="minimum">
                <SelectTrigger id="minimum"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Any size</SelectItem>
                  <SelectItem value="10">10 MB or more</SelectItem>
                  <SelectItem value="100">100 MB or more</SelectItem>
                  <SelectItem value="1024">1 GB or more</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel for="age">Last changed</FieldLabel>
              <Select v-model="age">
                <SelectTrigger id="age"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Any time</SelectItem>
                  <SelectItem value="30">More than 30 days ago</SelectItem>
                  <SelectItem value="90">More than 90 days ago</SelectItem>
                  <SelectItem value="365">More than a year ago</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </FieldGroup>
      </form>
    </CardContent>
    <CardFooter class="justify-between gap-4 border-t">
      <p class="text-muted-foreground text-sm">
        {{ canSearch ? 'Searching a whole drive can take a few minutes.' : 'Give an extension or a minimum size.' }}
      </p>
      <Button type="submit" form="file-search" :disabled="!canSearch || searching">
        <Spinner v-if="searching" data-icon="inline-start" />
        <SearchIcon v-else data-icon="inline-start" />
        {{ searching ? 'Searching…' : 'Search' }}
      </Button>
    </CardFooter>
  </Card>

  <Alert v-if="failure" variant="destructive">
    <TriangleAlertIcon />
    <AlertTitle>The search did not run</AlertTitle>
    <AlertDescription>{{ failure }}</AlertDescription>
  </Alert>

  <Alert v-if="outcome && outcome.failed.length" variant="destructive">
    <TriangleAlertIcon />
    <AlertTitle>{{ outcome.failed.length }} could not be deleted</AlertTitle>
    <AlertDescription>
      <ul>
        <li v-for="entry in outcome.failed.slice(0, 8)" :key="entry.path" class="break-all">
          {{ entry.path }}: {{ entry.message }}
        </li>
      </ul>
    </AlertDescription>
  </Alert>

  <Card v-if="result" :class="result.files.length ? 'pb-0' : ''">
    <CardHeader>
      <CardTitle>
        {{ result.count }} {{ result.count === 1 ? 'file' : 'files' }}, {{ bytes(result.total) }}
      </CardTitle>
      <CardDescription>
        In <span class="font-mono">{{ result.path }}</span>, largest first.
        <template v-if="result.truncated">Only the {{ result.files.length }} largest are listed.</template>
        Files Windows needs are shown but cannot be deleted from here.
      </CardDescription>
    </CardHeader>
    <CardContent v-if="result.files.length" class="px-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-10 pl-4">
              <Checkbox
                :model-value="allChosen"
                :disabled="!deletable.length || deleting"
                aria-label="Select all"
                @update:model-value="toggleAll"
              />
            </TableHead>
            <TableHead>File</TableHead>
            <TableHead>Last changed</TableHead>
            <TableHead class="pr-4 text-right">Size</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="file in result.files" :key="file.path">
            <TableCell class="pl-4">
              <Checkbox
                v-model="selected[file.path]"
                :disabled="file.locked || deleting"
                :aria-label="`Select ${file.path}`"
              />
            </TableCell>
            <TableCell class="max-w-xl">
              <span class="flex items-center gap-2">
                <span class="truncate font-mono text-xs" :title="file.path">{{ file.path }}</span>
                <StatusBadge v-if="file.locked" tone="idle">System</StatusBadge>
              </span>
            </TableCell>
            <TableCell class="text-muted-foreground whitespace-nowrap">{{ dateTime(file.modified) }}</TableCell>
            <TableCell class="pr-4 text-right tabular-nums">{{ bytes(file.size) }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </CardContent>
    <CardContent v-else>
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Nothing found</EmptyTitle>
          <EmptyDescription>No file matches in that folder.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </CardContent>
    <CardFooter v-if="result.files.length" class="bg-card sticky bottom-0 justify-between gap-4 rounded-b-xl border-t py-4">
      <p class="text-muted-foreground text-sm">
        <template v-if="chosen.length">{{ chosen.length }} selected, {{ bytes(chosenSize) }}</template>
        <template v-else>Nothing selected</template>
      </p>
      <Button variant="destructive" :disabled="!chosen.length || deleting" @click="confirming = true">
        <Spinner v-if="deleting" data-icon="inline-start" />
        <Trash2Icon v-else data-icon="inline-start" />
        Delete selected
      </Button>
    </CardFooter>
  </Card>

  <AlertDialog v-model:open="confirming">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          Delete {{ chosen.length }} {{ chosen.length === 1 ? 'file' : 'files' }}?
        </AlertDialogTitle>
        <AlertDialogDescription>
          <template v-if="permanent">
            {{ bytes(chosenSize) }} will be freed. The files are removed for good and cannot be restored.
          </template>
          <template v-else>
            The files go to the Recycle Bin, where you can restore them. Their {{ bytes(chosenSize) }} is freed once the
            Recycle Bin is emptied.
          </template>
          A program that still uses one of them may stop working.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <ul class="bg-muted max-h-40 overflow-y-auto rounded-md border p-3 font-mono text-xs break-all">
        <li v-for="file in chosen.slice(0, 20)" :key="file.path">{{ file.path }}</li>
        <li v-if="chosen.length > 20" class="text-muted-foreground font-sans">and {{ chosen.length - 20 }} more</li>
      </ul>
      <Field orientation="horizontal">
        <Checkbox id="permanent" v-model="permanent" />
        <FieldContent>
          <FieldLabel for="permanent">Delete permanently</FieldLabel>
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
