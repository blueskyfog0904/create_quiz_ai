import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { config } from 'dotenv'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

const require = createRequire(import.meta.url)

const WORKSPACE_SUBJECT = 'korean'
const MARKET_STORAGE_BUCKET = 'market-files'
const MENU_ENTRY_KEY = 'entexam'
const MENU_ENTRY_SLUG = 'entexam'
const LITERATURE_DIR = '/Users/donald/Documents/project/써머썬_문제/2027학년도 EBS 수능특강 국어 문학'
const DEFAULT_REPORT_ROOT = '/Users/donald/Documents/써머썬문제등록/artifacts'
const SAMPLE_PAGE_NUMBERS = [1, 2, 3]
const SUBPRODUCT_PLAN = {
  questionPdf: {
    slug: 'question_pdf',
    title: '문제(PDF)',
    priceCredits: 2500,
    sortOrder: 1,
  },
  questionHwp: {
    slug: 'question_hwp',
    title: '문제(HWP)',
    priceCredits: 3000,
    sortOrder: 2,
  },
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    noRender: false,
    verifyHttp: false,
    limit: null,
    reportRoot: DEFAULT_REPORT_ROOT,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--no-render') options.noRender = true
    else if (arg === '--verify-http') options.verifyHttp = true
    else if (arg === '--limit') {
      const value = Number(argv[index + 1])
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error('--limit requires a positive integer')
      }
      options.limit = value
      index += 1
    } else if (arg === '--report-root') {
      const value = argv[index + 1]
      if (!value) throw new Error('--report-root requires a path')
      options.reportRoot = value
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function normalizeFileName(value) {
  return value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.+/g, '.')
    .replace(/^\.+|\.+$/g, '') || 'file'
}

function buildMarketSubproductStoragePath(workspaceSubject, itemId, subproductId, fileTypeCode, version, fileName) {
  const safeName = normalizeFileName(fileName)
  const safeCode = normalizeFileName(fileTypeCode.toLowerCase())
  const timestamp = Date.now()
  return `market/${workspaceSubject}/${itemId}/subproducts/${subproductId}/${safeCode}/v${version}/${timestamp}-${safeName}`
}

function buildMarketManualSamplePageStoragePath(workspaceSubject, itemId, batchId, pageNumber, fileName) {
  const safeName = normalizeFileName(fileName)
  return `market/${workspaceSubject}/${itemId}/sample-pages/manual/${batchId}/page-${String(pageNumber).padStart(3, '0')}-${safeName}`
}

