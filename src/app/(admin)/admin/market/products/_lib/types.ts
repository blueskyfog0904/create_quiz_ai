import type { MarketItemBundleOption, MarketItemFile, MarketItemForAdmin, MarketItemSubproduct, MarketSubproductFile } from '@/lib/market-items-server'

interface PersistFormOptions {
  preserveSelections?: boolean
  skipSuccessToast?: boolean
  targetId?: string
  draftSource?: 'manual' | 'auto_upload'
}

interface MarketItemDetailPayload {
  item: MarketItemForAdmin
  files: MarketItemFile[]
  subproducts: MarketItemSubproduct[]
  subproductFiles: MarketSubproductFile[]
  bundleOption: MarketItemBundleOption | null
}

interface SubproductDraftState {
  categoryId: string
  description: string
  purchaseNoticeLabel: string
  purchaseNoticeText: string
  priceCredits: string
}

interface SubproductEditState {
  categoryId: string
  description: string
  purchaseNoticeLabel: string
  purchaseNoticeText: string
  priceCredits: string
  isActive: boolean
}

interface SubproductFileDraftState {
  id: string
  subproductId: string
  fileTypeId: string
  fileName?: string
}

interface BundleFormState {
  enabled: boolean
  label: string
  description: string
  priceCredits: string
}

interface CategorySettingsFormState {
  name: string
  slug: string
  description: string
  sortOrder: string
  isActive: boolean
}

interface FileTypeSettingsFormState {
  code: string
  label: string
  extension: string
  // 상품 상세 "구매 전 확인"에 보이는 필요 프로그램(DB market_file_types.required_program)
  requiredProgram: string
  mimeAllowlist: string
  sortOrder: string
  isActive: boolean
}

interface MarketItemFormState {
  id?: string
  title: string
  summary: string
  description: string
  // null = 상품 이미지 없음(카테고리 항목 기본 이미지 → 점선 박스 순으로 표시)
  thumbnailImageId: string | null
  examYear: string
  examMonth: string
  gradeLevel: string
  sourceType: string
  source1: string
  source2: string
  source3: string
  source4: string
  questionCount: string
  pdfPrice: string
  hwpPrice: string
  zipPrice: string
  status: 'draft' | 'published' | 'hidden' | 'archived'
  draftSource: 'manual' | 'auto_upload'
  isActive: boolean
}

interface AdminSamplePage {
  id: string
  pageNumber: number
  originalFileName: string | null
  signedUrl: string
  fileSizeBytes: number | null
  widthPx: number | null
  heightPx: number | null
  draftToken?: string | null
}

type SampleGenerationStep = 'idle' | 'rendering' | 'requesting_upload_targets' | 'uploading' | 'finalizing'

interface RenderedSamplePage {
  pageNumber: number
  originalFileName: string
  storageFileName: string
  mimeType: 'image/jpeg'
  blob: Blob
  fileSizeBytes: number
  widthPx: number
  heightPx: number
}

interface SampleUploadTarget {
  pageNumber: number
  storagePath: string
  token: string
  originalFileName: string
  storageFileName: string
  mimeType: 'image/jpeg'
  fileSizeBytes: number
  widthPx: number
  heightPx: number
}

interface SampleUploadTargetResponse {
  success?: boolean
  draftToken?: string
  sourceBatchId?: string
  bucket?: string
  uploadTargets?: SampleUploadTarget[]
  error?: { message?: string }
}

interface SampleFinalizeResponse {
  success?: boolean
  draftToken?: string
  pages?: AdminSamplePage[]
  error?: { message?: string }
}

// 18번 8절: 이 창에서 등록한 상품(화면 메모리에만 — 창을 닫으면 사라짐)
interface RegisteredItem {
  id: string
  title: string
  status: MarketItemFormState['status']
  subproductCount: number
}

export type {
  RegisteredItem,
  PersistFormOptions,
  MarketItemDetailPayload,
  SubproductDraftState,
  SubproductEditState,
  SubproductFileDraftState,
  BundleFormState,
  CategorySettingsFormState,
  FileTypeSettingsFormState,
  MarketItemFormState,
  AdminSamplePage,
  SampleGenerationStep,
  RenderedSamplePage,
  SampleUploadTarget,
  SampleUploadTargetResponse,
  SampleFinalizeResponse,
}
