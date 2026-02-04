'use server';

import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { 
  SystemSetting, 
  AIConfig, 
  AIModelConfig, 
  AIModelOption, 
  DEFAULT_MODELS 
} from './types';

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

export async function getAIModelSettings(): Promise<AIModelConfig> {
  const supabase = await createClient();
  
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'ai_model_config')
    .single();

  if (error || !data) {
    // Default fallback
    return { modelName: 'gemini-2.0-flash' };
  }

  return data.value as AIModelConfig;
}

  // Check admin privileges using standard client
export async function updateAIModelSettings(config: AIModelConfig) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
    
  if (!profile?.is_admin) throw new Error('Unauthorized');

  // Perform update using Service Role Key to bypass RLS
  const adminSupabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Insert or Update
  const { error } = await adminSupabase
    .from('system_settings')
    .upsert({ 
      key: 'ai_model_config',
      value: config,
      description: 'AI Model Configuration',
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' });

  if (error) {
    console.error('Error updating AI model settings:', error);
    throw new Error('Failed to update settings');
  }
  revalidatePath('/admin/passages/models');
  return { success: true };
}

export async function getAvailableAIModels(): Promise<AIModelOption[]> {
  const supabase = await createClient();
  
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'ai_available_models')
    .single();

  if (error || !data) {
    return DEFAULT_MODELS;
  }

  return data.value as AIModelOption[];
}

export async function saveAvailableAIModels(models: AIModelOption[]) {
  // Check admin privileges
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
    
  if (!profile?.is_admin) throw new Error('Unauthorized');

  // Perform update using Service Role Key
  const adminSupabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error } = await adminSupabase
    .from('system_settings')
    .upsert({ 
      key: 'ai_available_models',
      value: models,
      description: 'List of available AI models for selection',
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' });

  if (error) {
    console.error('Error saving available AI models:', error);
    throw new Error('Failed to save available models');
  }

  revalidatePath('/admin/passages/models');
  return { success: true };
}
