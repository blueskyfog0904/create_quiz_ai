import type { Json } from '@/types/supabase'

export const SITE_FOOTER_CONTENT_SETTING_KEY = 'site_footer_content'
export const DEFAULT_FOOTER_BRAND_NAME = 'AI영어문제팩토리'

export const FOOTER_FIXED_FIELD_KEYS = [
  'companyName',
  'representativeName',
  'businessAddress',
  'businessRegistrationNumber',
  'mailOrderRegistrationNumber',
  'privacyOfficer',
  'customerCenter',
  'orderEmail',
  'csHours',
] as const

export const FOOTER_FIXED_FIELD_ORDER = FOOTER_FIXED_FIELD_KEYS

export const FOOTER_POLICY_DOCUMENT_KEYS = [
  'serviceTerms',
  'privacyPolicy',
  'refundPolicy',
] as const

export type FooterFixedFieldKey = (typeof FOOTER_FIXED_FIELD_KEYS)[number]
export type FooterPolicyDocumentKey = (typeof FOOTER_POLICY_DOCUMENT_KEYS)[number]

export interface FooterFixedField {
  label: string
  value: string
  enabled: boolean
}

export interface FooterPolicyDocument {
  label: string
  title: string
  slug: string
  content: string
  enabled: boolean
}

export interface FooterContentConfig {
  fixedFields: Record<FooterFixedFieldKey, FooterFixedField>
  extraNotices: string[]
  policyDocuments: Record<FooterPolicyDocumentKey, FooterPolicyDocument>
}

export type SiteFooterContent = FooterContentConfig

export interface FooterDisplayField extends FooterFixedField {
  key: FooterFixedFieldKey
}

export interface FooterPolicyDisplayLink {
  key: FooterPolicyDocumentKey
  label: string
  title: string
  slug: string
  href: string
}

const FOOTER_FIXED_FIELD_LABELS: Record<FooterFixedFieldKey, string> = {
  companyName: '상호명',
  representativeName: '대표자명',
  businessAddress: '사업장주소',
  businessRegistrationNumber: '사업자등록번호',
  mailOrderRegistrationNumber: '통신판매업 신고번호',
  privacyOfficer: '개인정보책임자',
  customerCenter: '고객센터',
  orderEmail: '상담/주문 이메일',
  csHours: 'CS 운영시간',
}