function makeSupabase() {
  config({ path: resolve(process.cwd(), '.env.local'), quiet: true })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function isExcludedProductStem(stem) {
  return /합본|전체/.test(stem)
}

async function discoverCandidates() {
  const names = await readdir(LITERATURE_DIR)
  const byStem = new Map()

  for (const name of names) {
    const absolutePath = join(LITERATURE_DIR, name)
    const fileStat = await stat(absolutePath)
    if (!fileStat.isFile()) continue

    const extension = extname(name).toLowerCase().replace(/^\./, '')
    const stem = basename(name, extname(name))

    if (!byStem.has(stem)) {
      byStem.set(stem, {
        stem,
        files: {},
      })
    }

    byStem.get(stem).files[extension] = {
      name,
      path: absolutePath,
      size: fileStat.size,
      extension,
    }
  }

  const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' })
  const rows = Array.from(byStem.values()).sort((left, right) => collator.compare(left.stem, right.stem))
  const candidates = []
  const excludedPdfStems = []

  for (const row of rows) {
    const pdf = row.files.pdf
    const hwpLike = row.files.hwp ?? row.files.hwpx

    if (pdf && hwpLike && !isExcludedProductStem(row.stem)) {
      candidates.push({
        title: row.stem,
        pdfPath: pdf.path,
        pdfFileName: pdf.name,
        pdfSize: pdf.size,
        hwpPath: hwpLike.path,
        hwpFileName: hwpLike.name,
        hwpSize: hwpLike.size,
        hwpExtension: hwpLike.extension,
        usesHwpxAsHwp: hwpLike.extension === 'hwpx',
      })
      continue
    }

    if (pdf) {
      excludedPdfStems.push(row.stem)
    }
  }

  return {
    candidates,
    excludedPdfStems,
  }
}

function buildDryRunSummary(discovery, limitedCandidates = discovery.candidates) {
  return {
    mode: 'dry-run',
    literatureDir: LITERATURE_DIR,
    candidateCount: discovery.candidates.length,
    limitedCandidateCount: limitedCandidates.length,
    hwpxAsHwpCount: discovery.candidates.filter((candidate) => candidate.usesHwpxAsHwp).length,
    excludedPdfCount: discovery.excludedPdfStems.length,
    samplePagesPerItem: SAMPLE_PAGE_NUMBERS.length,
    samplePageNumbers: SAMPLE_PAGE_NUMBERS,
    subproductsPerItem: 2,
    bundleOptionsPerItem: 0,
    bundlePriceCredits: null,
    subproductPlan: SUBPRODUCT_PLAN,
    firstTitles: discovery.candidates.slice(0, 5).map((candidate) => candidate.title),
    hwpxAsHwpTitles: discovery.candidates
      .filter((candidate) => candidate.usesHwpxAsHwp)
      .map((candidate) => candidate.title),
    excludedPdfStems: discovery.excludedPdfStems,
  }
}

async function extractQuestionCount(pdfPath) {
  const data = new Uint8Array(await readFile(pdfPath))
  const pdf = await pdfjsLib.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise

  let fullText = ''
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const textContent = await page.getTextContent()
    fullText += `\n${textContent.items.map((item) => item.str).join(' ')}`
  }

  const normalizedText = fullText.replace(/\u0000/g, ' ').replace(/\s+/g, ' ')
  const matches = normalizedText.matchAll(/(\d{1,3})\s*[.．]\s*정답/g)
  const numbers = Array.from(matches, (match) => Number(match[1])).filter((value) => Number.isInteger(value))
  const questionCount = numbers.length > 0 ? Math.max(...numbers) : null

  if (!questionCount) {
    throw new Error(`Could not extract question count from ${pdfPath}`)
  }

  return {
    questionCount,
    pageCount: pdf.numPages,
  }
}

async function createPdfRenderer() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const pdfModuleSource = await readFile(require.resolve('pdfjs-dist/build/pdf.mjs'), 'utf8')
  const pdfWorkerSource = await readFile(require.resolve('pdfjs-dist/build/pdf.worker.mjs'), 'utf8')

  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>', {
    waitUntil: 'domcontentloaded',
  })
  await page.evaluate(async ({ moduleSource, workerSource }) => {
    const moduleUrl = URL.createObjectURL(new Blob([moduleSource], { type: 'text/javascript' }))
    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
    window.__marketPdfjsLib = await import(moduleUrl)
    window.__marketPdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
  }, {
    moduleSource: pdfModuleSource,
    workerSource: pdfWorkerSource,
  })

  return {
    async render(pdfPath, pageNumbers) {
      const pdfBytes = await readFile(pdfPath)
      return await page.evaluate(async ({ pdfBytesArray, renderPageNumbers }) => {
        const pdfjsLib = window.__marketPdfjsLib
        const pdf = await pdfjsLib.getDocument({
          data: new Uint8Array(pdfBytesArray),
          useWorkerFetch: false,
          isEvalSupported: false,
        }).promise

        const root = document.getElementById('root')
        root.innerHTML = ''
        const pages = []

        for (const pageNumber of renderPageNumbers) {
          if (pageNumber > pdf.numPages) {
            throw new Error(`PDF has ${pdf.numPages} pages, cannot render page ${pageNumber}`)
          }

          const pdfPage = await pdf.getPage(pageNumber)
          const viewport = pdfPage.getViewport({ scale: 1 })
          const canvas = document.createElement('canvas')
          const context = canvas.getContext('2d', { alpha: false })
          if (!context) throw new Error('Could not create sample JPG canvas')

          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          root.appendChild(canvas)

          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, canvas.width, canvas.height)

          await pdfPage.render({
            canvas,
            canvasContext: context,
            viewport,
          }).promise

          const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.9)
          pages.push({
            pageNumber,
            widthPx: canvas.width,
            heightPx: canvas.height,
            bufferBase64: jpegDataUrl.replace(/^data:image\/jpeg;base64,/, ''),
          })
        }

        return {
          pageCount: pdf.numPages,
          pages,
        }
      }, {
        pdfBytesArray: Array.from(pdfBytes),
        renderPageNumbers: pageNumbers,
      })
    },

    async close() {
      await browser.close()
    },
  }
}

