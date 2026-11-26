import type { MarketFileType, MarketItem, MarketItemBundleOption, MarketItemSubproduct, MarketSubproductCategory } from '@/lib/market-items-server'
import type {
  SubproductDraftState,
  SubproductEditState,
  BundleFormState,
  CategorySettingsFormState,
  FileTypeSettingsFormState,
  MarketItemFormState,
} from './types'

function getItemCategoryItemId(item: MarketItem) {
  return (item as { category_item_id?: string | null }).category_item_id ?? ''
}

const MARKET_STATUS_LABELS: Record<MarketItemFormState['status'], string> = {
  draft: '임시저장',
  published: '공개',
  hidden: '숨김',
  archived: '보관',
}

// 목록 상태 배지 색(공개 초록, 임시저장 회색, 숨김 주황, 보관 흐림)
const MARKET_STATUS_BADGE_CLASSES: Record<MarketItemFormState['status'], string> = {
  published: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  draft: 'border-gray-200 bg-gray-50 text-gray-600',
  hidden: 'border-amber-200 bg-amber-50 text-amber-700',
  archived: 'border-slate-200 bg-slate-100 text-slate-500',
}

const MARKET_LIST_STATUS_TABS = ['all', 'published', 'draft', 'hidden', 'archived'] as const
type MarketListStatusTab = typeof MARKET_LIST_STATUS_TABS[number]
type MarketListSortKey = 'created' | 'updated' | 'title'

// 서버(UTC)와 브라우저(KST)가 같은 글자를 그리도록 시간대를 고정한다.
const ADMIN_LIST_DATE_FORMATTER = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })

const MIN_EXAM_YEAR = 2000
const MAX_EXAM_YEAR = 2050
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1))

function buildExamYearOptions(baseYear = MAX_EXAM_YEAR) {
  return Array.from({ length: Math.max(baseYear - MIN_EXAM_YEAR + 1, 1) }, (_, index) => String(baseYear - index))
}

function getDefaultExamYear() {
  return String(new Date().getFullYear())
}