const DEFAULT_SERVICE_TERMS_CONTENT = `# 서비스 이용약관

## 제1조(목적)
본 약관은 회사가 제공하는 AI 기반 영어·국어 학습자료 생성, 지문 등록, 문항 생성, 문제은행, 시험지 구성·출력, 크레딧 결제 및 기타 부가 서비스의 이용조건과 회사와 회원 사이의 권리·의무 및 책임사항을 정하는 것을 목적으로 합니다.

## 제2조(용어의 정의)
- 서비스: 회사가 웹사이트와 관련 화면을 통해 제공하는 AI 문제 생성, 자료 보관, 문제은행, 시험지 제작·다운로드, 관리자 기능 및 이에 부수하는 서비스를 말합니다.
- 회원: 본 약관에 동의하고 계정을 생성하여 서비스를 이용하는 교사, 학원 운영자, 학생 등 이용자를 말합니다.
- 회원 콘텐츠: 회원이 서비스에 업로드·입력·저장하는 지문, 교재 자료, 이미지, 문항, 해설, 문제지, 메모 및 파일을 말합니다.
- AI 생성 결과물: 회원 콘텐츠 또는 회원의 요청을 바탕으로 서비스가 자동 생성한 문항, 선택지, 해설, 변형 지문, 시험지 구성안 등을 말합니다.
- 크레딧: 유료 기능, AI 생성, 다운로드, 자료 이용 등 회사가 정한 유료서비스의 대가로 사용되는 서비스 내 결제·차감 단위를 말합니다.
- 유료서비스: 크레딧 충전, AI 생성, 문제지 다운로드, 디지털 자료 이용 등 대가 지급이 필요한 서비스를 말합니다.

## 제3조(약관의 효력 및 변경)
본 약관은 서비스 화면에 게시하거나 회원에게 고지함으로써 효력이 발생합니다. 회사는 관련 법령을 위반하지 않는 범위에서 약관을 변경할 수 있으며, 중요한 변경 또는 회원에게 불리한 변경이 있는 경우 시행일, 변경 내용 및 사유를 합리적인 기간 전에 공지합니다.

## 제4조(회원가입 및 계정 관리)
회원은 정확한 정보를 제공해야 하며, 계정과 로그인 수단의 관리 책임은 회원에게 있습니다. 회원은 계정을 제3자에게 양도·대여·공유하거나 타인의 계정을 무단으로 이용해서는 안 됩니다. 계정 도용 또는 무단 사용을 알게 된 경우 즉시 회사에 알려야 합니다.

## 제5조(서비스의 제공 및 변경)
회사는 AI 문항 생성, 지문·자료 등록, 문제은행 관리, 시험지 조립·출력, 결제·크레딧 관리 등 서비스를 제공합니다. 회사는 운영상·기술상 필요가 있는 경우 서비스의 전부 또는 일부를 변경, 중단하거나 점검할 수 있으며, 회원에게 불리한 중요한 변경은 사전에 공지합니다.

## 제6조(크레딧 및 유료서비스)
크레딧의 충전, 사용, 차감, 유효기간, 환불 가능 범위는 서비스 화면 또는 취소/환불정책에서 정한 기준에 따릅니다. 회원이 결제 오류, 중복 결제, 부정 취득, 비정상 사용, 시스템 오류로 크레딧을 취득·사용한 경우 회사는 해당 크레딧을 정정, 회수, 사용 제한하거나 결제를 취소할 수 있습니다. 이미 사용한 크레딧 또는 제공이 완료된 디지털 서비스는 관련 법령과 회사의 취소/환불정책에 따라 환불이 제한될 수 있습니다.

## 제7조(회원 콘텐츠 및 업로드 책임)
회원은 자신이 서비스에 업로드하거나 입력하는 지문, 교재, 이미지, 문항, 해설 등 회원 콘텐츠에 대해 필요한 권리와 이용 권한을 보유해야 합니다. 회원은 저작권, 초상권, 개인정보, 영업비밀, 학교·기관 내부 규정 또는 제3자의 권리를 침해하는 자료를 업로드해서는 안 됩니다. 회원 콘텐츠의 적법성, 정확성, 수업·평가 목적 적합성에 관한 책임은 원칙적으로 회원에게 있습니다.

## 제8조(AI 생성 결과물의 이용)
AI 생성 결과물은 참고용 학습·교육 자료이며, 사실관계, 정답, 해설, 난이도, 저작권 적합성, 교육과정 부합성이 항상 보장되는 것은 아닙니다. 회원은 AI 생성 결과물을 수업, 평가, 배포, 판매 또는 외부 공개 전에 직접 검토·수정해야 하며, 검토 없이 사용하여 발생한 불이익에 대해 회사는 회사의 고의 또는 중대한 과실이 없는 한 책임을 지지 않습니다.

## 제9조(지식재산권)
서비스의 화면, 기능, 데이터베이스, 소프트웨어, 운영 노하우, 기본 프롬프트, 브랜드 및 회사가 제공하는 콘텐츠의 권리는 회사 또는 정당한 권리자에게 귀속됩니다. 회원 콘텐츠의 권리는 회원 또는 해당 권리자에게 귀속됩니다. 회원은 서비스 운영, 저장, 변환, AI 처리, 문제지 생성·출력, 고객지원, 오류 수정, 품질 개선, 법령 준수에 필요한 범위에서 회사가 회원 콘텐츠와 AI 생성 결과물을 이용하는 것에 동의합니다.

## 제10조(금지행위)
회원은 다음 행위를 해서는 안 됩니다.
- 타인의 계정, 결제수단, 개인정보를 도용하거나 허위 정보를 제공하는 행위
- 저작권 등 제3자의 권리를 침해하는 지문·교재·문항·파일을 업로드, 생성, 배포, 판매하는 행위
- 유료 자료, 문제지, AI 생성 결과물, 서비스 화면 또는 데이터베이스를 회사가 허용한 범위를 넘어 복제, 전송, 재판매, 공유, 크롤링, 스크래핑하는 행위
- 크레딧, 결제, 환불, 쿠폰, 프로모션을 부정하게 취득하거나 악용하는 행위
- 서비스의 보안, 운영, 서버, AI 모델 또는 정상적인 이용 흐름을 방해하는 행위
- 불법, 유해, 차별, 혐오, 음란, 폭력, 광고성 콘텐츠를 생성하거나 배포하는 행위

## 제11조(게시물 관리 및 이용제한)
회사는 회원 콘텐츠 또는 이용행위가 본 약관, 관련 법령, 권리자의 신고 또는 서비스 운영정책을 위반한다고 판단되는 경우 해당 콘텐츠를 삭제·비공개 처리하거나 다운로드 제한, 크레딧 사용 보류, 기능 제한, 일시 정지, 회원자격 제한 등 필요한 조치를 할 수 있습니다. 회사는 가능한 범위에서 조치 사유를 회원에게 안내하며, 회원은 고객센터를 통해 소명 또는 이의를 제기할 수 있습니다. 회사는 소명 내용을 검토하여 필요한 경우 조치를 유지, 변경 또는 해제합니다.

## 제12조(계약 해지 및 탈퇴)
회원은 서비스에서 제공하는 절차에 따라 언제든지 탈퇴를 요청할 수 있습니다. 탈퇴 시 회원 데이터는 개인정보처리방침과 관련 법령에서 정한 보관 기준에 따라 처리됩니다. 미사용 크레딧, 결제 취소, 환불은 취소/환불정책 및 관련 법령에 따릅니다. 회원이 본 약관을 중대하게 위반한 경우 회사는 이용계약을 해지할 수 있습니다.

## 제13조(개인정보 보호)
회사는 서비스 제공에 필요한 범위에서 개인정보를 처리하며, 개인정보의 수집, 이용, 보관, 파기, 위탁 및 제3자 제공에 관한 사항은 개인정보처리방침에 따릅니다.

## 제14조(책임 제한)
회사는 천재지변, 통신 장애, 클라우드·결제대행사·AI 제공사 등 제3자 서비스 장애, 회원의 귀책사유로 서비스를 제공할 수 없는 경우 책임을 지지 않습니다. 회사는 회원 콘텐츠의 권리 적합성, AI 생성 결과물의 완전성·정확성, 회원 간 또는 회원과 제3자 간 분쟁에 대해 회사의 고의 또는 중대한 과실이 없는 한 책임을 지지 않습니다.

## 제15조(분쟁 해결 및 준거법)
본 약관은 대한민국 법령에 따라 해석됩니다. 서비스 이용과 관련하여 분쟁이 발생한 경우 회사와 회원은 성실히 협의하며, 협의로 해결되지 않는 분쟁은 관련 법령이 정한 관할 법원 또는 분쟁조정 절차에 따릅니다.

## 제16조(문의)
약관, 크레딧, 저작권 신고, 이용제한에 대한 소명 또는 서비스 이용 문의는 서비스 내 고객센터 또는 푸터에 표시된 연락처로 접수할 수 있습니다.`

