import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)

// TS 소스를 CommonJS로 변환해 mocks로 의존성을 바꿔 불러온다(tests/site-logo.test.mjs와 같은 방식).
export function load(path, mocks = {}, errors = []) {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  })
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', 'console', outputText)(
    (name) => mocks[name] ?? require(name), loaded, loaded.exports, { error: (...args) => errors.push(args) }
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

// 라우트 파일을 가짜 인증·서비스 롤 클라이언트로 불러온다.
export function loadRoute(path, { loggedIn = true, isAdmin = true, admin, userId = '00000000-0000-4000-8000-000000000001' } = {}) {
  const errors = []
  const authClient = {
    auth: { getUser: async () => ({ data: { user: loggedIn ? { id: userId } : null } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { is_admin: isAdmin } }) }) }) }),
  }
  const common = {
    'server-only': {},
    'next/server': { NextResponse },
    '@/lib/supabase/server': { createClient: async () => authClient },
    '@/lib/supabase/bypass': { createAdminClient: () => admin.client },
    '@/lib/read-all-query-rows': readAllQueryRows,
    '@/lib/market-images': marketImages,
  }
  const server = load('src/lib/market-images-server.ts', common, errors)
  const route = load(path, { ...common, '@/lib/market-images-server': server }, errors)
  return { route, server, errors }
}
