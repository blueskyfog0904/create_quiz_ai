'use server';

import { assertAdminFeatureEnabled } from '@/lib/admin-features-server'
import { assertAdminActionPermission } from '@/lib/admin-permissions-server'
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface SystemPrompt {
  key: string;
  description: string;
  content: string;
  updated_at: string;
}

export async function getSystemPrompts(): Promise<SystemPrompt[]> {
  const supabase = await createClient();
  
  await assertAdminActionPermission('owner')

  const { data, error } = await supabase
    .from('system_prompts')
    .select('*')
    .order('key');

  if (error) {
    console.error('Error fetching prompts:', error);
    throw new Error('Failed to fetch prompts');
  }

  return data as SystemPrompt[];
}

export async function updateSystemPrompt(key: string, content: string) {
  await assertAdminFeatureEnabled('passages')
  const supabase = await createClient();

  await assertAdminActionPermission('owner')

  const { error } = await supabase
    .from('system_prompts')
    .update({ 
      content,
      updated_at: new Date().toISOString()
    })
    .eq('key', key);

  if (error) {
    console.error('Error updating prompt:', error);
    throw new Error('Failed to update prompt');
  }

  revalidatePath('/admin/passages/prompts');
  return { success: true };
}
