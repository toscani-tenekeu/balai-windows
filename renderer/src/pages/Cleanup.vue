<script setup lang="ts">
import { CircleCheckIcon, RefreshCwIcon, TriangleAlertIcon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import LoadError from '@/components/LoadError.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useResource } from '@/composables/useResource'
import { messageOf, post } from '@/lib/api'
import { bytes } from '@/lib/format'
import type { CleanupItem, CleanupResult } from '@/lib/types'

const { data, error, loading, refresh } = useResource<CleanupItem[]>('/cleanup')
const selected = ref<Record<string, boolean>>({})
const confirming = ref(false)
const running = ref(false)
const result = ref<CleanupResult | null>(null)
let initialised = false

const hasSomething = (item: CleanupItem) =>
  item.bytes === null ? !item.note?.startsWith('0 ') : item.bytes > 0

watch(data, (items) => {
  if (!items || initialised) return
  initialised = true
  for (const item of items) selected.value[item.id] = item.recommended && hasSomething(item)
})

const chosen = computed(() => (data.value ?? []).filter((item) => selected.value[item.id]))
const total = computed(() =>
  chosen.value.reduce((sum, item) => sum + (item.kind === 'disk' ? item.bytes ?? 0 : 0), 0),
)

function size(item: CleanupItem): string {
  if (item.bytes === null) return item.note ?? ''
  return item.note ? `${bytes(item.bytes)} ${item.note}` : bytes(item.bytes)
}

async function run() {
  confirming.value = false
  running.value = true
  result.value = null
  try {
    result.value = await post<CleanupResult>('/cleanup', { ids: chosen.value.map((item) => item.id) })
    for (const item of chosen.value) selected.value[item.id] = false
  } catch (failure) {
    toast.error(messageOf(failure))
  }
  await refresh()
  running.value = false
}
</script>

<template>
  <LoadError :message="error" />

  <Alert v-if="result" :variant="result.ok ? 'default' : 'destructive'">
    <CircleCheckIcon v-if="result.ok" />
    <TriangleAlertIcon v-else />
    <AlertTitle>
      {{ result.ok ? `Done. ${bytes(result.freed)} freed.` : `Finished with errors. ${bytes(result.freed)} freed.` }}
    </AlertTitle>
    <AlertDescription>
      <ul>
        <li v-for="entry in result.results" :key="entry.id">
          {{ entry.title }}: {{ entry.ok ? (entry.freed ? bytes(entry.freed) : 'done') : entry.message }}
        </li>
      </ul>
    </AlertDescription>
  </Alert>

  <Card>
    <CardHeader>
      <CardTitle>What to clean</CardTitle>
      <CardDescription>
        Items that are always safe to remove are ticked for you. The others are explained and left for you to decide.
      </CardDescription>
      <CardAction>
        <Button variant="outline" size="sm" :disabled="loading || running" @click="refresh">
          <RefreshCwIcon data-icon="inline-start" />
          Measure again
        </Button>
      </CardAction>
    </CardHeader>
    <CardContent>
      <FieldGroup v-if="data" class="gap-0 divide-y">
        <Field v-for="item in data" :key="item.id" orientation="horizontal" class="py-3 first:pt-0 last:pb-0">
          <Checkbox :id="`clean-${item.id}`" v-model="selected[item.id]" :disabled="running" />
          <FieldContent>
            <FieldLabel :for="`clean-${item.id}`">{{ item.title }}</FieldLabel>
            <FieldDescription>{{ item.description }}</FieldDescription>
          </FieldContent>
          <span class="text-sm font-medium whitespace-nowrap tabular-nums">{{ size(item) }}</span>
        </Field>
      </FieldGroup>
      <div v-else class="flex flex-col gap-3">
        <Skeleton v-for="index in 7" :key="index" class="h-12" />
      </div>
    </CardContent>
    <CardFooter class="justify-between gap-4 border-t">
      <p class="text-muted-foreground text-sm">
        <template v-if="chosen.length">{{ chosen.length }} selected, about {{ bytes(total) }} to free</template>
        <template v-else>Nothing selected</template>
      </p>
      <Button :disabled="!chosen.length || running" @click="confirming = true">
        <Spinner v-if="running" />
        {{ running ? 'Cleaning…' : 'Clean selected' }}
      </Button>
    </CardFooter>
  </Card>

  <AlertDialog v-model:open="confirming">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Clean {{ chosen.length }} {{ chosen.length === 1 ? 'item' : 'items' }}?</AlertDialogTitle>
        <AlertDialogDescription>
          {{ chosen.map((item) => item.title).join(', ') }}. Removed files cannot be brought back.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction @click="run">Clean</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
