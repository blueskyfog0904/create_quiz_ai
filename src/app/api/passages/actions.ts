'use server';

import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { Database } from '@/types/supabase';
import { getAIModelSettings } from '@/app/api/admin/settings/actions';
import { workspaceRevalidatePaths } from '@/lib/workspace-revalidate';
import { assertWorkspaceSubject, DEFAULT_WORKSPACE_SUBJECT, type WorkspaceSubject } from '@/lib/workspace-subject';

// ... (imports)

export interface PassageAnalysis {
  original_index: number;
  title_en: string;
  title_ko: string;
  content_refined: string; // Sentence-segmented English
  content_translation: string; // Sentence-segmented Korean
}

export async function enrichPassages(contents: string[]): Promise<PassageAnalysis[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  // Fetch dynamic model setting
  const { modelName } = await getAIModelSettings();

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  // Using dynamic model from settings
  const model = genAI.getGenerativeModel({ 
    model: modelName,
    generationConfig: { responseMimeType: "application/json" }
  });

  // Construct batch prompt
  const passagesBlock = contents.map((text, idx) => `
    [PASSAGE_ID_${idx}]
    ${text}
    [END_PASSAGE_${idx}]
  `).join('\n');

  const prompt = `
    You are an expert English education content creator.
    I will provide multiple English reading passages.
    
    YOUR TASKS for EACH passage:
    1. **Refine English Content**: 
       - Correct any OCR errors.
       - **CRITICAL**: Split the text into distinct sentences. Write exactly **ONE sentence per line**.
       - Remove extra line breaks within a single sentence.
    2. **Translate to Korean**:
       - Translate the refined English text into natural Korean.
       - **CRITICAL**: Maintain strictly **ONE sentence per line**, matching the English lines 1:1. 
       - Line N of the Korean text must be the translation of Line N of the refined English text.
    3. **Generate Titles**:
       - Create a suitable English title.
       - Create a suitable Korean title.

    INPUT PASSAGES:
    ${passagesBlock}

    OUTPUT FORMAT:
    Return a strictly valid JSON ARRAY of objects. Each object must look like:
    {
      "original_index": number, // The integer ID from [PASSAGE_ID_x]
      "title_en": "string",
      "title_ko": "string",
      "content_refined": "string (The sentence-per-line English text)",
      "content_translation": "string (The sentence-per-line Korean text)"
    }
  `;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    // console.log("AI Response: ", responseText); 
    const json = JSON.parse(responseText);
    
    // Ensure it's an array
    const results = Array.isArray(json) ? json : [json];
    
    // Sort by index just in case
    return results.sort((a, b) => a.original_index - b.original_index);
  } catch (error) {
    console.error('Error enriching passages:', error);
    // Fallback: return empty analyses for each input
    return contents.map((_, idx) => ({
        original_index: idx,
        title_en: "Untitled",
        title_ko: "제목 없음",
        content_refined: contents[idx],
        content_translation: ""
    }));
  }
}

// Legacy single-item wrapper (optional, keep if used elsewhere)
export async function enrichPassage(content: string): Promise<PassageAnalysis> {
    const results = await enrichPassages([content]);
    return results[0];
}

// ... (rest of file)



export type Passage = Database['public']['Tables']['passages']['Row'];
export type CreatePassageInput = Database['public']['Tables']['passages']['Insert'];
export type UpdatePassageInput = Database['public']['Tables']['passages']['Update'];

type WorkspaceScopedRow = {
  workspace_subject?: string | null
}

type WorkspaceSubjectInput = WorkspaceSubject | string | null | undefined

function resolvePassageWorkspaceSubject(value?: WorkspaceSubjectInput): WorkspaceSubject {
  if (!value) {
    return DEFAULT_WORKSPACE_SUBJECT
  }

  return assertWorkspaceSubject(value)
}

function revalidatePassageLibrary(workspaceSubject: WorkspaceSubject) {
  revalidatePath('/library/mypassages', 'layout')
  workspaceRevalidatePaths(workspaceSubject, 'libraryMypassages').forEach(({ path, type }) => {
    revalidatePath(path, type)
  })
}

