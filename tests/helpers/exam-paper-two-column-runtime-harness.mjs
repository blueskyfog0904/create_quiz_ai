import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const repoRootPath = fileURLToPath(new URL('../..', import.meta.url))
const runtimeQuery = () => `?t=${Date.now()}-${Math.random().toString(36).slice(2)}`

const exportUtilsSource = readFileSync(
  new URL('../../src/lib/export-utils.ts', import.meta.url),
  'utf8'
)
const layoutContractSource = readFileSync(
  new URL('../../src/lib/exam-paper-layout-contract.ts', import.meta.url),
  'utf8'
)
const singleColumnLayoutSource = readFileSync(
  new URL('../../src/lib/exam-paper-single-column-layout.ts', import.meta.url),
  'utf8'
)
const measurementSource = readFileSync(
  new URL('../../src/lib/exam-paper-two-column-measurement.ts', import.meta.url),
  'utf8'
)
const normalizeQuestionFieldSource = readFileSync(
  new URL('../../src/lib/questions/normalize-question-field.ts', import.meta.url),
  'utf8'
)
const paginationSource = readFileSync(
  new URL('../../src/lib/exam-paper-pdf-pagination.js', import.meta.url),
  'utf8'
)

function buildResolutionRoots() {
  const roots = new Set([process.cwd(), repoRootPath])

  for (const root of [...roots]) {
    let current = root

    while (current && current !== '/') {
      roots.add(current)
      const parent = fileURLToPath(new URL('..', pathToFileURL(`${current}/`)))
      if (parent === current) {
        break
      }
      current = parent
    }
  }

  return [...roots]
}

function resolveInstalledPackage(specifier) {
  try {
    return require.resolve(specifier)
  } catch {
    for (const root of buildResolutionRoots()) {
      try {
        return require.resolve(specifier, { paths: [root] })
      } catch {
        // Try the next candidate root.
      }
    }
  }

  throw new Error(
    `Unable to resolve ${specifier} from active install. Tried ${buildResolutionRoots().join(', ')}`
  )
}

function loadTypeScript() {
  return require(resolveInstalledPackage('typescript'))
}

async function loadPlaywright() {
  const playwrightModuleUrl = pathToFileURL(resolveInstalledPackage('playwright')).href
  const playwrightModule = await import(playwrightModuleUrl)
  return playwrightModule.default ?? playwrightModule
}

function transpileTypeScript(source) {
  const ts = loadTypeScript()

  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
}

function stubBrowserOnlyDependencies(source) {
  return source
    .replace(
      /import pdfMake from 'pdfmake\/build\/pdfmake'\n/g,
      'const pdfMake = {}\n'
    )
    .replace(
      /import \* as pdfFonts from 'pdfmake\/build\/vfs_fonts'\n/g,
      'const pdfFonts = {}\n'
    )
    .replace(
      /import \{ Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, UnderlineType \} from 'docx'\n/g,
      [
        'class Document { constructor(args) { this.args = args } }',
        'const Packer = { toBlob: async () => new Blob() }',
        'class Paragraph { constructor(args) { this.args = args } }',
        'class TextRun { constructor(args) { this.args = args } }',
        "const AlignmentType = { CENTER: 'center' }",
        "const HeadingLevel = { HEADING_1: 'heading-1' }",
        "const UnderlineType = { SINGLE: 'single' }",
        '',
      ].join('\n')
    )
    .replace(
      /import \{ saveAs \} from 'file-saver'\n/g,
      'const saveAs = () => {}\n'
    )
}

function buildRuntimeModules({ includeMeasurement = false } = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-two-column-runtime-'))
  const runtimeFiles = {
    pagination: 'exam-paper-pdf-pagination.runtime.mjs',
    normalize: 'normalize-question-field.runtime.mjs',
    singleColumn: 'exam-paper-single-column-layout.runtime.mjs',
    layoutContract: 'exam-paper-layout-contract.runtime.mjs',
    exportUtils: 'export-utils.runtime.mjs',
    measurement: 'exam-paper-two-column-measurement.runtime.mjs',
  }

  writeFileSync(join(tempDir, runtimeFiles.pagination), paginationSource)
  writeFileSync(
    join(tempDir, runtimeFiles.normalize),
    transpileTypeScript(normalizeQuestionFieldSource)
  )
  writeFileSync(
    join(tempDir, runtimeFiles.singleColumn),
    transpileTypeScript(
      singleColumnLayoutSource
        .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, `./${runtimeFiles.pagination}`)
        .replace(/@\/lib\/questions\/normalize-question-field/g, `./${runtimeFiles.normalize}`)
    )
  )
  writeFileSync(
    join(tempDir, runtimeFiles.layoutContract),
    transpileTypeScript(
      layoutContractSource
        .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, `./${runtimeFiles.pagination}`)
        .replace(/@\/lib\/questions\/normalize-question-field/g, `./${runtimeFiles.normalize}`)
    )
  )
  writeFileSync(
    join(tempDir, runtimeFiles.exportUtils),
    transpileTypeScript(
      stubBrowserOnlyDependencies(exportUtilsSource)
        .replace(/from '@\/lib\/exam-paper-layout-contract'/g, `from './${runtimeFiles.layoutContract}'`)
        .replace(/from '@\/lib\/exam-paper-single-column-layout'/g, `from './${runtimeFiles.singleColumn}'`)
        .replace(/from '@\/lib\/questions\/normalize-question-field'/g, `from './${runtimeFiles.normalize}'`)
    )
  )

  if (includeMeasurement) {
    writeFileSync(
      join(tempDir, runtimeFiles.measurement),
      transpileTypeScript(
        measurementSource
          .replace(/from '@\/lib\/export-utils'/g, `from './${runtimeFiles.exportUtils}'`)
          .replace(/from '@\/lib\/exam-paper-pdf-pagination\.js'/g, `from './${runtimeFiles.pagination}'`)
      )
    )
  }

  return {
    tempDir,
    runtimeFiles,
    moduleUrl(fileName) {
      return `${pathToFileURL(join(tempDir, fileName)).href}${runtimeQuery()}`
    },
  }
}

