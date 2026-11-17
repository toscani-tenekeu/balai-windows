<script setup lang="ts">
import type { ChartConfig } from '@/components/ui/chart'
import { CurveType } from '@unovis/ts'
import { VisAxis, VisLine, VisXYContainer } from '@unovis/vue'
import { computed } from 'vue'
import {
  ChartContainer, ChartCrosshair, ChartLegendContent, ChartTooltip, ChartTooltipContent, componentToString,
} from '@/components/ui/chart'
import type { Sample } from '@/lib/types'

const props = defineProps<{ samples: Sample[]; hours: number }>()

const config = {
  cpu: { label: 'Processor', color: 'var(--chart-4)' },
  mem: { label: 'Memory', color: 'var(--chart-2)' },
} satisfies ChartConfig

const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit' })
const full = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const tick = computed(() => (value: number) => (props.hours > 24 ? day : time).format(value))
const tooltip = componentToString(config, ChartTooltipContent, {
  labelFormatter: (value: number | Date) => full.format(value),
})
</script>

<template>
  <ChartContainer :config="config" class="aspect-auto h-56 w-full" cursor>
    <VisXYContainer :data="samples" :y-domain="[0, 100]" :margin="{ left: 4, right: 12, top: 8 }">
      <VisLine
        :x="(d: Sample) => d.at"
        :y="[(d: Sample) => d.cpu, (d: Sample) => d.mem]"
        :color="[config.cpu.color, config.mem.color]"
        :curve-type="CurveType.Linear"
        :line-width="1.5"
      />
      <VisAxis type="x" :num-ticks="6" :tick-line="false" :domain-line="false" :grid-line="false" :tick-format="tick" />
      <VisAxis type="y" :num-ticks="4" :tick-line="false" :domain-line="false" :tick-format="(value: number) => `${value}%`" />
      <ChartTooltip />
      <ChartCrosshair :template="tooltip" :color="[config.cpu.color, config.mem.color]" />
    </VisXYContainer>
    <ChartLegendContent />
  </ChartContainer>
</template>