const DEFAULT_PRIVACY_POLICY_CONTENT = `# 개인정보처리방침

## 1. 총칙
회사는 개인정보보호법 등 관련 법령을 준수하며, 회원의 개인정보를 서비스 제공에 필요한 범위에서 최소한으로 처리합니다. 본 방침은 회사가 제공하는 AI 학습자료 생성, 지문·문항 관리, 문제지 제작, 크레딧 결제, 고객지원 서비스에 적용됩니다.

## 2. 개인정보의 처리 목적
회사는 다음 목적을 위해 개인정보를 처리합니다.
- 회원가입, 로그인, 본인 식별, 계정 관리 및 부정 이용 방지
- AI 문제 생성, 지문·문항·해설·시험지 저장 및 출력, 문제은행·자료 보관함 제공
- 크레딧 충전·차감, 결제 승인, 결제 내역 관리, 환불 및 정산 처리
- 고객 문의, 환불 요청, 저작권 신고, 이용제한 소명 등 민원 처리
- 서비스 장애 대응, 보안 점검, 접속기록 관리, 통계 및 서비스 품질 개선
- 약관·정책 변경, 중요 공지, 거래 관련 안내 등 고지사항 전달

## 3. 처리하는 개인정보 항목
회사는 서비스 이용 과정에서 다음 항목을 처리할 수 있습니다.
- 회원가입 및 계정: 이메일, 비밀번호, 이름, 휴대폰 번호, 프로필 이미지, 기관·소속, 역할, 가입 경로, 카카오 로그인 이용 시 카카오 식별자·카카오 이메일·카카오 계정에서 제공되는 이름·전화번호
- 서비스 이용: 회원이 입력·업로드한 지문, 교재 자료, 이미지, 문항, 정답, 해설, 문제지, 태그, 출처, AI 생성 요청 내용, AI 생성 결과물, 저장·다운로드·구매·환불·문의 이력
- 결제 및 크레딧: 결제금액, 결제수단, 결제키, 주문번호, 요금제, 크레딧 충전·사용·차감·환불 내역
- 고객지원: 문의 제목과 내용, 답변, 처리 상태, 환불 사유, 관리자 메모
- 자동 생성 정보: IP 주소, User-Agent, 접속 로그, 기기 정보, 브라우저, 운영체제, 세션 정보, 쿠키, 서비스 이용 기록
- 선택 입력 정보: 주소, 생년월일, 성별 등 회원이 프로필 또는 문의 과정에서 직접 입력한 정보
회사는 사상·신념, 정치적 견해, 건강정보 등 민감정보를 의도적으로 수집하지 않습니다. 회원은 지문, 문항, 문의 내용에 개인정보 또는 민감정보가 포함되지 않도록 주의해야 합니다.

## 4. 개인정보의 보유 및 이용기간
회사는 개인정보의 처리 목적이 달성되거나 회원이 탈퇴하면 지체 없이 파기합니다. 다만 관계 법령 또는 분쟁 대응을 위해 필요한 경우 다음 기간 동안 보관할 수 있습니다.
- 계약 또는 청약철회 등에 관한 기록: 5년
- 대금결제 및 재화·서비스 공급에 관한 기록: 5년
- 소비자 불만 또는 분쟁처리에 관한 기록: 3년
- 전자금융거래에 관한 기록: 5년
- 접속 로그 등 통신사실 확인자료: 관련 법령에서 정한 기간
- AI 생성 로그와 오류 분석 자료: 서비스 품질 개선과 장애 대응에 필요한 최소 기간

## 5. 개인정보의 제3자 제공
회사는 회원의 개인정보를 본 방침에서 정한 목적 범위를 넘어 제3자에게 제공하지 않습니다. 다만 회원이 사전에 동의한 경우, 법령에 근거한 요청이 있는 경우, 서비스 제공을 위해 필요한 범위에서 위탁 또는 외부 API 연동이 필요한 경우에는 관련 법령에 따라 처리합니다.

## 6. 개인정보 처리의 위탁 및 외부 서비스 이용
회사는 안정적인 서비스 제공을 위해 다음 업무를 외부 서비스와 연동하거나 위탁할 수 있습니다.
- Supabase: 회원 인증, 데이터베이스, 파일 저장, 세션 관리, 서비스 운영 데이터 보관
- 카카오: 카카오 로그인, 카카오 계정 기반 회원 식별 및 가입 정보 확인
- 토스페이먼츠: 크레딧 결제 승인, 결제수단 처리, 결제 결과 확인 및 환불 처리
- OpenAI, Google Gemini, Anthropic Claude 등 선택된 AI 제공사: 지문·문항·프롬프트 기반 AI 문제 생성, 검토, 문서 분석
회사는 위탁 또는 연동 과정에서 필요한 정보만 전송하도록 노력합니다. 회원이 AI 생성 요청이나 업로드 자료에 개인정보를 포함하면 해당 내용이 AI 처리 과정에 포함될 수 있으므로, 불필요한 개인정보를 입력하지 않아야 합니다.

## 7. 정보주체의 권리와 행사 방법
회원은 언제든지 자신의 개인정보에 대해 열람, 정정, 삭제, 처리정지를 요청할 수 있습니다. 회원은 서비스 내 계정 설정, 마이페이지 또는 고객센터를 통해 권리를 행사할 수 있으며, 회사는 본인 확인 후 관련 법령에 따라 지체 없이 조치합니다. 이미 법령상 보관 의무가 있거나 다른 회원의 권리 보호, 분쟁 대응에 필요한 정보는 삭제 또는 처리정지가 제한될 수 있습니다.

## 8. 개인정보의 파기 절차 및 방법
회사는 보유기간이 경과하거나 처리 목적이 달성된 개인정보를 지체 없이 파기합니다. 전자적 파일은 복구하기 어려운 방법으로 삭제하고, 종이 문서가 있는 경우 분쇄 또는 소각합니다. 백업 데이터는 복구 목적 외로 이용하지 않으며, 보관 주기와 정책에 따라 안전하게 파기합니다.

## 9. 쿠키 등 자동 수집 장치
회사는 로그인 유지, 보안, 사용자 환경 개선, 서비스 이용 통계 분석을 위해 쿠키 등 자동 수집 장치를 사용할 수 있습니다. 회원은 브라우저 설정을 통해 쿠키 저장을 거부하거나 삭제할 수 있습니다. 다만 쿠키를 차단하면 로그인 유지, 결제, 맞춤형 화면 등 일부 기능 이용이 제한될 수 있습니다.

## 10. 개인정보의 안전성 확보 조치
회사는 개인정보 보호를 위해 접근권한 관리, 암호화, 전송구간 보호, 로그 점검, 관리자 권한 제한, 보안 업데이트, 내부 교육 등 기술적·관리적 조치를 시행합니다. 비밀번호와 인증 수단은 회원 본인이 안전하게 관리해야 하며, 공용 기기 이용 후에는 반드시 로그아웃해야 합니다.

## 11. 만 14세 미만 아동의 개인정보
회사는 만 14세 미만 아동의 개인정보를 법정대리인의 동의 없이 수집하지 않습니다. 만 14세 미만 회원의 이용이 필요한 경우 회사는 법정대리인의 동의 확인 등 관련 법령에서 요구하는 절차를 따를 수 있습니다.

## 12. 개인정보 보호책임자
개인정보 처리와 관련한 문의, 불만 처리, 피해 구제 요청은 아래 연락처로 접수할 수 있습니다.
- 개인정보 보호책임자: 관리자
- 이메일: thenaum2030@naver.com
- 문의 채널: 서비스 내 고객센터 또는 푸터에 표시된 연락처

## 13. 개인정보처리방침의 변경
회사는 본 방침을 변경하는 경우 변경 내용과 시행일을 서비스 화면 또는 공지사항을 통해 안내합니다. 회원의 권리 또는 의무에 중대한 영향을 주는 변경은 합리적인 기간 전에 고지합니다.`