async function prepareCandidateArtifacts(candidates, runDir, noRender) {
  const prepared = []
  const renderer = noRender ? null : await createPdfRenderer()

  try {
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]
      console.error(`[prepare] ${index + 1}/${candidates.length} ${candidate.title}`)
      const questionInfo = await extractQuestionCount(candidate.pdfPath)
      const samplePages = []

      if (!noRender) {
        const rendered = await renderer.render(candidate.pdfPath, SAMPLE_PAGE_NUMBERS)
        const candidateDir = join(runDir, 'samples', String(index + 1).padStart(3, '0'))
        await mkdir(candidateDir, { recursive: true })

        for (const [pageIndex, page] of rendered.pages.entries()) {
          const fileName = `${String(pageIndex + 1).padStart(2, '0')}-problem-p${page.pageNumber}.jpg`
          const outputPath = join(candidateDir, fileName)
          const buffer = Buffer.from(page.bufferBase64, 'base64')
          await writeFile(outputPath, buffer)
          samplePages.push({
            pageNumber: page.pageNumber,
            originalFileName: fileName,
            path: outputPath,
            widthPx: page.widthPx,
            heightPx: page.heightPx,
            fileSizeBytes: buffer.length,
          })
        }
      }

      prepared.push({
        ...candidate,
        questionCount: questionInfo.questionCount,
        pdfPageCount: questionInfo.pageCount,
        samplePages,
      })
    }
  } finally {
    if (renderer) await renderer.close()
  }

  return prepared
}

async function requireSingle(label, query) {
  const { data, error } = await query.single()
  if (error) throw new Error(`${label}: ${error.message}`)
  return data
}

async function requireMaybe(label, query) {
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`${label}: ${error.message}`)
  return data
}

async function loadMarketConfig(supabase) {
  const menuEntry = await requireSingle('market menu entry', supabase
    .from('market_menu_entries')
    .select('id, workspace_subject, entry_key, slug, title')
    .eq('workspace_subject', WORKSPACE_SUBJECT)
    .or(`entry_key.eq.${MENU_ENTRY_KEY},slug.eq.${MENU_ENTRY_SLUG}`))

  const { data: categories, error: categoriesError } = await supabase
    .from('market_subproduct_categories')
    .select('id, slug, name')
    .eq('workspace_subject', WORKSPACE_SUBJECT)
    .in('slug', [SUBPRODUCT_PLAN.questionPdf.slug, SUBPRODUCT_PLAN.questionHwp.slug])
    .eq('is_active', true)
    .is('deleted_at', null)

  if (categoriesError) throw new Error(`subproduct categories: ${categoriesError.message}`)

  const { data: fileTypes, error: fileTypesError } = await supabase
    .from('market_file_types')
    .select('id, code, label, extension')
    .eq('workspace_subject', WORKSPACE_SUBJECT)
    .in('code', ['pdf', 'hwp'])
    .eq('is_active', true)
    .is('deleted_at', null)

  if (fileTypesError) throw new Error(`file types: ${fileTypesError.message}`)

  const categoryBySlug = new Map(categories.map((category) => [category.slug, category]))
  const fileTypeByCode = new Map(fileTypes.map((fileType) => [fileType.code, fileType]))

  for (const slug of [SUBPRODUCT_PLAN.questionPdf.slug, SUBPRODUCT_PLAN.questionHwp.slug]) {
    if (!categoryBySlug.has(slug)) throw new Error(`Missing active subproduct category: ${slug}`)
  }

  for (const code of ['pdf', 'hwp']) {
    if (!fileTypeByCode.has(code)) throw new Error(`Missing active file type: ${code}`)
  }

  return {
    menuEntry,
    categoryBySlug,
    fileTypeByCode,
  }
}

