import fs from 'node:fs'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

const root = process.cwd()

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !path.extname(specifier)) {
      const parentDirectory = context.parentURL
        ? path.dirname(new URL(context.parentURL).pathname)
        : root
      const relativeCandidates = [
        path.join(parentDirectory, `${specifier}.ts`),
        path.join(parentDirectory, `${specifier}.tsx`),
        path.join(parentDirectory, specifier, 'index.ts'),
        path.join(parentDirectory, specifier, 'index.tsx'),
      ]

      for (const candidate of relativeCandidates) {
        if (fs.existsSync(candidate)) {
          return nextResolve(pathToFileURL(candidate).href, context)
        }
      }
    }

    if (!specifier.startsWith('@/')) {
      return nextResolve(specifier, context)
    }

    const relativePath = specifier.slice(2)
    const candidates = [
      path.join(root, 'src', `${relativePath}.ts`),
      path.join(root, 'src', `${relativePath}.tsx`),
      path.join(root, 'src', relativePath, 'index.ts'),
      path.join(root, 'src', relativePath, 'index.tsx'),
    ]

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return nextResolve(pathToFileURL(candidate).href, context)
      }
    }

    return nextResolve(specifier, context)
  },
})