const DEFAULT_REFUND_POLICY_CONTENT = `# 취소/환불정책

## 1. 기본 원칙
본 정책은 회사가 제공하는 크레딧 충전, AI 문제 생성, 문제지 다운로드, 디지털 자료 구매 및 기타 유료서비스의 취소와 환불 기준을 정합니다. 개별 상품 또는 이벤트 페이지에 별도 환불 조건이 표시된 경우 해당 조건이 우선 적용되며, 명시되지 않은 사항은 본 정책과 관련 법령에 따릅니다.

## 2. 환불 가능 기준
회원은 결제일로부터 7일 이내에 미사용 크레딧 또는 이용하지 않은 디지털 자료에 대해 환불을 요청할 수 있습니다. 다음의 경우 환불 또는 크레딧 복구를 신청할 수 있습니다.
- 결제 오류, 중복 결제, 승인 실패 후 청구 등 결제 문제가 확인된 경우
- 회사의 시스템 오류 또는 장애로 크레딧이 차감되었으나 AI 생성 결과가 제공되지 않은 경우
- 구매한 디지털 자료의 핵심 내용에 중대한 오류가 있어 정상적인 이용이 어려운 경우
- 회사가 유료서비스를 제공할 수 없다고 판단하여 취소가 필요한 경우

## 3. 환불 제한 기준
다음의 경우에는 환불이 제한될 수 있습니다.
- 결제일로부터 7일이 경과한 경우
- 크레딧을 사용해 AI 생성, 문항 저장, 문제지 생성, 자료 분석 등 유료 기능 이용이 완료된 경우
- 구매한 디지털 자료, 문제지, 파일, 샘플 제외 자료를 다운로드 또는 열람한 경우
- 회원이 입력한 지문, 문항 조건, 프롬프트 오류 또는 단순 변심으로 AI 생성 결과물이 기대와 다르다고 주장하는 경우
- 회원의 귀책 사유, 계정 공유, 부정 사용, 약관 위반으로 서비스 이용이 제한된 경우
- 무상 지급 크레딧, 이벤트 포인트, 쿠폰 등 현금 결제 없이 제공된 혜택인 경우

## 4. 부분 환불 및 차감 기준
일부 크레딧 또는 일부 자료를 사용한 뒤 환불을 요청하는 경우 부분 환불로 처리됩니다. 환불 가능 금액은 결제금액에서 사용한 크레딧의 정상 판매가, 이용 또는 다운로드가 완료된 디지털 자료 금액, 적용된 할인·쿠폰·프로모션 혜택 및 관련 수수료를 차감하여 산정합니다. 산정 결과 환불 가능 금액이 0원 이하인 경우 환불이 불가능합니다.

## 5. 환불 신청 절차
회원은 마이페이지, 환불 요청 화면 또는 고객센터를 통해 환불을 신청할 수 있습니다. 회사는 결제 내역, 크레딧 사용 내역, AI 생성 및 다운로드 기록, 오류 발생 여부를 확인한 뒤 환불 가능 여부와 예상 금액을 안내합니다. 환불 사유 확인을 위해 추가 자료가 필요한 경우 회사는 회원에게 보완을 요청할 수 있으며, 회원이 합리적인 기간 내에 자료를 제출하지 않으면 신청이 보류 또는 취소될 수 있습니다.

## 6. 환불 방식 및 처리 기간
환불은 원 결제수단 또는 결제한 수단으로 처리하는 것을 원칙으로 하며, 임의의 다른 수단으로 전환하여 환불하지 않습니다. 카드 및 간편결제 환불은 토스페이먼츠 등 결제대행사를 통해 승인 취소 또는 환불 요청이 진행되며, 카드사·간편결제사 정책에 따라 영업일 기준 2~5일 이상 소요될 수 있습니다. 환불 승인 후 실제 입금 또는 한도 복구 시점은 결제수단 제공사의 정책에 따릅니다.

## 7. 크레딧 복구 및 접근 권한
시스템 오류 또는 장애로 크레딧이 잘못 차감된 경우 회사는 환불 대신 크레딧 복구로 처리할 수 있습니다. 환불 또는 결제 취소가 완료된 경우 해당 결제로 제공된 크레딧, 디지털 자료, 다운로드 권한, 구매 권한은 회수되거나 제한될 수 있습니다.

## 8. 부정 결제 및 악용 방지
회사는 부정 결제, 명의 도용, 환불 악용, 크레딧 비정상 취득 또는 약관 위반이 의심되는 경우 환불 처리를 보류하고 사실관계를 확인할 수 있습니다. 위반이 확인되면 회사는 환불 거절, 크레딧 회수, 계정 이용제한 등 필요한 조치를 할 수 있습니다.

## 9. 문의
취소/환불과 관련한 문의는 서비스 내 고객센터 또는 푸터에 표시된 연락처로 접수할 수 있습니다. 회사는 관련 법령과 본 정책에 따라 환불 요청을 검토합니다.`