async function resolveActorId(supabase) {
  const row = await requireMaybe('actor market item', supabase
    .from('market_items')
    .select('created_by')
    .eq('workspace_subject', WORKSPACE_SUBJECT)
    .not('created_by', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1))

  return row?.created_by ?? null
}

async function listExistingItems(supabase, menuEntryId, titles) {
  const existing = new Map()
  const targetTitles = new Set(titles)
  const pageSize = 1000

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('market_items')
      .select('id, title, question_count, status, is_active')
      .eq('workspace_subject', WORKSPACE_SUBJECT)
      .eq('menu_entry_id', menuEntryId)
      .is('deleted_at', null)
      .range(offset, offset + pageSize - 1)

    if (error) throw new Error(`existing items: ${error.message}`)
    for (const item of data) {
      if (targetTitles.has(item.title)) {
        existing.set(item.title, item)
      }
    }
    if (data.length < pageSize) {
      break
    }
  }

  return existing
}

function contentTypeFor(fileName, fileTypeCode) {
  const extension = extname(fileName).toLowerCase()
  if (fileTypeCode === 'pdf') return 'application/pdf'
  if (extension === '.hwp') return 'application/octet-stream'
  if (extension === '.hwpx') return 'application/octet-stream'
  return 'application/octet-stream'
}

async function uploadObject(supabase, storagePath, buffer, contentType, uploadedTargets) {
  const { error } = await supabase.storage
    .from(MARKET_STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType,
      upsert: false,
    })

  if (error) throw new Error(`storage upload ${storagePath}: ${error.message}`)
  uploadedTargets.push(storagePath)
}

async function removeStorageTargets(supabase, storageTargets) {
  if (storageTargets.length === 0) return
  const uniqueTargets = Array.from(new Set(storageTargets))
  const { error } = await supabase.storage.from(MARKET_STORAGE_BUCKET).remove(uniqueTargets)
  if (error) {
    console.error(`[rollback] storage remove warning: ${error.message}`)
  }
}

async function rollbackItem(supabase, itemId, storageTargets) {
  await removeStorageTargets(supabase, storageTargets)

  if (itemId) {
    const { error } = await supabase
      .from('market_items')
      .delete()
      .eq('id', itemId)
      .eq('workspace_subject', WORKSPACE_SUBJECT)

    if (error) {
      console.error(`[rollback] item delete warning ${itemId}: ${error.message}`)
    }
  }
}

