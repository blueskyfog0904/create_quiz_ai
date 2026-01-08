'use server';

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
  
  // Check admin permission
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
    
  if (!profile?.is_admin) throw new Error('Unauthorized');

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
  const supabase = await createClient();

  // Check admin permission
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
    
  if (!profile?.is_admin) throw new Error('Unauthorized');

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
