import { ref } from 'vue'
import { api } from '@/lib/api'
import type { UpdateState } from '@/lib/types'

export const updateAvailable = ref(false)

export async function loadUpdateState() {
  try {
    const state = await api<UpdateState>('/update')
    updateAvailable.value = state.available
  } catch {
    // Not important enough to interrupt anything.
  }
}