const FOOTER_POLICY_DOCUMENT_DEFAULTS: Record<FooterPolicyDocumentKey, FooterPolicyDocument> = {
  serviceTerms: {
    label: '서비스 이용약관',
    title: '서비스 이용약관',
    slug: 'service',
    content: DEFAULT_SERVICE_TERMS_CONTENT,
    enabled: true,
  },
  privacyPolicy: {
    label: '개인정보처리방침',
    title: '개인정보처리방침',
    slug: 'privacy',
    content: DEFAULT_PRIVACY_POLICY_CONTENT,
    enabled: true,
  },
  refundPolicy: {
    label: '취소/환불정책',
    title: '취소/환불정책',
    slug: 'refund',
    content: DEFAULT_REFUND_POLICY_CONTENT,
    enabled: true,
  },
}

export const FOOTER_FIXED_FIELD_ROWS: FooterFixedFieldKey[][] = [
  ['companyName', 'representativeName', 'businessAddress'],
  ['businessRegistrationNumber', 'mailOrderRegistrationNumber', 'privacyOfficer'],
  ['customerCenter', 'orderEmail', 'csHours'],
]

function createDefaultFixedField(key: FooterFixedFieldKey): FooterFixedField {
  return {
    label: FOOTER_FIXED_FIELD_LABELS[key],
    value: '',
    enabled: true,
  }
}

