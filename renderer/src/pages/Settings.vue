<script setup lang="ts">
import { useColorMode } from '@vueuse/core'
import { DownloadIcon, RefreshCwIcon, TriangleAlertIcon } from '@lucide/vue'
import { onBeforeUnmount, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import LoadError from '@/components/LoadError.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { useResource } from '@/composables/useResource'
import { updateAvailable } from '@/composables/useSession'
import { api, messageOf, post } from '@/lib/api'
import { ago } from '@/lib/format'
import type { ActionResult, UpdateState } from '@/lib/types'

const { data: update, error } = useResource<UpdateState>('/update')
const checking = ref(false)
const confirming = ref(false)
const mode = useColorMode({ emitAuto: true })
let timer: ReturnType<typeof setInterval> | undefined

// While a download runs, follow its progress.
watch(
  () => update.value?.downloading,
  (downloading) => {
    clearInterval(timer)
    if (downloading) {
      timer = setInterval(async () => {
        update.value = await api<UpdateState>('/update').catch(() => update.value)
      }, 1000)
    }
  },
)
onBeforeUnmount(() => clearInterval(timer))

async function check() {
  checking.value = true
  try {
    update.value = await post<UpdateState>('/update/check')
    updateAvailable.value = update.value.available
    if (update.value.error) toast.error(update.value.error)
    else if (!update.value.available) toast.success('You have the latest version.')
  } catch (failure) {
    toast.error(messageOf(failure))
  }
  checking.value = false
}

async function download() {
  try {
    update.value = await post<UpdateState>('/update/download')
    if (update.value.error) toast.error(update.value.error)
  } catch (failure) {
    toast.error(messageOf(failure))
  }
}

async function install() {
  confirming.value = false
  try {
    const result = await post<ActionResult>('/update/install')
    toast.success(result.message)
  } catch (failure) {
    toast.error(messageOf(failure))
  }
}

async function setAuto(enabled: boolean) {
  try {
    update.value = await post<UpdateState>('/update/auto', { enabled })
  } catch (failure) {
    toast.error(messageOf(failure))
  }
}
</script>

<template>
  <LoadError :message="error" />

  <Card>
    <CardHeader>
      <CardTitle>Updates</CardTitle>
      <CardDescription v-if="update">Version {{ update.version }}. Last checked {{ ago(update.checkedAt) }}.</CardDescription>
    </CardHeader>
    <CardContent v-if="update" class="flex flex-col gap-4">
      <Alert v-if="!update.managed">
        <TriangleAlertIcon />
        <AlertTitle>Updates are not available for this copy</AlertTitle>
        <AlertDescription>Only a copy installed with the Balai installer can update itself.</AlertDescription>
      </Alert>

      <template v-else>
        <Alert v-if="update.downloaded">
          <DownloadIcon />
          <AlertTitle>Version {{ update.latestVersion }} is ready to install</AlertTitle>
          <AlertDescription>Balai closes, installs it and opens again. It also installs when you close Balai.</AlertDescription>
        </Alert>
        <Alert v-else-if="update.available">
          <DownloadIcon />
          <AlertTitle>Version {{ update.latestVersion }} is available</AlertTitle>
          <AlertDescription>
            <p v-if="update.notes" class="whitespace-pre-line">{{ update.notes }}</p>
            <Progress v-if="update.downloading" :model-value="update.progress" class="mt-2" />
          </AlertDescription>
        </Alert>
        <p v-else class="text-muted-foreground text-sm">You have the latest version.</p>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="auto-update">Download updates automatically</FieldLabel>
            <FieldDescription>
              Balai checks every six hours while it is open, downloads new versions and installs them when you close it.
            </FieldDescription>
          </FieldContent>
          <Switch id="auto-update" :model-value="update.auto" @update:model-value="setAuto" />
        </Field>
      </template>
    </CardContent>
    <CardContent v-else><Skeleton class="h-20" /></CardContent>
    <CardFooter v-if="update?.managed" class="gap-2 border-t">
      <Button v-if="update.downloaded" @click="confirming = true">Install and restart</Button>
      <Button v-else-if="update.available" :disabled="update.downloading" @click="download">
        <Spinner v-if="update.downloading" data-icon="inline-start" />
        <DownloadIcon v-else data-icon="inline-start" />
        {{ update.downloading ? `Downloading ${update.progress}%` : 'Download update' }}
      </Button>
      <Button variant="outline" :disabled="checking || update.downloading" @click="check">
        <Spinner v-if="checking" data-icon="inline-start" />
        <RefreshCwIcon v-else data-icon="inline-start" />
        Check for updates
      </Button>
    </CardFooter>
  </Card>

  <Card>
    <CardHeader>
      <CardTitle>Appearance</CardTitle>
    </CardHeader>
    <CardContent>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel for="theme">Theme</FieldLabel>
          <FieldDescription>System follows the light or dark setting of Windows.</FieldDescription>
        </FieldContent>
        <Select v-model="mode">
          <SelectTrigger id="theme" class="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">System</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </CardContent>
  </Card>

  <AlertDialog v-model:open="confirming">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Install version {{ update?.latestVersion }} now?</AlertDialogTitle>
        <AlertDialogDescription>
          Balai closes, installs the new version and opens again. A cleanup or update that is still running is stopped.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction @click="install">Install and restart</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