async function registerCandidate(supabase, marketConfig, actorId, candidate, index, total) {
  const uploadedTargets = []
  let itemId = null

  try {
    const nowIso = new Date().toISOString()
    const item = await requireSingle('insert market item', supabase
      .from('market_items')
      .insert({
        menu_entry_id: marketConfig.menuEntry.id,
        workspace_subject: WORKSPACE_SUBJECT,
        title: candidate.title,
        summary: null,
        description: null,
        thumbnail_url: null,
        exam_year: 2027,
        exam_month: null,
        grade_level: '전체',
        source_type: null,
        source_1: null,
        source_2: null,
        source_3: null,
        source_4: null,
        question_count: candidate.questionCount,
        pdf_price: 0,
        hwp_price: 0,
        zip_price: 0,
        sort_order: 0,
        status: 'published',
        draft_source: 'manual',
        is_active: true,
        published_at: nowIso,
        created_by: actorId,
        updated_by: actorId,
      })
      .select('*'))

    itemId = item.id
    console.error(`[register] ${index + 1}/${total} item ${itemId} ${candidate.title}`)

    const sampleBatchId = randomUUID()
    const sampleRows = []
    for (const [sampleIndex, samplePage] of candidate.samplePages.entries()) {
      const buffer = await readFile(samplePage.path)
      const storagePath = buildMarketManualSamplePageStoragePath(
        WORKSPACE_SUBJECT,
        itemId,
        sampleBatchId,
        samplePage.pageNumber,
        samplePage.originalFileName
      )

      await uploadObject(supabase, storagePath, buffer, 'image/jpeg', uploadedTargets)
      sampleRows.push({
        item_id: itemId,
        source_file_id: null,
        workspace_subject: WORKSPACE_SUBJECT,
        page_number: samplePage.pageNumber,
        storage_bucket: MARKET_STORAGE_BUCKET,
        storage_path: storagePath,
        original_file_name: samplePage.originalFileName,
        mime_type: 'image/jpeg',
        file_size_bytes: buffer.length,
        width_px: samplePage.widthPx,
        height_px: samplePage.heightPx,
        version: 1,
        is_active: true,
        created_by: actorId,
        display_order: sampleIndex + 1,
        source_batch_id: sampleBatchId,
        draft_token: null,
        status: 'active',
        committed_at: nowIso,
      })
    }

    const { error: sampleInsertError } = await supabase
      .from('market_item_sample_pages')
      .insert(sampleRows)

    if (sampleInsertError) throw new Error(`insert sample pages: ${sampleInsertError.message}`)

    const questionPdfSubproduct = await requireSingle('insert question pdf subproduct', supabase
      .from('market_item_subproducts')
      .insert({
        item_id: itemId,
        workspace_subject: WORKSPACE_SUBJECT,
        category_id: marketConfig.categoryBySlug.get(SUBPRODUCT_PLAN.questionPdf.slug).id,
        title: SUBPRODUCT_PLAN.questionPdf.title,
        description: null,
        price_credits: SUBPRODUCT_PLAN.questionPdf.priceCredits,
        sort_order: SUBPRODUCT_PLAN.questionPdf.sortOrder,
        is_active: true,
      })
      .select('*'))

    const questionHwpSubproduct = await requireSingle('insert question hwp subproduct', supabase
      .from('market_item_subproducts')
      .insert({
        item_id: itemId,
        workspace_subject: WORKSPACE_SUBJECT,
        category_id: marketConfig.categoryBySlug.get(SUBPRODUCT_PLAN.questionHwp.slug).id,
        title: SUBPRODUCT_PLAN.questionHwp.title,
        description: null,
        price_credits: SUBPRODUCT_PLAN.questionHwp.priceCredits,
        sort_order: SUBPRODUCT_PLAN.questionHwp.sortOrder,
        is_active: true,
      })
      .select('*'))

    const paidFileRows = []
    const pdfBuffer = await readFile(candidate.pdfPath)
    const hwpBuffer = await readFile(candidate.hwpPath)
    const pdfChecksum = createHash('sha256').update(pdfBuffer).digest('hex')
    const hwpChecksum = createHash('sha256').update(hwpBuffer).digest('hex')

    const pdfFileType = marketConfig.fileTypeByCode.get('pdf')
    const hwpFileType = marketConfig.fileTypeByCode.get('hwp')
    const paidFiles = [
      {
        subproductId: questionPdfSubproduct.id,
        fileType: pdfFileType,
        fileName: candidate.pdfFileName,
        buffer: pdfBuffer,
        checksum: pdfChecksum,
        sortOrder: 1,
      },
      {
        subproductId: questionHwpSubproduct.id,
        fileType: hwpFileType,
        fileName: candidate.hwpFileName,
        buffer: hwpBuffer,
        checksum: hwpChecksum,
        sortOrder: 1,
      },
      {
        subproductId: questionHwpSubproduct.id,
        fileType: pdfFileType,
        fileName: candidate.pdfFileName,
        buffer: pdfBuffer,
        checksum: pdfChecksum,
        sortOrder: 2,
      },
    ]

    for (const file of paidFiles) {
      const storagePath = buildMarketSubproductStoragePath(
        WORKSPACE_SUBJECT,
        itemId,
        file.subproductId,
        file.fileType.code,
        1,
        file.fileName
      )
      const contentType = contentTypeFor(file.fileName, file.fileType.code)

      await uploadObject(supabase, storagePath, file.buffer, contentType, uploadedTargets)
      paidFileRows.push({
        item_id: itemId,
        subproduct_id: file.subproductId,
        workspace_subject: WORKSPACE_SUBJECT,
        file_type_id: file.fileType.id,
        storage_bucket: MARKET_STORAGE_BUCKET,
        storage_path: storagePath,
        original_file_name: file.fileName,
        content_type: contentType,
        file_size_bytes: file.buffer.length,
        checksum: file.checksum,
        version: 1,
        sort_order: file.sortOrder,
        is_active: true,
        created_by: actorId,
      })
    }

    const { error: paidFilesError } = await supabase
      .from('market_subproduct_files')
      .insert(paidFileRows)

    if (paidFilesError) throw new Error(`insert paid files: ${paidFilesError.message}`)

    return {
      itemId,
      title: candidate.title,
      questionCount: candidate.questionCount,
      pdfPageCount: candidate.pdfPageCount,
      samplePageCount: sampleRows.length,
      subproductCount: 2,
      paidFileCount: paidFileRows.length,
      bundleOptionId: null,
      bundleOptionCount: 0,
      usesHwpxAsHwp: candidate.usesHwpxAsHwp,
      storageObjectCount: uploadedTargets.length,
    }
  } catch (error) {
    console.error(`[register] rolling back failed item: ${candidate.title}`)
    await rollbackItem(supabase, itemId, uploadedTargets)
    throw error
  }
}