export function getDefaultFooterContent(): FooterContentConfig {
  return {
    fixedFields: Object.fromEntries(
      FOOTER_FIXED_FIELD_KEYS.map((key) => [key, createDefaultFixedField(key)])
    ) as Record<FooterFixedFieldKey, FooterFixedField>,
    extraNotices: [],
    policyDocuments: Object.fromEntries(
      FOOTER_POLICY_DOCUMENT_KEYS.map((key) => [key, { ...FOOTER_POLICY_DOCUMENT_DEFAULTS[key] }])
    ) as Record<FooterPolicyDocumentKey, FooterPolicyDocument>,
  }
}

export function normalizeFooterContent(
  input?: Partial<FooterContentConfig> | Json | null
): FooterContentConfig {
  const defaults = getDefaultFooterContent()
  const inputFields = (
    input
    && typeof input === 'object'
    && 'fixedFields' in input
    && input.fixedFields
    && typeof input.fixedFields === 'object'
  )
    ? input.fixedFields as Partial<Record<FooterFixedFieldKey, Partial<FooterFixedField> | null>>
    : {}

  const fixedFields = Object.fromEntries(
    FOOTER_FIXED_FIELD_KEYS.map((key) => {
      const value = inputFields[key]
      return [key, {
        label: value?.label?.trim() || defaults.fixedFields[key].label,
        value: typeof value?.value === 'string' ? value.value : defaults.fixedFields[key].value,
        enabled: typeof value?.enabled === 'boolean' ? value.enabled : defaults.fixedFields[key].enabled,
      }]
    })
  ) as Record<FooterFixedFieldKey, FooterFixedField>

  const rawExtraNotices = (
    input
    && typeof input === 'object'
    && 'extraNotices' in input
    && Array.isArray(input.extraNotices)
  )
    ? input.extraNotices as unknown[]
    : []

  const extraNotices = rawExtraNotices
    .filter((notice): notice is string => typeof notice === 'string')
    .map((notice) => notice.trim())
    .filter(Boolean)

  const inputPolicyDocuments = (
    input
    && typeof input === 'object'
    && 'policyDocuments' in input
    && input.policyDocuments
    && typeof input.policyDocuments === 'object'
  )
    ? input.policyDocuments as Partial<Record<FooterPolicyDocumentKey, Partial<FooterPolicyDocument> | null>>
    : {}

  const policyDocuments = Object.fromEntries(
    FOOTER_POLICY_DOCUMENT_KEYS.map((key) => {
      const defaultsForKey = defaults.policyDocuments[key]
      const value = inputPolicyDocuments[key]

      return [key, {
        label: value?.label?.trim() || defaultsForKey.label,
        title: value?.title?.trim() || defaultsForKey.title,
        slug: defaultsForKey.slug,
        content: typeof value?.content === 'string' && value.content.trim()
          ? value.content
          : defaultsForKey.content,
        enabled: typeof value?.enabled === 'boolean' ? value.enabled : defaultsForKey.enabled,
      }]
    })
  ) as Record<FooterPolicyDocumentKey, FooterPolicyDocument>

  return {
    fixedFields,
    extraNotices,
    policyDocuments,
  }
}

