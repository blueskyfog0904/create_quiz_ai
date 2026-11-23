import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)

// TS 소스를 CommonJS로 변환해 mocks로 의존성을 바꿔 불러온다(tests/site-logo.test.mjs와 같은 방식).
// 의존성이 없는 순수 규칙 모듈은 가짜 없이 실제 파일을 쓴다(8번 market-refund-rules: 마감·차단 범위).
const PURE_MODULES = {
  '@/lib/market-refund-rules': () => load('src/lib/market-refund-rules.ts'),
}

export function load(path, mocks = {}, errors = []) {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  })
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', 'console', outputText)(
    (name) => mocks[name] ?? PURE_MODULES[name]?.() ?? require(name), loaded, loaded.exports, { error: (...args) => errors.push(args) }
  )
  return loaded.exports
}

export class NextResponse extends Response {
  static json(data, init) {
    return new NextResponse(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json' } })
  }
}

export const marketImages = load('src/lib/market-images.ts')
const readAllQueryRows = load('src/lib/read-all-query-rows.ts')

// 쿼리 빌더 호출을 ops로 기록하고, await 시점에 handler({ table, ops })의 결과를 돌려준다.
export function createFakeAdmin(handler, { rpc, upload, remove } = {}) {
  const calls = []
  const builder = (table) => {
    const ops = []
    const query = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'then') {
          calls.push({ type: 'query', table, ops })
          const result = Promise.resolve().then(() => handler({ table, ops }))
          return (resolve, reject) => result.then(resolve, reject)
        }
        return (...args) => {
          ops.push([prop, ...args])
          return query
        }
      },
    })
    return query
  }
  const client = {
    from: builder,
    rpc: async (name, args) => {
      calls.push({ type: 'rpc', name, args })
      return rpc ? rpc(name, args) : { data: null, error: null }
    },
    storage: {
      from: (bucket) => ({
        async upload(path, body, options) {
          calls.push({ type: 'upload', bucket, path, body, options })
          return { error: upload ? upload(path) : null }
        },
        async remove(paths) {
          calls.push({ type: 'remove', bucket, paths })
          return { error: remove ? remove(paths) : null }
        },
        getPublicUrl(path) {
          return { data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/${bucket}/${path}` } }
        },
      }),
    },
  }
  return { client, calls }
}

export function op(ops, name) {
  return ops.find(([opName]) => opName === name)
}

const DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000001'
const adminPermissions = load('src/lib/admin-permissions.ts')

// 가짜 세션 클라이언트. 공용 가드가 읽는 profiles(is_admin, admin_role)와 admin_permission_grants에 답한다.
// 관리자는 따로 정하지 않으면 대표(owner)다. role: 'staff'와 grants([{ permission, limits }])로 직원 계정을 흉내 낸다.
export function createFakeSessionClient({ loggedIn = true, isAdmin = true, userId = DEFAULT_USER_ID, role = 'owner', grants = [] } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: loggedIn ? { id: userId } : null } }) },
    from: (table) => {
      const result = table === 'admin_permission_grants'
        ? { data: grants, error: null }
        : { data: { is_admin: isAdmin, admin_role: isAdmin ? role : null }, error: null }
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => result,
        maybeSingle: async () => result,
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      }
      return query
    },
  }
}

// 공용 가드 모듈(admin-permissions-server)을 가짜 세션으로 실제로 돌린다. route·액션을 불러올 때 mocks에 펼쳐 넣는다.
// client를 주면 그 세션 클라이언트로 판정한다(테스트가 직접 만든 가짜 세션을 그대로 쓸 때).
export function adminGuardMocks(session = {}, errors = []) {
  const client = session.client ?? createFakeSessionClient(session)
  const server = load('src/lib/admin-permissions-server.ts', {
    react: { cache: (fn) => fn },
    'next/navigation': { redirect: (path) => { throw new Error(`NEXT_REDIRECT:${path}`) } },
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/admin-permissions': adminPermissions,
  }, errors)
  return {
    '@/lib/admin-permissions': adminPermissions,
    '@/lib/admin-permissions-server': server,
    // 관리자 동작은 성공 뒤 작업 기록(U3-5)을 남긴다. 기록을 보는 테스트는 이 값을 덮어쓴다.
    '@/lib/admin-audit-log-server': { recordAdminAudit: async () => true, alertAdminAuditFailure: async () => {} },
  }
}

// 라우트 파일을 가짜 인증·서비스 롤 클라이언트로 불러온다. mocks는 라우트가 쓰는 다른 모듈을 바꾼다.
export function loadRoute(path, { loggedIn = true, isAdmin = true, admin, userId = DEFAULT_USER_ID, role, grants, mocks = {} } = {}) {
  const errors = []
  const revalidations = []
  const authClient = createFakeSessionClient({ loggedIn, isAdmin, userId, role, grants })
  const common = {
    'server-only': {},
    'next/server': { NextResponse },
    'next/cache': { revalidateTag: (...args) => revalidations.push(args) },
    '@/lib/supabase/server': { createClient: async () => authClient },
    ...adminGuardMocks({ client: authClient }, errors),
    '@/lib/supabase/bypass': { createAdminClient: () => admin?.client },
    '@/lib/read-all-query-rows': readAllQueryRows,
    '@/lib/market-images': marketImages,
  }
  const server = load('src/lib/market-images-server.ts', common, errors)
  const route = load(path, { ...common, '@/lib/market-images-server': server, ...mocks }, errors)
  return { route, server, errors, revalidations }
}
