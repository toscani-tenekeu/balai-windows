<script setup lang="ts">
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import LoadError from '@/components/LoadError.vue'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useResource } from '@/composables/useResource'
import { messageOf, post } from '@/lib/api'
import type { ActionResult, StartupItem } from '@/lib/types'

const { data, error, refresh } = useResource<StartupItem[]>('/startup')
const pending = ref<StartupItem | null>(null)
const busy = ref('')

const enabledCount = computed(() => data.value?.filter((item) => item.enabled).length ?? 0)

async function apply(item: StartupItem, enabled: boolean) {
  pending.value = null
  busy.value = item.id
  try {
    const result = await post<ActionResult>('/startup', { id: item.id, enabled })
    toast.success(result.message)
  } catch (failure) {
    toast.error(messageOf(failure))
  }
  await refresh()
  busy.value = ''
}

function toggle(item: StartupItem, enabled: boolean) {
  if (enabled) void apply(item, true)
  else pending.value = item
}
</script>

<template>
  <LoadError :message="error" />

  <Card>
    <CardHeader>
      <CardTitle>Programs that start when you sign in</CardTitle>
      <CardDescription>
        <template v-if="data">{{ enabledCount }} of {{ data.length }} start with Windows. </template>
        Fewer programs at sign-in means Windows is ready sooner. Turning one off does not uninstall it, and you can turn it
        back on here or in Task Manager.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <template v-if="data">
        <Table v-if="data.length">
          <TableHeader>
            <TableRow>
              <TableHead>Program</TableHead>
              <TableHead>For</TableHead>
              <TableHead class="w-24 text-right">Starts</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="item in data" :key="item.id">
              <TableCell class="w-full max-w-0">
                <p class="truncate font-medium">{{ item.name }}</p>
                <p class="text-muted-foreground truncate font-mono text-xs" :title="item.command">{{ item.command }}</p>
              </TableCell>
              <TableCell class="text-muted-foreground whitespace-nowrap">{{ item.scope }}</TableCell>
              <TableCell class="text-right">
                <Switch
                  :model-value="item.enabled"
                  :disabled="busy === item.id"
                  :aria-label="`${item.name} starts at sign-in`"
                  @update:model-value="(value: boolean) => toggle(item, value)"
                />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <Empty v-else>
          <EmptyHeader>
            <EmptyTitle>Nothing starts with Windows</EmptyTitle>
            <EmptyDescription>No program is set to start when you sign in.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </template>
      <div v-else class="flex flex-col gap-2">
        <Skeleton v-for="index in 6" :key="index" class="h-10" />
      </div>
    </CardContent>
  </Card>

  <AlertDialog :open="!!pending" @update:open="(open: boolean) => { if (!open) pending = null }">
    <AlertDialogContent v-if="pending">
      <AlertDialogHeader>
        <AlertDialogTitle>Stop {{ pending.name }} from starting with Windows?</AlertDialogTitle>
        <AlertDialogDescription>
          It will not open by itself the next time {{ pending.scope === 'All users' ? 'anyone signs' : 'you sign' }} in.
          Things it does in the background, such as syncing, notifications or driver tools, only happen once you open it
          yourself. Nothing is uninstalled.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction @click="apply(pending, false)">Turn off</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
