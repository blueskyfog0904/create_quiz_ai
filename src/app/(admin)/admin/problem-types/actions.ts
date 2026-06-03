'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { DEFAULT_WORKSPACE_SUBJECT, withWorkspacePrefix, type WorkspaceSubject } from '@/lib/workspace-subject'
import { PROMPT_DEFAULT_KEYS } from '@/lib/ai/problem-type-default-prompts'

const AIProviderSchema = z.enum(['openai', 'gemini', 'claude'])
const PromptModeSchema = z.enum(['default', 'custom', 'disabled'])
const OptionalAIProviderSchema = z.preprocess(
  (value) => value === '' ? undefined : value,
  AIProviderSchema.optional()
)

const ProblemTypeSchema = z.object({
  workspace_subject: z.enum(['english', 'korean']).optional(),
  type_name: z.string().min(1, 'Type name is required'),
  description: z.string().optional(),
  generation_provider: AIProviderSchema,
  generation_model_name: z.string().min(1, 'Generation model name is required'),
  review_provider: OptionalAIProviderSchema,
  review_model_name: z.string().optional(),
  prompt_template: z.string().min(10, 'Prompt template is too short'),
  output_format: z.string().optional(),
  output_format_mode: PromptModeSchema.default('custom'),
  review_prompt_template: z.string().optional(),
  review_prompt_template_mode: PromptModeSchema.default('custom'),
  review_output_format: z.string().optional(),
  review_output_format_mode: PromptModeSchema.default('custom'),
  regeneration_prompt_template: z.string().optional(),
  regeneration_prompt_template_mode: PromptModeSchema.default('custom'),
  is_active: z.boolean().optional(),
}).refine((data) => {
  const hasReviewProvider = Boolean(data.review_provider)
  const hasReviewModel = Boolean(data.review_model_name?.trim())
  return hasReviewProvider === hasReviewModel
}, {
  message: '문제 검토 API 제공자와 모델은 함께 입력해주세요.',
}).refine((data) => {
  if (!data.review_provider || !data.review_model_name?.trim()) return true
  return data.review_prompt_template_mode !== 'disabled' &&
    data.review_output_format_mode !== 'disabled'
}, {
  message: '문제 검토 API를 사용하려면 문제 검토 프롬프트와 검토 후 응답구조 프롬프트를 기본값 사용 또는 개별 수정으로 설정해주세요.',
})

const DefaultPromptSchema = z.object({
  prompt_key: z.enum([
    'output_format',
    'review_prompt_template',
    'review_output_format',
    'regeneration_prompt_template',
  ]),
  content: z.string().refine((content) => content.trim().length > 0, {
    message: '기본 프롬프트 내용은 비워둘 수 없습니다.',
  }),
  is_enabled: z.boolean(),
})

function revalidateProblemTypePaths(workspaceSubject: WorkspaceSubject) {
  revalidatePath(`/admin/problem-types?subject=${workspaceSubject}`)
  revalidatePath('/generate', 'layout')
  revalidatePath(withWorkspacePrefix(DEFAULT_WORKSPACE_SUBJECT, '/generate'), 'layout')
  revalidatePath(withWorkspacePrefix(workspaceSubject, '/generate'), 'layout')
}

const readProblemTypeFormData = (formData: FormData) => ({
  workspace_subject: formData.get('workspace_subject'),
  type_name: formData.get('type_name'),
  description: formData.get('description'),
  generation_provider: formData.get('generation_provider'),
  generation_model_name: formData.get('generation_model_name'),
  review_provider: formData.get('review_provider'),
  review_model_name: formData.get('review_model_name'),
  prompt_template: formData.get('prompt_template'),
  output_format: formData.get('output_format'),
  output_format_mode: formData.get('output_format_mode') || 'custom',
  review_prompt_template: formData.get('review_prompt_template'),
  review_prompt_template_mode: formData.get('review_prompt_template_mode') || 'custom',
  review_output_format: formData.get('review_output_format'),
  review_output_format_mode: formData.get('review_output_format_mode') || 'custom',
  regeneration_prompt_template: formData.get('regeneration_prompt_template'),
  regeneration_prompt_template_mode: formData.get('regeneration_prompt_template_mode') || 'custom',
  is_active: formData.get('is_active') === 'on',
})