export const normalizeSiteFooterContent = normalizeFooterContent
export const getDefaultSiteFooterContent = getDefaultFooterContent

export function getVisibleFooterRows(config: FooterContentConfig): FooterDisplayField[][] {
  return FOOTER_FIXED_FIELD_ROWS
    .map((row) => row
      .map((key) => ({ key, ...config.fixedFields[key] }))
      .filter((field) => field.enabled && field.value.trim()))
    .filter((row) => row.length > 0)
}

export function getFooterBrandName(config: FooterContentConfig) {
  const companyName = config.fixedFields.companyName

  if (companyName.enabled && companyName.value.trim()) {
    return companyName.value.trim()
  }

  return DEFAULT_FOOTER_BRAND_NAME
}

export function getVisibleFooterPolicyLinks(config: FooterContentConfig): FooterPolicyDisplayLink[] {
  return FOOTER_POLICY_DOCUMENT_KEYS
    .map((key) => ({ key, ...config.policyDocuments[key] }))
    .filter((document) => document.enabled && document.label.trim() && document.content.trim())
    .map((document) => ({
      key: document.key,
      label: document.label.trim(),
      title: document.title.trim(),
      slug: document.slug,
      href: `/terms/${document.slug}`,
    }))
}

export function getFooterPolicyDocumentBySlug(config: FooterContentConfig, slug: string) {
  const normalizedSlug = slug.trim()
  const document = FOOTER_POLICY_DOCUMENT_KEYS
    .map((key) => ({ key, ...config.policyDocuments[key] }))
    .find((candidate) => candidate.slug === normalizedSlug)

  if (!document || !document.enabled || !document.content.trim()) {
    return null
  }

  return {
    key: document.key,
    label: document.label.trim(),
    title: document.title.trim(),
    slug: document.slug,
    href: `/terms/${document.slug}`,
    content: document.content,
  }
}

export function getSiteFooterDisplayRows(content?: Partial<FooterContentConfig> | Json | null) {
  const normalized = normalizeFooterContent(content)

  return {
    infoRows: getVisibleFooterRows(normalized).map((row) => row.map((field) => `${field.label}: ${field.value.trim()}`)),
    extraNotices: normalized.extraNotices,
    policyLinks: getVisibleFooterPolicyLinks(normalized),
    brandName: getFooterBrandName(normalized),
  }
}