async function verifyStorageObjects(supabase, storageRows) {
  let checked = 0
  const directoryCache = new Map()

  for (const row of storageRows) {
    const directory = dirname(row.storage_path)
    const objectName = basename(row.storage_path)
    const cacheKey = `${row.storage_bucket}:${directory}`

    if (!directoryCache.has(cacheKey)) {
      const { data, error } = await supabase.storage
        .from(row.storage_bucket)
        .list(directory, { limit: 1000 })

      if (error) throw new Error(`storage list ${directory}: ${error.message}`)
      directoryCache.set(cacheKey, new Map((data ?? []).map((object) => [object.name, object])))
    }

    const object = directoryCache.get(cacheKey).get(objectName)
    if (!object) {
      throw new Error(`storage object missing ${row.storage_path}`)
    }
    const size = object.metadata?.size
    if (row.file_size_bytes != null && size != null && Number(size) !== Number(row.file_size_bytes)) {
      throw new Error(`storage size mismatch ${row.storage_path}: expected ${row.file_size_bytes}, got ${size}`)
    }
    checked += 1
  }

  return checked
}

async function verifyRegisteredItems(supabase, itemIds) {
  if (itemIds.length === 0) {
    return {
      itemCount: 0,
      samplePageCount: 0,
      subproductCount: 0,
      paidFileCount: 0,
      bundleOptionCount: 0,
      storageObjectCount: 0,
    }
  }

  const queryIds = itemIds
  const [itemsResult, samplesResult, subproductsResult, paidFilesResult, bundleResult] = await Promise.all([
    supabase.from('market_items').select('id, title, status, is_active, question_count').in('id', queryIds),
    supabase.from('market_item_sample_pages').select('id, item_id, page_number, display_order, status, is_active, storage_bucket, storage_path, file_size_bytes').in('item_id', queryIds).is('deleted_at', null),
    supabase.from('market_item_subproducts').select('id, item_id, title, price_credits, is_active').in('item_id', queryIds).is('deleted_at', null),
    supabase.from('market_subproduct_files').select('id, item_id, subproduct_id, file_type_id, sort_order, is_active, storage_bucket, storage_path, file_size_bytes').in('item_id', queryIds).is('deleted_at', null),
    supabase.from('market_item_bundle_options').select('id, item_id, price_credits, is_active').in('item_id', queryIds),
  ])

  for (const [label, result] of [
    ['items', itemsResult],
    ['samples', samplesResult],
    ['subproducts', subproductsResult],
    ['paid files', paidFilesResult],
    ['bundle options', bundleResult],
  ]) {
    if (result.error) throw new Error(`verify ${label}: ${result.error.message}`)
  }

  const items = itemsResult.data
  const samples = samplesResult.data
  const subproducts = subproductsResult.data
  const paidFiles = paidFilesResult.data
  const bundleOptions = bundleResult.data

  for (const itemId of itemIds) {
    const item = items.find((row) => row.id === itemId)
    if (!item || item.status !== 'published' || item.is_active !== true || !item.question_count) {
      throw new Error(`item verification failed: ${itemId}`)
    }

    const itemSamples = samples.filter((row) => row.item_id === itemId && row.is_active && row.status === 'active')
    if (itemSamples.length !== SAMPLE_PAGE_NUMBERS.length) {
      throw new Error(`sample count mismatch ${itemId}: ${itemSamples.length}`)
    }

    const actualPages = itemSamples
      .sort((left, right) => left.display_order - right.display_order)
      .map((row) => row.page_number)
    if (JSON.stringify(actualPages) !== JSON.stringify(SAMPLE_PAGE_NUMBERS)) {
      throw new Error(`sample page order mismatch ${itemId}: ${actualPages.join(',')}`)
    }

    const itemSubproducts = subproducts.filter((row) => row.item_id === itemId && row.is_active)
    if (itemSubproducts.length !== 2) {
      throw new Error(`subproduct count mismatch ${itemId}: ${itemSubproducts.length}`)
    }
    const prices = new Map(itemSubproducts.map((row) => [row.title, row.price_credits]))
    if (prices.get(SUBPRODUCT_PLAN.questionPdf.title) !== SUBPRODUCT_PLAN.questionPdf.priceCredits) {
      throw new Error(`question pdf price mismatch ${itemId}`)
    }
    if (prices.get(SUBPRODUCT_PLAN.questionHwp.title) !== SUBPRODUCT_PLAN.questionHwp.priceCredits) {
      throw new Error(`question hwp price mismatch ${itemId}`)
    }

    const itemPaidFiles = paidFiles.filter((row) => row.item_id === itemId && row.is_active)
    if (itemPaidFiles.length !== 3) {
      throw new Error(`paid file count mismatch ${itemId}: ${itemPaidFiles.length}`)
    }

    const activeBundleOptions = bundleOptions.filter((row) => row.item_id === itemId && row.is_active)
    if (activeBundleOptions.length !== 0) {
      throw new Error(`bundle options must be inactive for literature ${itemId}: ${activeBundleOptions.length}`)
    }
  }

  const storageObjectCount = await verifyStorageObjects(supabase, [...samples, ...paidFiles])

  return {
    itemCount: items.length,
    samplePageCount: samples.length,
    subproductCount: subproducts.length,
    paidFileCount: paidFiles.length,
    bundleOptionCount: bundleOptions.filter((row) => row.is_active).length,
    storageObjectCount,
  }
}

