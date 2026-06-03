import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import {
  DEFAULT_REGENERATION_REQUEST_PROMPT,
  DEFAULT_RESPONSE_STRUCTURE_PROMPT,
  DEFAULT_REVIEW_PROMPT,
  DEFAULT_REVIEW_RESPONSE_STRUCTURE_PROMPT,
  splitReviewPromptTemplate,
} from './question-prompts'

export type PromptDefaultKey =
  | 'output_format'
  | 'review_prompt_template'
  | 'review_output_format'
  | 'regeneration_prompt_template'

export type PromptMode = 'default' | 'custom' | 'disabled'
export type ProblemTypeDefaultPrompt = Database['public']['Tables']['problem_type_default_prompts']['Row']

export const PROMPT_DEFAULT_KEYS = [
  {
    key: 'output_format',
    modeField: 'output_format_mode',
    displayName: '응답 구조 프롬프트',
    description: '문제 생성 API가 반환할 JSON 응답 구조를 정의합니다.',
    fallback: DEFAULT_RESPONSE_STRUCTURE_PROMPT,
    sortOrder: 10,
  },
  {
    key: 'review_prompt_template',
    modeField: 'review_prompt_template_mode',
    displayName: '문제 검토 프롬프트',
    description: '생성된 문제가 지문과 문제 생성 프롬프트를 따랐는지 검토하는 기준입니다.',
    fallback: DEFAULT_REVIEW_PROMPT,
    sortOrder: 20,
  },
  {
    key: 'review_output_format',
    modeField: 'review_output_format_mode',
    displayName: '검토 후 응답구조 프롬프트',
    description: '문제 검토 API가 반환할 JSON 응답 구조를 정의합니다.',
    fallback: DEFAULT_REVIEW_RESPONSE_STRUCTURE_PROMPT,
    sortOrder: 30,
  },
  {
    key: 'regeneration_prompt_template',
    modeField: 'regeneration_prompt_template_mode',
    displayName: '미 통과시 문제생성 요청 프롬프트',
    description: '검토 미통과 시 이전 문제와 피드백을 반영해 재생성하도록 요청합니다.',
    fallback: DEFAULT_REGENERATION_REQUEST_PROMPT,
    sortOrder: 40,
  },
] as const

type ProblemTypePromptSource = {
  prompt_template: string
  output_format?: string | null
  output_format_mode?: string | null
  review_prompt_template?: string | null
  review_prompt_template_mode?: string | null
  review_output_format?: string | null
  review_output_format_mode?: string | null
  regeneration_prompt_template?: string | null
  regeneration_prompt_template_mode?: string | null
}

export function normalizePromptMode(mode?: string | null): PromptMode {
  if (mode === 'default' || mode === 'disabled') return mode
  return 'custom'
}

export async function getProblemTypeDefaultPrompts(
  supabase: Pick<SupabaseClient<Database>, 'from'>,
  workspaceSubject: WorkspaceSubject
) {
  const { data, error } = await supabase
    .from('problem_type_default_prompts')
    .select('*')
    .eq('workspace_subject', workspaceSubject)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return data || []
}

const getDefaultPromptContent = (
  defaultPrompts: ProblemTypeDefaultPrompt[] | undefined,
  key: PromptDefaultKey
) => defaultPrompts?.find((prompt) => prompt.prompt_key === key)?.content.trim()

export function resolvePromptField(input: {
  mode?: string | null
  customValue?: string | null
  defaultValue?: string | null
  legacyFallback: string
}) {
  const mode = normalizePromptMode(input.mode)

  if (mode === 'disabled') return ''
  if (mode === 'default') return input.defaultValue?.trim() || input.legacyFallback

  return input.customValue?.trim() || input.legacyFallback
}

export function resolveProblemTypePromptBundle(
  problemType: ProblemTypePromptSource,
  defaultPrompts?: ProblemTypeDefaultPrompt[]
) {
  const reviewPromptMode = normalizePromptMode(problemType.review_prompt_template_mode)
  const reviewOutputFormatMode = normalizePromptMode(problemType.review_output_format_mode)

  const reviewPromptSource = resolvePromptField({
    mode: problemType.review_prompt_template_mode,
    customValue: problemType.review_prompt_template,
    defaultValue: getDefaultPromptContent(defaultPrompts, 'review_prompt_template'),
    legacyFallback: DEFAULT_REVIEW_PROMPT,
  })
  const reviewOutputFormatSource = resolvePromptField({
    mode: problemType.review_output_format_mode,
    customValue: problemType.review_output_format,
    defaultValue: getDefaultPromptContent(defaultPrompts, 'review_output_format'),
    legacyFallback: DEFAULT_REVIEW_RESPONSE_STRUCTURE_PROMPT,
  })
  const reviewPrompts = splitReviewPromptTemplate(reviewPromptSource, reviewOutputFormatSource)

  return {
    generationPrompt: problemType.prompt_template,
    responseStructurePrompt: resolvePromptField({
      mode: problemType.output_format_mode,
      customValue: problemType.output_format,
      defaultValue: getDefaultPromptContent(defaultPrompts, 'output_format'),
      legacyFallback: DEFAULT_RESPONSE_STRUCTURE_PROMPT,
    }),
    reviewPrompt: reviewPromptMode === 'disabled' ? '' : reviewPrompts.reviewPrompt,
    reviewResponseStructurePrompt: reviewOutputFormatMode === 'disabled' ? '' : reviewPrompts.reviewResponseStructurePrompt,
    regenerationPrompt: resolvePromptField({
      mode: problemType.regeneration_prompt_template_mode,
      customValue: problemType.regeneration_prompt_template,
      defaultValue: getDefaultPromptContent(defaultPrompts, 'regeneration_prompt_template'),
      legacyFallback: DEFAULT_REGENERATION_REQUEST_PROMPT,
    }),
  }
}
