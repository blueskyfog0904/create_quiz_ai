'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import {
  saveHeaderNavigationConfig as persistHeaderNavigationConfig,
  getHeaderNavigationConfig,
} from '@/lib/header-navigation-server'
import {
  normalizeHeaderNavigationConfig,
  validateHeaderNavigationConfig,
  type HeaderNavigationConfig,
} from '@/lib/header-navigation'

export async function getMenuManagementConfig(): Promise<HeaderNavigationConfig> {
  await requireAdmin()
  return getHeaderNavigationConfig()
}

export async function saveMenuManagementConfig(input: HeaderNavigationConfig) {
  await requireAdmin()

  const normalizedConfig = normalizeHeaderNavigationConfig(input)
  validateHeaderNavigationConfig(normalizedConfig)

  const savedConfig = await persistHeaderNavigationConfig(normalizedConfig)

  revalidatePath('/', 'layout')
  revalidatePath('/admin')
  revalidatePath('/admin/menu-management')

  return {
    success: true,
    data: savedConfig,
  }
}