export async function createPassage(
  input: Omit<CreatePassageInput, 'user_id'>,
  options: { workspaceSubject?: WorkspaceSubjectInput } = {}
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const workspaceSubject = resolvePassageWorkspaceSubject(options.workspaceSubject)

  if (!user) {
    throw new Error('Unauthorized');
  }

  const { data, error } = await supabase
    .from('passages')
    .insert({
      ...input,
      user_id: user.id,
      workspace_subject: workspaceSubject,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating passage:', error);
    throw new Error('Failed to create passage');
  }

  const persistedWorkspaceSubject = resolvePassageWorkspaceSubject(
    (data as Passage & WorkspaceScopedRow).workspace_subject
    ?? workspaceSubject
  )
  revalidatePassageLibrary(persistedWorkspaceSubject);
  return data;
}

export interface GetPassagesParams {
  page?: number;
  limit?: number;
  search?: string;
  tags?: string[];
  isBookmarked?: boolean;
  startDate?: string;
  endDate?: string;
  sourceType?: string;
  source1?: string;
  source2?: string;
  source3?: string;
  source4?: string;
  workspaceSubject?: WorkspaceSubjectInput;
}

export async function getPassages(params: GetPassagesParams = {}) {
  const { 
    page = 1, 
    limit = 10,
    search,
    tags,
    isBookmarked,
    startDate,
    endDate,
    sourceType,
    source1,
    source2,
    source3,
    source4,
    workspaceSubject,
  } = params;
  const activeWorkspaceSubject = resolvePassageWorkspaceSubject(workspaceSubject)
  
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from('passages')
    .select('*', { count: 'exact' })
    .eq('user_id', user.id)
    .eq('workspace_subject', activeWorkspaceSubject)
    .order('created_at', { ascending: false });

  // Apply filters
  if (search) {
    query = query.or(`content.ilike.%${search}%,title_en.ilike.%${search}%,title_ko.ilike.%${search}%`);
  }

  if (tags && tags.length > 0) {
    query = query.contains('tags', tags);
  }

  if (isBookmarked !== undefined) {
    query = query.eq('is_bookmarked', isBookmarked);
  }

  if (startDate) {
    query = query.gte('created_at', `${startDate}T00:00:00`);
  }

  if (endDate) {
    query = query.lte('created_at', `${endDate}T23:59:59`);
  }

  // Source filters (partial match using ilike)
  if (sourceType) {
    query = query.ilike('source_type', `%${sourceType}%`);
  }

  if (source1) {
    query = query.ilike('source_1', `%${source1}%`);
  }

  if (source2) {
    query = query.ilike('source_2', `%${source2}%`);
  }

  if (source3) {
    query = query.ilike('source_3', `%${source3}%`);
  }

  if (source4) {
    query = query.ilike('source_4', `%${source4}%`);
  }

  const { data, error, count } = await query.range(from, to);

  if (error) {
    console.error('Error fetching passages:', error);
    throw new Error('Failed to fetch passages');
  }

  return { data: data as Passage[], count: count || 0 };
}

export async function getAllTags(workspaceSubject?: WorkspaceSubjectInput): Promise<string[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const activeWorkspaceSubject = resolvePassageWorkspaceSubject(workspaceSubject)

  const { data, error } = await supabase
    .from('passages')
    .select('tags')
    .eq('user_id', user.id)
    .eq('workspace_subject', activeWorkspaceSubject);

  if (error || !data) return [];

  // Flatten and dedup
  const tagSet = new Set<string>();
  data.forEach(row => {
    if (row.tags && Array.isArray(row.tags)) {
      row.tags.forEach(tag => tagSet.add(tag));
    }
  });

  return Array.from(tagSet).sort();
}

export async function getPassageById(
  id: string,
  options: { workspaceSubject?: WorkspaceSubjectInput } = {}
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const workspaceSubject = resolvePassageWorkspaceSubject(options.workspaceSubject)

  if (!user) {
    throw new Error('Unauthorized');
  }
  
  const { data, error } = await supabase
    .from('passages')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('workspace_subject', workspaceSubject)
    .single();

  if (error) {
    console.error('Error fetching passage:', error);
    return null;
  }

  return data;
}

export async function updatePassage(
  id: string,
  input: UpdatePassageInput,
  options: { workspaceSubject?: WorkspaceSubjectInput } = {}
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const workspaceSubject = resolvePassageWorkspaceSubject(options.workspaceSubject)

  if (!user) {
    throw new Error('Unauthorized');
  }

  const { data, error } = await supabase
    .from('passages')
    .update(input)
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('workspace_subject', workspaceSubject)
    .select()
    .single();

  if (error) {
    console.error('Error updating passage:', error);
    throw new Error('Failed to update passage');
  }

  const persistedWorkspaceSubject = resolvePassageWorkspaceSubject(
    (data as Passage & WorkspaceScopedRow).workspace_subject
    ?? workspaceSubject
  )
  revalidatePassageLibrary(persistedWorkspaceSubject);
  return data;
}

export async function deletePassage(
  id: string,
  options: { workspaceSubject?: WorkspaceSubjectInput } = {}
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const workspaceSubject = resolvePassageWorkspaceSubject(options.workspaceSubject)

  if (!user) {
    throw new Error('Unauthorized');
  }

  const { data: existingPassage, error: existingPassageError } = await supabase
    .from('passages')
    .select('workspace_subject')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existingPassageError) {
    console.error('Error fetching passage workspace:', existingPassageError);
    throw new Error('Failed to delete passage');
  }

  const persistedWorkspaceSubject = resolvePassageWorkspaceSubject(
    (existingPassage as WorkspaceScopedRow | null)?.workspace_subject
    ?? workspaceSubject
  )

  const { error } = await supabase
    .from('passages')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('workspace_subject', persistedWorkspaceSubject);

  if (error) {
    console.error('Error deleting passage:', error);
    throw new Error('Failed to delete passage');
  }

  revalidatePassageLibrary(persistedWorkspaceSubject);
}
