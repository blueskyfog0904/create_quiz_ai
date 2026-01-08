'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface DifficultyLevel {
  id: string;
  name: string;
  promptValue: string;
}

export interface AIConfig {
  // Legacy field support
  difficulty?: {
    high: string;
    middle: string;
  };
  // New dynamic structure
  difficultyLevels: DifficultyLevel[];
  counts: number[];
}

export interface SystemSetting {
  key: string;
  value: AIConfig;
  description: string;
  updated_at: string;
}

export async function getSystemSettings(): Promise<SystemSetting | null> {
  const supabase = await createClient();
  
  const { data, error } = await supabase
    .from('system_settings')
    .select('*')
    .eq('key', 'ai_config')
    .single();

  if (error) {
    console.error('Error fetching settings:', error);
    return null;
  }

  // Runtime migration for dynamic levels
  const config = data.value as AIConfig;
  if (!config.difficultyLevels && config.difficulty) {
    config.difficultyLevels = [
      { id: 'high', name: '고등 (High)', promptValue: config.difficulty.high },
      { id: 'middle', name: '중등 (Middle)', promptValue: config.difficulty.middle },
    ];
  } else if (!config.difficultyLevels) {
    // Default fallback if totally empty
    config.difficultyLevels = [
      { id: 'high', name: '고등 (High)', promptValue: 'advanced / high school level (CEFR B2-C1)' },
      { id: 'middle', name: '중등 (Middle)', promptValue: 'intermediate / middle school level (CEFR A2-B1)' },
    ];
  }

  return { ...data, value: config } as SystemSetting;
}

export async function updateSystemSettings(key: string, value: AIConfig) {
  const supabase = await createClient();

  // Check admin
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
    
  if (!profile?.is_admin) throw new Error('Unauthorized');

  const { error } = await supabase
    .from('system_settings')
    .update({ 
      value,
      updated_at: new Date().toISOString()
    })
    .eq('key', key);

  if (error) {
    console.error('Error updating settings:', error);
    throw new Error('Failed to update settings');
  }

  revalidatePath('/admin/passages/prompts');
  return { success: true };
}