const buildProblemTypePayload = (data: z.infer<typeof ProblemTypeSchema>, workspaceSubject: WorkspaceSubject) => ({
  workspace_subject: workspaceSubject,
  type_name: data.type_name,
  description: data.description || null,
  provider: data.generation_provider,
  model_name: data.generation_model_name,
  generation_provider: data.generation_provider,
  generation_model_name: data.generation_model_name,
  review_provider: data.review_provider || null,
  review_model_name: data.review_model_name?.trim() || null,
  prompt_template: data.prompt_template,
  output_format: data.output_format || null,
  output_format_mode: data.output_format_mode,
  review_prompt_template: data.review_prompt_template || null,
  review_prompt_template_mode: data.review_prompt_template_mode,
  review_output_format: data.review_output_format || null,
  review_output_format_mode: data.review_output_format_mode,
  regeneration_prompt_template: data.regeneration_prompt_template || null,
  regeneration_prompt_template_mode: data.regeneration_prompt_template_mode,
  is_active: data.is_active,
})

export async function createProblemType(_prevState: unknown, formData: FormData) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const validated = ProblemTypeSchema.safeParse(readProblemTypeFormData(formData))

  if (!validated.success) {
    return { error: validated.error.issues?.[0]?.message || 'Validation failed' }
  }

  const workspaceSubject = resolveAdminWorkspaceSubject(validated.data.workspace_subject)
  const { error } = await supabase
    .from('problem_types')
    .insert({
      ...buildProblemTypePayload(validated.data, workspaceSubject),
      provider: validated.data.generation_provider,
      model_name: validated.data.generation_model_name,
    })

  if (error) {
    return { error: error.message }
  }

  revalidateProblemTypePaths(workspaceSubject)
  return { success: true }
}

export async function updateProblemType(id: string, _prevState: unknown, formData: FormData) {
  const supabase = await createClient()

  const validated = ProblemTypeSchema.safeParse(readProblemTypeFormData(formData))

  if (!validated.success) {
    return { error: validated.error.issues?.[0]?.message || 'Validation failed' }
  }

  const workspaceSubject = resolveAdminWorkspaceSubject(validated.data.workspace_subject)
  const { error } = await supabase
    .from('problem_types')
    .update({
      ...buildProblemTypePayload(validated.data, workspaceSubject),
      provider: validated.data.generation_provider,
      model_name: validated.data.generation_model_name,
    })
    .eq('id', id)
    .eq('workspace_subject', workspaceSubject)

  if (error) {
    return { error: error.message }
  }

  revalidateProblemTypePaths(workspaceSubject)
  return { success: true }
}

export async function deleteProblemType(id: string) {
  const supabase = await createClient()

  const { data: current } = await supabase
    .from('problem_types')
    .select('workspace_subject')
    .eq('id', id)
    .maybeSingle()

  const workspaceSubject = resolveAdminWorkspaceSubject(current?.workspace_subject)

  const { error } = await supabase
    .from('problem_types')
    .delete()
    .eq('id', id)
    .eq('workspace_subject', workspaceSubject)

  if (error) {
    return { error: error.message }
  }

  revalidateProblemTypePaths(workspaceSubject)
  return { success: true }
}

export async function updateProblemTypeDefaultPrompts(
  workspaceSubject: WorkspaceSubject,
  prompts: Array<z.infer<typeof DefaultPromptSchema>>
) {
  const supabase = await createClient()
  const validatedPrompts = z.array(DefaultPromptSchema).safeParse(prompts)

  if (!validatedPrompts.success) {
    return { error: validatedPrompts.error.issues?.[0]?.message || 'Validation failed' }
  }

  const promptRows = validatedPrompts.data.map((prompt) => {
    const meta = PROMPT_DEFAULT_KEYS.find((item) => item.key === prompt.prompt_key)

    return {
      workspace_subject: workspaceSubject,
      prompt_key: prompt.prompt_key,
      display_name: meta?.displayName || prompt.prompt_key,
      description: meta?.description || null,
      content: prompt.content.trim(),
      is_enabled: prompt.is_enabled,
      sort_order: meta?.sortOrder || 0,
      updated_at: new Date().toISOString(),
    }
  })

  const { error } = await supabase
    .from('problem_type_default_prompts')
    .upsert(promptRows, { onConflict: 'workspace_subject,prompt_key' })

  if (error) {
    return { error: error.message }
  }

  revalidateProblemTypePaths(workspaceSubject)
  return { success: true }
}