function formatCreditInputValue(value: string | number | null | undefined) {
  const digits = String(value ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function parseCreditInputValue(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

// 17번: 출처 1~4 입력 칸(상세 '출처' 한 줄에 ' · '로 이어 보임)
const SOURCE_FIELDS = ['source1', 'source2', 'source3', 'source4'] as const

function buildEmptyForm(): MarketItemFormState {
  return {
    title: '',
    summary: '',
    description: '',
    thumbnailImageId: null,
    examYear: '',
    examMonth: '',
    gradeLevel: '',
    sourceType: '',
    source1: '',
    source2: '',
    source3: '',
    source4: '',
    questionCount: '',
    pdfPrice: '0',
    hwpPrice: '0',
    zipPrice: '0',
    status: 'published',
    draftSource: 'manual',
    isActive: true,
  }
}

function buildEditForm(item: MarketItem): MarketItemFormState {
  return {
    id: item.id,
    title: item.title,
    summary: item.summary || '',
    description: item.description || '',
    thumbnailImageId: item.thumbnail_image_id,
    examYear: item.exam_year ? String(item.exam_year) : '',
    examMonth: item.exam_month ? String(item.exam_month) : '',
    gradeLevel: item.grade_level || '',
    sourceType: item.source_type || '',
    source1: item.source_1 || '',
    source2: item.source_2 || '',
    source3: item.source_3 || '',
    source4: item.source_4 || '',
    questionCount: item.question_count !== null && item.question_count !== undefined ? String(item.question_count) : '',
    pdfPrice: formatCreditInputValue(item.pdf_price),
    hwpPrice: formatCreditInputValue(item.hwp_price),
    zipPrice: formatCreditInputValue(item.zip_price),
    status: item.status as MarketItemFormState['status'],
    draftSource: item.draft_source === 'auto_upload' ? 'auto_upload' : 'manual',
    isActive: item.is_active,
  }
}

function formatFileSize(bytes?: number | null) {
  if (!bytes) {
    return '-'
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)}KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return '-'
  }

  return new Date(value).toLocaleString('ko-KR')
}

const MARKET_ITEM_HIDDEN_INSTEAD_MESSAGE = '구매·환불·후기 이력이 있어 삭제하지 않고 숨김 처리했습니다.'

function buildEmptySubproductDraft(categoryId = ''): SubproductDraftState {
  return {
    categoryId,
    description: '',
    purchaseNoticeLabel: '',
    purchaseNoticeText: '',
    priceCredits: '0',
  }
}

function buildSubproductEditState(subproduct: MarketItemSubproduct): SubproductEditState {
  return {
    categoryId: subproduct.category_id,
    description: subproduct.description || '',
    purchaseNoticeLabel: subproduct.purchase_notice_label || '',
    purchaseNoticeText: subproduct.purchase_notice_text || '',
    priceCredits: formatCreditInputValue(subproduct.price_credits),
    isActive: subproduct.is_active,
  }
}

// 19번: 표시명 첫 값은 ''(비우면 상세는 DB 기본 제목을 보임 — 옛 기본 글자를 다시 채우지 않는다)
function buildEmptyBundleForm(): BundleFormState {
  return {
    enabled: false,
    label: '',
    description: '',
    priceCredits: '0',
  }
}

function buildBundleFormFromOption(option: MarketItemBundleOption | null): BundleFormState {
  return option
    ? {
      enabled: option.is_active,
      label: option.label,
      description: option.description || '',
      priceCredits: formatCreditInputValue(option.price_credits),
    }
    : buildEmptyBundleForm()
}

function isSameBundleForm(left: BundleFormState, right: BundleFormState) {
  return left.enabled === right.enabled
    && left.label === right.label
    && left.description === right.description
    && left.priceCredits === right.priceCredits
}

function buildEmptyCategorySettingsForm(): CategorySettingsFormState {
  return {
    name: '',
    slug: '',
    description: '',
    sortOrder: '0',
    isActive: true,
  }
}

function buildCategorySettingsForm(category: MarketSubproductCategory): CategorySettingsFormState {
  return {
    name: category.name,
    slug: category.slug,
    description: category.description || '',
    sortOrder: String(category.sort_order ?? 0),
    isActive: category.is_active,
  }
}

function buildEmptyFileTypeSettingsForm(): FileTypeSettingsFormState {
  return {
    code: '',
    label: '',
    extension: '',
    requiredProgram: '',
    mimeAllowlist: '',
    sortOrder: '0',
    isActive: true,
  }
}

function buildFileTypeSettingsForm(fileType: MarketFileType): FileTypeSettingsFormState {
  return {
    code: fileType.code,
    label: fileType.label,
    extension: fileType.extension,
    requiredProgram: fileType.required_program ?? '',
    mimeAllowlist: (fileType.mime_allowlist || []).join('\n'),
    sortOrder: String(fileType.sort_order ?? 0),
    isActive: fileType.is_active,
  }
}

export {
  getItemCategoryItemId,
  MARKET_STATUS_LABELS,
  MARKET_STATUS_BADGE_CLASSES,
  MARKET_LIST_STATUS_TABS,
  ADMIN_LIST_DATE_FORMATTER,
  MIN_EXAM_YEAR,
  MAX_EXAM_YEAR,
  MONTH_OPTIONS,
  buildExamYearOptions,
  getDefaultExamYear,
  formatCreditInputValue,
  parseCreditInputValue,
  SOURCE_FIELDS,
  buildEmptyForm,
  buildEditForm,
  formatFileSize,
  formatDateTime,
  MARKET_ITEM_HIDDEN_INSTEAD_MESSAGE,
  buildEmptySubproductDraft,
  buildSubproductEditState,
  buildEmptyBundleForm,
  buildBundleFormFromOption,
  isSameBundleForm,
  buildEmptyCategorySettingsForm,
  buildCategorySettingsForm,
  buildEmptyFileTypeSettingsForm,
  buildFileTypeSettingsForm,
}
export type { MarketListStatusTab, MarketListSortKey }
