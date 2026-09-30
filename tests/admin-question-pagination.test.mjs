import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { normalizeListPage } from '../src/lib/list-pagination.ts'

function route({ loggedIn = true, admin = true } = {}) {
  const calls = []
  const supabase = {
    auth: { getUser: async () => ({ data: { user: loggedIn ? { id: 'fixture' } : null } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { is_admin: admin } }) }) }) }),
    rpc: async (name, args) => {
      calls.push(args)
      return { data: Array.from({ length: Math.min(args.p_limit, 64 - args.p_offset) }, (_, i) => ({ id: `question-${args.p_offset + i}`, total_count: 64 })), error: null }
    },
  }
  const mocks = {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/supabase/server': { createClient: async () => supabase },
    '@/lib/admin-workspace': { resolveAdminWorkspaceSubject: () => 'korean' },
    '@/lib/list-pagination': { normalizeListPage },
    '@/lib/question-bank/validation': { isUuidishString: () => true },
  }
  const source = readFileSync(new URL('../src/app/api/admin/questions/route.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const loaded = { exports: {} }
  new Function('require', 'exports', outputText)((name) => mocks[name], loaded.exports)
  return { ...loaded.exports, calls }
}

test('admin question list clamps before computing database offset', async () => {
  const app = route()
  const response = await app.GET({ nextUrl: new URL(`http://localhost/api/admin/questions?page=${Number.MAX_SAFE_INTEGER}`) })
  const data = await response.json()
  assert.equal(response.status, 200)
  assert.equal(data.pagination.page, 4)
  assert.equal(data.questions.length, 4)
  assert.equal(app.calls[0].p_offset, 0)
  assert.equal(app.calls[1].p_offset, 60)
  assert.ok(app.calls.every((call) => call.p_workspace_subject === 'korean'))
  assert.equal('total_count' in data.questions[0], false)
})

test('pagination does not bypass authentication or admin authorization', async () => {
  for (const [options, expected] of [[{ loggedIn: false }, 401], [{ admin: false }, 403]]) {
    const app = route(options)
    assert.equal((await app.GET({ nextUrl: new URL('http://localhost/api/admin/questions?page=2') })).status, expected)
    assert.deepEqual(app.calls, [])
  }
})