async function prepareMeasurementHarness() {
  const runtimeModules = buildRuntimeModules({ includeMeasurement: true })
  const htmlPath = join(runtimeModules.tempDir, 'runtime-harness.html')

  writeFileSync(
    htmlPath,
    `<!DOCTYPE html>
<html lang="ko">
  <body>
    <script type="module">
      window.__runtimeImportError = null

      Promise.all([
        import('./${runtimeModules.runtimeFiles.measurement}'),
        import('./${runtimeModules.runtimeFiles.exportUtils}'),
      ])
        .then(([
          { buildMeasuredTwoColumnPreviewPages },
          { buildExamPaperPrintHtml },
        ]) => {
          window.__runMeasuredTwoColumnPreview = async (examPaper) => {
            const pages = await buildMeasuredTwoColumnPreviewPages({ examPaper })
            const bodyLineChunks = pages
              .flatMap((page) => page.columns.flat())
              .filter((chunk) => chunk.kind === 'body' && Number.isInteger(chunk.bodyLineIndex))

            return {
              pageCount: pages.length,
              bodyLineChunkCount: bodyLineChunks.length,
              firstBodyLineChunk: bodyLineChunks[0] ?? null,
            }
          }

          window.__runProductionMeasuredPathInBrowser = async (examPaper) => {
            const pages = await buildMeasuredTwoColumnPreviewPages({ examPaper })
            const bodyLineChunks = pages
              .flatMap((page) => page.columns.flat())
              .filter((chunk) => chunk.kind === 'body' && Number.isInteger(chunk.bodyLineIndex))

            return {
              pageCount: pages.length,
              bodyLineChunkCount: bodyLineChunks.length,
              html: buildExamPaperPrintHtml(examPaper, {
                twoColumnMeasuredPages: pages,
              }),
            }
          }
        })
        .catch((error) => {
          window.__runtimeImportError = {
            message: error?.message ?? String(error),
            stack: error?.stack ?? null,
          }
        })
    </script>
  </body>
</html>`
  )

  const server = createServer((request, response) => {
    const requestPath = request.url === '/' ? '/runtime-harness.html' : request.url ?? '/runtime-harness.html'
    const filePath = join(runtimeModules.tempDir, requestPath.replace(/^\//, ''))

    try {
      const fileStat = statSync(filePath)
      if (!fileStat.isFile()) {
        response.writeHead(404)
        response.end('Not found')
        return
      }

      const contentType = filePath.endsWith('.html')
        ? 'text/html; charset=utf-8'
        : 'application/javascript; charset=utf-8'

      response.writeHead(200, { 'content-type': contentType })
      response.end(readFileSync(filePath))
    } catch {
      response.writeHead(404)
      response.end('Not found')
    }
  })

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('expected browser runtime server to bind to a TCP port')
  }

  return {
    runtimeHarnessUrl: `http://127.0.0.1:${address.port}/runtime-harness.html`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    }),
  }
}

export async function withBrowserPage(run) {
  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch({ headless: true })

  try {
    const page = await browser.newPage()
    return await run(page)
  } finally {
    await browser.close()
  }
}

export async function loadRuntimeLayoutContract() {
  const runtimeModules = buildRuntimeModules()
  return import(runtimeModules.moduleUrl(runtimeModules.runtimeFiles.layoutContract))
}

export async function loadRuntimeExportUtils() {
  const runtimeModules = buildRuntimeModules()
  return import(runtimeModules.moduleUrl(runtimeModules.runtimeFiles.exportUtils))
}

async function runMeasurementHarnessMethod(methodName, examPaper) {
  const runtimeHarness = await prepareMeasurementHarness()

  try {
    return await withBrowserPage(async (page) => {
      await page.goto(runtimeHarness.runtimeHarnessUrl, { waitUntil: 'load' })
      await page.waitForFunction((name) => (
        typeof window[name] === 'function' ||
        window.__runtimeImportError !== null
      ), methodName)

      const importError = await page.evaluate(() => window.__runtimeImportError)
      assert.equal(importError, null, `expected runtime measurement module to load: ${JSON.stringify(importError)}`)

      return page.evaluate(
        async ({ name, runtimeExamPaper }) => window[name](runtimeExamPaper),
        { name: methodName, runtimeExamPaper: examPaper }
      )
    })
  } finally {
    await runtimeHarness.close()
  }
}

export function runMeasuredTwoColumnPreview(examPaper) {
  return runMeasurementHarnessMethod('__runMeasuredTwoColumnPreview', examPaper)
}

export function runProductionMeasuredPathInBrowser(examPaper) {
  return runMeasurementHarnessMethod('__runProductionMeasuredPathInBrowser', examPaper)
}
