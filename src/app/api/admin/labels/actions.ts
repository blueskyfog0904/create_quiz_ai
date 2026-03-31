'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { DEFAULT_WORKSPACE_SUBJECT, withWorkspacePrefix } from '@/lib/workspace-subject';

export interface DisplayLabel {
  id: string;
  category: string;
  db_value: string;
  display_value: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function revalidateLegacyAndEnglishPath(path: string, type: 'layout' | 'page' = 'page') {
  revalidatePath(path, type);
  revalidatePath(withWorkspacePrefix(DEFAULT_WORKSPACE_SUBJECT, path), type);
}

// Get all display labels
export async function getDisplayLabels(): Promise<DisplayLabel[]> {
  const supabase = await createClient();
  
  const { data, error } = await supabase
    .from('display_labels')
    .select('*')
    .order('category')
    .order('sort_order');
  
  if (error) {
    console.error('Error fetching display labels:', error);
    return [];
  }
  
  return data || [];
}

// Get display labels by category
export async function getDisplayLabelsByCategory(category: string): Promise<DisplayLabel[]> {
  const supabase = await createClient();
  
  const { data, error } = await supabase
    .from('display_labels')
    .select('*')
    .eq('category', category)
    .order('sort_order');
  
  if (error) {
    console.error('Error fetching display labels:', error);
    return [];
  }
  
  return data || [];
}

// Get display value for a specific db value
export async function getDisplayValue(category: string, dbValue: string): Promise<string> {
  const supabase = await createClient();
  
  const { data, error } = await supabase
    .from('display_labels')
    .select('display_value')
    .eq('category', category)
    .eq('db_value', dbValue)
    .single();
  
  if (error || !data) {
    return dbValue; // Fallback to db value if no label found
  }
  
  return data.display_value;
}

// Update a display label
export async function updateDisplayLabel(
  id: string, 
  displayValue: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  
  const { error } = await supabase
    .from('display_labels')
    .update({ 
      display_value: displayValue,
      updated_at: new Date().toISOString()
    })
    .eq('id', id);
  
  if (error) {
    console.error('Error updating display label:', error);
    return { success: false, error: error.message };
  }
  
  revalidatePath('/admin/labels');
  revalidateLegacyAndEnglishPath('/library/purchased');
  
  return { success: true };
}

// Add a new display label
export async function addDisplayLabel(
  category: string,
  dbValue: string,
  displayValue: string,
  sortOrder?: number
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  
  const { error } = await supabase
    .from('display_labels')
    .insert({
      category,
      db_value: dbValue,
      display_value: displayValue,
      sort_order: sortOrder || 0
    });
  
  if (error) {
    console.error('Error adding display label:', error);
    return { success: false, error: error.message };
  }
  
  revalidatePath('/admin/labels');
  revalidateLegacyAndEnglishPath('/library/purchased');
  
  return { success: true };
}

// Delete a display label
export async function deleteDisplayLabel(id: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  
  const { error } = await supabase
    .from('display_labels')
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('Error deleting display label:', error);
    return { success: false, error: error.message };
  }
  
  revalidatePath('/admin/labels');
  revalidateLegacyAndEnglishPath('/library/purchased');
  
  return { success: true };
}