async function verifyHttpPages(itemIds) {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4000'
  const results = []

  for (const itemId of itemIds) {
    const url = `${baseUrl.replace(/\/$/, '')}/korean/market/entexam/items/${itemId}`
    const response = await fetch(url, { method: 'GET' })
    results.push({ itemId, url, status: response.status })
    if (response.status !== 200) {
      throw new Error(`public detail page failed ${response.status}: ${url}`)
    }
  }

  return results
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const discovery = await discoverCandidates()
  const candidates = options.limit ? discovery.candidates.slice(0, options.limit) : discovery.candidates

  if (options.dryRun) {
    const summary = buildDryRunSummary(discovery, candidates)
    if (!options.noRender) {
      const runDir = join(tmpdir(), `market-register-literature-dry-run-${Date.now()}`)
      await mkdir(runDir, { recursive: true })
      const prepared = await prepareCandidateArtifacts(candidates, runDir, false)
      summary.preparedCount = prepared.length
      summary.questionCountMin = Math.min(...prepared.map((candidate) => candidate.questionCount))
      summary.questionCountMax = Math.max(...prepared.map((candidate) => candidate.questionCount))
      summary.reportDir = runDir
    }
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    return
  }

  if (!existsSync(options.reportRoot)) {
    await mkdir(options.reportRoot, { recursive: true })
  }

  const runDir = join(options.reportRoot, `market-register-literature-${Date.now()}`)
  await mkdir(runDir, { recursive: true })
  const supabase = makeSupabase()
  const marketConfig = await loadMarketConfig(supabase)
  const actorId = await resolveActorId(supabase)
  const existingItems = await listExistingItems(
    supabase,
    marketConfig.menuEntry.id,
    candidates.map((candidate) => candidate.title)
  )
  const candidatesToRegister = candidates.filter((candidate) => !existingItems.has(candidate.title))

  console.error(`[preflight] candidates=${candidates.length} existing=${existingItems.size} new=${candidatesToRegister.length}`)
  const prepared = await prepareCandidateArtifacts(candidatesToRegister, runDir, options.noRender)
  if (prepared.some((candidate) => candidate.samplePages.length !== SAMPLE_PAGE_NUMBERS.length)) {
    throw new Error('All new candidates must have rendered sample pages before registration')
  }

  const manifestPath = join(runDir, 'candidate-manifest.json')
  await writeFile(manifestPath, JSON.stringify({
    discoveredCandidateCount: discovery.candidates.length,
    limitedCandidateCount: candidates.length,
    existingCount: existingItems.size,
    newCount: prepared.length,
    hwpxAsHwpTitles: discovery.candidates.filter((candidate) => candidate.usesHwpxAsHwp).map((candidate) => candidate.title),
    excludedPdfStems: discovery.excludedPdfStems,
    prepared: prepared.map((candidate) => ({
      title: candidate.title,
      questionCount: candidate.questionCount,
      pdfPageCount: candidate.pdfPageCount,
      usesHwpxAsHwp: candidate.usesHwpxAsHwp,
      pdfFileName: candidate.pdfFileName,
      hwpFileName: candidate.hwpFileName,
    })),
  }, null, 2))

  const registered = []
  for (let index = 0; index < prepared.length; index += 1) {
    registered.push(await registerCandidate(supabase, marketConfig, actorId, prepared[index], index, prepared.length))
  }

  const verification = await verifyRegisteredItems(supabase, registered.map((item) => item.itemId))
  let httpVerification = null
  if (options.verifyHttp && registered.length > 0) {
    httpVerification = await verifyHttpPages(registered.map((item) => item.itemId))
  }

  const report = {
    mode: 'register',
    runDir,
    manifestPath,
    literatureDir: LITERATURE_DIR,
    discoveredCandidateCount: discovery.candidates.length,
    limitedCandidateCount: candidates.length,
    existingCount: existingItems.size,
    registeredCount: registered.length,
    skippedExisting: Array.from(existingItems.values()),
    hwpxAsHwpCount: discovery.candidates.filter((candidate) => candidate.usesHwpxAsHwp).length,
    excludedPdfCount: discovery.excludedPdfStems.length,
    samplePagesPerItem: SAMPLE_PAGE_NUMBERS.length,
    subproductsPerItem: 2,
    paidFilesPerItem: 3,
    bundleOptionsPerItem: 0,
    bundlePriceCredits: null,
    subproductPlan: SUBPRODUCT_PLAN,
    registered,
    verification,
    httpVerification,
  }
  const reportPath = join(runDir, 'registration-report.json')
  await writeFile(reportPath, JSON.stringify(report, null, 2))
  process.stdout.write(`${JSON.stringify({
    mode: report.mode,
    reportPath,
    runDir,
    manifestPath,
    discoveredCandidateCount: report.discoveredCandidateCount,
    limitedCandidateCount: report.limitedCandidateCount,
    existingCount: report.existingCount,
    registeredCount: report.registeredCount,
    hwpxAsHwpCount: report.hwpxAsHwpCount,
    excludedPdfCount: report.excludedPdfCount,
    samplePagesPerItem: report.samplePagesPerItem,
    subproductsPerItem: report.subproductsPerItem,
    paidFilesPerItem: report.paidFilesPerItem,
    bundleOptionsPerItem: report.bundleOptionsPerItem,
    bundlePriceCredits: report.bundlePriceCredits,
    verification: report.verification,
    httpVerifiedCount: report.httpVerification?.length ?? 0,
    firstRegisteredItems: registered.slice(0, 5).map((item) => ({
      itemId: item.itemId,
      title: item.title,
    })),
  }, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
