import assert from 'node:assert/strict'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'

const RUN_INTEGRATION = process.env.RUN_SUPABASE_INTEGRATION === '1'
const requiredEnv = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'QUESTION_BANK_TEST_USER_EMAIL',
  'QUESTION_BANK_TEST_USER_PASSWORD',
  'QUESTION_BANK_TEST_ADMIN_EMAIL',
  'QUESTION_BANK_TEST_ADMIN_PASSWORD'
]
const missingEnv = requiredEnv.filter((key) => !process.env[key])
const integrationTest = RUN_INTEGRATION && missingEnv.length === 0 ? test : test.skip
const skipReason = RUN_INTEGRATION
  ? `Missing integration env: ${missingEnv.join(', ')}. Required: ${requiredEnv.join(', ')}`
  : 'Set RUN_SUPABASE_INTEGRATION=1 with local/test Supabase credentials to run question-bank RPC integration tests'

const workspaceSubject = 'english'
const runId = `qb-${Date.now()}-${Math.random().toString(16).slice(2)}`
let nextQuestionBankYear = 2000
const nextYear = () => nextQuestionBankYear++

const createSupabase = (key) => createClient(process.env.SUPABASE_URL, key, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

const signIn = async (email, password) => {
  const client = createSupabase(process.env.SUPABASE_ANON_KEY)
  const { data, error } = await client.auth.signInWithPassword({ email, password })

  assert.ifError(error)
  assert.ok(data.session?.access_token, `Expected session for ${email}`)

  return client
}

const expectRpcError = async (promise, expectedMessage) => {
  const { error } = await promise

  assert.ok(error, `Expected RPC to fail with ${expectedMessage}`)
  assert.match(error.message, new RegExp(expectedMessage))
}


const upsertQuestionBankYear = async (service, { label, sortOrder, isActive }) => {
  const { data, error } = await service
    .from('question_bank_years')
    .upsert({
      workspace_subject: workspaceSubject,
      year: nextYear(),
      label,
      sort_order: sortOrder,
      is_active: isActive
    }, { onConflict: 'workspace_subject,year' })
    .select('id')
    .single()

  assert.ifError(error)

  return data
}

const upsertQuestionBankBook = async (service, { name, slug, description, sortOrder, isActive }) => {
  const { data, error } = await service
    .from('question_bank_books')
    .upsert({
      workspace_subject: workspaceSubject,
      name,
      slug,
      description,
      sort_order: sortOrder,
      is_active: isActive
    }, { onConflict: 'workspace_subject,slug' })
    .select('id')
    .single()

  assert.ifError(error)

  return data
}

const ensureSeedProfile = async (service, userId, isAdmin) => {
  const { error } = await service
    .from('profiles')
    .upsert({
      id: userId,
      email: `${runId}-${userId}@example.test`,
      is_admin: isAdmin
    }, { onConflict: 'id' })

  assert.ifError(error)
}

const createSeedContext = async () => {
  const service = createSupabase(process.env.SUPABASE_SERVICE_ROLE_KEY)
  const user = await signIn(
    process.env.QUESTION_BANK_TEST_USER_EMAIL,
    process.env.QUESTION_BANK_TEST_USER_PASSWORD
  )
  const admin = await signIn(
    process.env.QUESTION_BANK_TEST_ADMIN_EMAIL,
    process.env.QUESTION_BANK_TEST_ADMIN_PASSWORD
  )
  const { data: userSession } = await user.auth.getUser()
  const { data: adminSession } = await admin.auth.getUser()
  const userId = userSession.user.id
  const adminId = adminSession.user.id

  await ensureSeedProfile(service, userId, false)
  await ensureSeedProfile(service, adminId, true)

  const { data: problemType, error: problemTypeError } = await service
    .from('problem_types')
    .insert({
      type_name: `${runId} 빈칸`,
      description: 'question bank integration seed',
      provider: 'openai',
      model_name: 'test-model',
      prompt_template: 'test prompt',
      output_format: 'json',
      is_active: true,
      workspace_subject: workspaceSubject
    })
    .select('id')
    .single()

  assert.ifError(problemTypeError)

  return { service, user, admin, userId, adminId, problemTypeId: problemType.id }
}

if (!RUN_INTEGRATION || missingEnv.length > 0) {
  test('question-bank RPC integration tests are explicitly env-gated', { skip: skipReason }, () => {})
}

integrationTest('RLS allows active dimension reads and blocks inactive/write access for normal users', async () => {
  const { service, user } = await createSeedContext()
  const activeYear = await upsertQuestionBankYear(service, {
    label: `${runId} active year`,
    sortOrder: 1,
    isActive: true
  })
  const inactiveYear = await upsertQuestionBankYear(service, {
    label: `${runId} inactive year`,
    sortOrder: 2,
    isActive: false
  })

  const { data: visibleYears, error: visibleError } = await user
    .from('question_bank_years')
    .select('id')
    .in('id', [activeYear.id, inactiveYear.id])

  assert.ifError(visibleError)
  assert.deepEqual(visibleYears.map((row) => row.id), [activeYear.id])

  const { error: writeError } = await user
    .from('question_bank_years')
    .insert({ workspace_subject: workspaceSubject, year: nextYear(), label: `${runId} forbidden`, sort_order: 9, is_active: true })

  assert.ok(writeError, 'normal users must not write years')
})

integrationTest('anon RPC calls are denied by execute permission or HTTP authorization', async () => {
  const anon = createSupabase(process.env.SUPABASE_ANON_KEY)
  const { error } = await anon.rpc('get_question_bank_availability', {
    p_workspace_subject: workspaceSubject,
    p_year_id: '00000000-0000-0000-0000-000000000000',
    p_book_id: '00000000-0000-0000-0000-000000000000'
  })

  assert.ok(error, 'anon RPC should fail')
  assert.ok(
    /permission denied|401|403|JWT|not authorized|AUTH_REQUIRED/i.test(error.message),
    `unexpected anon RPC error: ${error.message}`
  )
})

integrationTest('non-admin RPC attempts fail with ADMIN_REQUIRED', async () => {
  const { user } = await createSeedContext()
  const adminOnlyCalls = [
    ['create_admin_bank_question', { p_workspace_subject: workspaceSubject, p_question: {}, p_year_id: '00000000-0000-0000-0000-000000000000', p_book_id: '00000000-0000-0000-0000-000000000000' }],
    ['create_admin_bank_questions_bulk', { p_workspace_subject: workspaceSubject, p_questions: [] }],
    ['update_admin_bank_question', { p_question_id: '00000000-0000-0000-0000-000000000000', p_workspace_subject: workspaceSubject, p_question_patch: {}, p_year_id: '00000000-0000-0000-0000-000000000000', p_book_id: '00000000-0000-0000-0000-000000000000' }],
    ['backfill_question_bank_metadata', { p_workspace_subject: workspaceSubject, p_source_question_ids: [], p_year_id: '00000000-0000-0000-0000-000000000000', p_book_id: '00000000-0000-0000-0000-000000000000' }],
    ['admin_audit_question_bank_metadata', { p_workspace_subject: workspaceSubject, p_filter: {} }],
    ['admin_list_question_bank_backfill_candidates', { p_workspace_subject: workspaceSubject, p_filter: {}, p_limit: 10, p_offset: 0 }],
    ['admin_list_bank_questions', { p_workspace_subject: workspaceSubject }]
  ]

  for (const [fn, args] of adminOnlyCalls) {
    await expectRpcError(user.rpc(fn, args), 'ADMIN_REQUIRED')
  }
})

integrationTest('normal users can read admin_uploaded bank questions but cannot mutate them or direct metadata', async () => {
  const { service, user, adminId, problemTypeId } = await createSeedContext()
  const { data: question, error: insertError } = await service
    .from('questions')
    .insert({
      user_id: adminId,
      source: 'admin_uploaded',
      workspace_subject: workspaceSubject,
      question_text: `${runId} admin visible`,
      choices: [],
      answer: 'A',
      problem_type_id: problemTypeId
    })
    .select('id')
    .single()

  assert.ifError(insertError)

  const { data: visibleRows, error: selectError } = await user
    .from('questions')
    .select('id')
    .eq('id', question.id)
    .eq('source', 'admin_uploaded')
    .eq('workspace_subject', workspaceSubject)

  assert.ifError(selectError)
  assert.equal(visibleRows.length, 1)

  const { error: updateError } = await user
    .from('questions')
    .update({ answer: 'B' })
    .eq('id', question.id)

  assert.ok(updateError, 'normal users must not update admin_uploaded rows')

  const { error: metadataInsertError } = await user
    .from('question_bank_question_metadata')
    .insert({ question_id: question.id, workspace_subject: workspaceSubject })

  assert.ok(metadataInsertError, 'normal users must not insert metadata directly')
})

integrationTest('admin create/update/bulk/backfill/copy/random-exam RPC flow preserves metadata and field parity', async () => {
  const { service, user, admin, problemTypeId } = await createSeedContext()
  const year = await upsertQuestionBankYear(service, {
    label: `${runId} 2027`,
    sortOrder: 1,
    isActive: true
  })
  const book = await upsertQuestionBankBook(service, {
    name: `${runId} book`,
    slug: `${runId}-book`,
    description: 'integration seed book',
    sortOrder: 1,
    isActive: true
  })

  const baseQuestion = {
    question_text: `${runId} question`,
    question_text_forward: 'forward',
    question_text_backward: 'backward',
    choices: [{ label: 'A', text: 'alpha' }],
    answer: 'A',
    explanation: 'because',
    passage_text: 'passage',
    grade_level: 'High1',
    difficulty: 'Medium',
    problem_type_id: problemTypeId,
    source_type: 'mock',
    source_1: '2027',
    source_2: '3월',
    source_3: '18번',
    source_4: 'variant',
    tags: ['seed'],
    rating: 2
  }
  const { data: adminQuestionId, error: createError } = await admin.rpc('create_admin_bank_question', {
    p_workspace_subject: workspaceSubject,
    p_question: baseQuestion,
    p_year_id: year.id,
    p_book_id: book.id
  })

  assert.ifError(createError)
  assert.ok(adminQuestionId)

  await expectRpcError(user.rpc('copy_admin_questions_to_user_bank', {
    p_workspace_subject: workspaceSubject,
    p_admin_question_ids: [adminQuestionId]
  }), 'permission denied|SERVICE_ROLE_REQUIRED')

  const { data: copyResult, error: copyError } = await service.rpc('copy_admin_questions_to_user_bank', {
    p_workspace_subject: workspaceSubject,
    p_admin_question_ids: [adminQuestionId],
    p_target_user_id: userId
  })

  assert.ifError(copyError)
  assert.equal(copyResult[0].saved_count, 1)
  assert.equal(copyResult[0].skipped_count, 0)

  const { data: duplicateCopy, error: duplicateError } = await service.rpc('copy_admin_questions_to_user_bank', {
    p_workspace_subject: workspaceSubject,
    p_admin_question_ids: [adminQuestionId],
    p_target_user_id: userId
  })

  assert.ifError(duplicateError)
  assert.equal(duplicateCopy[0].saved_count, 0)
  assert.equal(duplicateCopy[0].skipped_count, 1)

  const { data: availability, error: availabilityError } = await user.rpc('get_question_bank_availability', {
    p_workspace_subject: workspaceSubject,
    p_year_id: year.id,
    p_book_id: book.id
  })

  assert.ifError(availabilityError)
  assert.equal(availability.find((row) => row.problem_type_id === problemTypeId)?.available_count, 1)

  const { data: paperResult, error: paperError } = await user.rpc('create_random_bank_exam_paper', {
    p_workspace_subject: workspaceSubject,
    p_title: `${runId} paper`,
    p_year_id: year.id,
    p_book_id: book.id,
    p_type_counts: [{ problemTypeId, count: 1 }]
  })

  assert.ifError(paperError)
  assert.equal(paperResult[0].total_count, 1)

  await expectRpcError(user.rpc('create_random_bank_exam_paper', {
    p_workspace_subject: workspaceSubject,
    p_title: `${runId} duplicate type`,
    p_year_id: year.id,
    p_book_id: book.id,
    p_type_counts: [{ problemTypeId, count: 1 }, { problemTypeId, count: 1 }]
  }), 'DUPLICATE_TYPE')

  await expectRpcError(user.rpc('create_random_bank_exam_paper', {
    p_workspace_subject: workspaceSubject,
    p_title: `${runId} over limit`,
    p_year_id: year.id,
    p_book_id: book.id,
    p_type_counts: [{ problemTypeId, count: 101 }]
  }), 'COUNT_LIMIT_EXCEEDED')

  await expectRpcError(user.rpc('create_random_bank_exam_paper', {
    p_workspace_subject: workspaceSubject,
    p_title: `${runId} insufficient`,
    p_year_id: year.id,
    p_book_id: book.id,
    p_type_counts: [{ problemTypeId, count: 2 }]
  }), 'INSUFFICIENT_QUESTIONS')

  const { error: updateError } = await admin.rpc('update_admin_bank_question', {
    p_question_id: adminQuestionId,
    p_workspace_subject: workspaceSubject,
    p_question_patch: { difficulty: 'High' },
    p_year_id: year.id,
    p_book_id: book.id
  })

  assert.ifError(updateError)

  const { error: backfillError } = await admin.rpc('backfill_question_bank_metadata', {
    p_workspace_subject: workspaceSubject,
    p_source_question_ids: [adminQuestionId],
    p_year_id: year.id,
    p_book_id: book.id,
    p_dry_run: false
  })

  assert.ifError(backfillError)

  const { error: auditError } = await admin.rpc('admin_audit_question_bank_metadata', {
    p_workspace_subject: workspaceSubject,
    p_filter: {}
  })
  const { error: candidatesError } = await admin.rpc('admin_list_question_bank_backfill_candidates', {
    p_workspace_subject: workspaceSubject,
    p_filter: {},
    p_limit: 20,
    p_offset: 0
  })

  assert.ifError(auditError)
  assert.ifError(candidatesError)
})

integrationTest('bulk upload rolls back valid rows when any row is invalid', async () => {
  const { service, admin, problemTypeId } = await createSeedContext()
  const year = await upsertQuestionBankYear(service, {
    label: `${runId} bulk year`,
    sortOrder: 1,
    isActive: true
  })
  const inactiveBook = await upsertQuestionBankBook(service, {
    name: `${runId} inactive bulk book`,
    slug: `${runId}-inactive-bulk-book`,
    description: 'inactive integration seed book',
    sortOrder: 1,
    isActive: false
  })

  await expectRpcError(admin.rpc('create_admin_bank_questions_bulk', {
    p_workspace_subject: workspaceSubject,
    p_questions: [
      {
        clientRowId: 'valid-before-invalid',
        yearId: year.id,
        bookId: inactiveBook.id,
        question: {
          question_text: `${runId} should rollback`,
          choices: [],
          answer: 'A',
          problem_type_id: problemTypeId
        }
      }
    ]
  }), 'INACTIVE_DIMENSION')
})
