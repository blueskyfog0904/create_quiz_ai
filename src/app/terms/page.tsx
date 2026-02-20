import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '이용약관 | AI영어문제팩토리',
  description: '서비스 이용약관 및 개인정보처리방침',
}

export default function TermsPage() {
  return (
    <main className="container mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold mb-10">서비스 이용약관 및 개인정보처리방침</h1>

      <section className="space-y-4 mb-10">
        <h2 className="text-2xl font-bold">서비스 이용약관</h2>

        <article className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
          <h3 className="text-lg font-semibold">제1조(목적)</h3>
          <p className="text-gray-700 leading-relaxed">
            본 약관은 회사가 제공하는 서비스의 이용조건, 절차, 회사와 회원 간의
            권리·의무 및 책임사항을 규정함을 목적으로 합니다.
          </p>

          <h3 className="text-lg font-semibold">제2조(용어의 정의)</h3>
          <p className="text-gray-700 leading-relaxed">
            “서비스”란 회사가 제공하는 AI 기반 중·고등학교 국어/영어 문제 생성 및
            문제은행 기반 문제 제공 등 관련 부가 서비스를 의미합니다.
          </p>
          <p className="text-gray-700 leading-relaxed">
            “회원”이란 카카오 간편가입 등으로 이용계약을 체결하고 서비스를 이용하는 자를 의미합니다.
          </p>
          <p className="text-gray-700 leading-relaxed">
            “콘텐츠”란 회원이 서비스 내에 게시·등록·전송하는 글, 댓글, 이미지, 링크,
            업로드 자료(지문/문서/파일 포함) 등 일체의 정보를 의미합니다.
          </p>
          <p className="text-gray-700 leading-relaxed">
            “문제은행”이란 회사 또는 제3자가 사전에 구축한 문제/지문/해설 등
            데이터베이스를 의미합니다.
          </p>

          <h3 className="text-lg font-semibold">제3조(약관의 효력 및 변경)</h3>
          <p className="text-gray-700 leading-relaxed">
            본 약관은 회원이 동의하고 회사가 이를 서비스 화면에 게시하거나 기타 방법으로
            공지함으로써 효력이 발생합니다.
          </p>
          <p className="text-gray-700 leading-relaxed">
            회사는 관련 법령을 위반하지 않는 범위에서 약관을 변경할 수 있으며, 변경 시
            시행일 7일 전(회원에게 불리한 변경은 30일 전)부터 공지합니다.
          </p>
          <p className="text-gray-700 leading-relaxed">
            회원이 변경 약관 시행일 이후에도 서비스를 계속 이용하는 경우 변경 약관에
            동의한 것으로 봅니다.
          </p>

          <h3 className="text-lg font-semibold">제4조(서비스의 제공 및 변경)</h3>
          <ul className="list-disc pl-6 text-gray-700 leading-relaxed space-y-1">
            <li>AI 기반 중·고등학교 국어/영어 문제 생성 서비스</li>
            <li>문제은행 기반 문제 제공 및 문제지 구성 기능</li>
            <li>기타 회사가 정하는 서비스</li>
          </ul>
          <p className="text-gray-700 leading-relaxed">
            회사는 서비스 운영상·기술상 필요에 따라 서비스의 전부 또는 일부를 변경할 수 있으며,
            변경 시 사전 공지합니다(긴급한 경우 사후 공지 가능).
          </p>

          <h3 className="text-lg font-semibold">제5조(회원가입 및 계정)</h3>
          <p className="text-gray-700 leading-relaxed">
            서비스 이용을 위해서는 카카오 등 소셜 로그인을 통한 회원가입이 필요합니다.
          </p>
          <p className="text-gray-700 leading-relaxed">
            회원은 가입 시 제공하는 정보가 정확해야 하며, 허위 정보로 인한 불이익은 회원에게
            있습니다.
          </p>
          <p className="text-gray-700 leading-relaxed">
            회사는 아래 사유가 있는 경우 가입 승인 거절 또는 사후 이용제한을 할 수 있습니다.
          </p>
          <ul className="list-disc pl-6 text-gray-700 leading-relaxed space-y-1">
            <li>타인 명의 도용, 허위 정보 제공</li>
            <li>서비스 운영을 방해하거나 관련 법령 위반 우려가 있는 경우</li>
            <li>기타 회사가 합리적으로 필요하다고 판단한 경우</li>
          </ul>

          <h3 className="text-lg font-semibold">제6조(회원의 의무)</h3>
          <p className="text-gray-700 leading-relaxed">
            회원은 서비스를 건전하고 올바른 목적으로 이용해야 하며, 다음 행위를
            하여서는 안 됩니다.
          </p>
          <ul className="list-disc pl-6 text-gray-700 leading-relaxed space-y-1">
            <li>타인의 정보 도용 또는 계정 부정 사용</li>
            <li>
              회사의 사전 승낙 없이 서비스 내 정보를 복제·송신·출판·배포·방송 등으로
              영리 목적 이용 또는 제3자에게 이용하게 하는 행위
            </li>
            <li>스팸성 광고 게시, 욕설·비방·명예훼손 등 부적절한 콘텐츠 게시</li>
            <li>불법·유해 정보 유포, 허위정보 유포</li>
            <li>서비스의 정상 운영을 방해하는 행위(어뷰징, 자동화 수단을 통한 과도한 요청 등)</li>
            <li>저작권 등 권리 침해 행위(타인의 교재/시험지/지문 무단 업로드, 무단 전재, 불법 공유 포함)</li>
            <li>기타 법령에 위반되거나 사회질서를 해치는 행위</li>
          </ul>

          <h3 className="text-lg font-semibold">제7조(금지행위 및 제재)</h3>
          <p className="text-gray-700 leading-relaxed">
            회원은 다음과 같은 콘텐츠를 게시하거나 행위를 해서는 안 되며, 회사는 무관용
            원칙으로 조치할 수 있습니다.
          </p>
          <ul className="list-disc pl-6 text-gray-700 leading-relaxed space-y-1">
            <li>음란물, 과도한 폭력적 표현</li>
            <li>차별·혐오 표현(인종, 성별, 장애, 국적 등)</li>
            <li>타인을 괴롭히거나 위협하는 행위</li>
            <li>스팸/도배/광고성 게시물, 사기·불법 홍보</li>
            <li>저작권 침해가 의심되거나 불법 복제물로 판단되는 자료 공유</li>
          </ul>
          <p className="text-gray-700 leading-relaxed">
            위반 시 회사는 사전 통지 없이도 다음 조치를 할 수 있습니다.
          </p>
          <ul className="list-disc pl-6 text-gray-700 leading-relaxed space-y-1">
            <li>게시물 삭제 또는 임시 차단</li>
            <li>이용 제한(일시 정지)</li>
            <li>계정 영구 정지(영구 제명)</li>
            <li>
              위반 행위가 중대하거나 반복되는 경우, 회사는 관련 법령에 따라
              수사기관 등에 협조할 수 있습니다.
            </li>
          </ul>

          <h3 className="text-lg font-semibold">제8조(신고 및 모니터링)</h3>
          <p className="text-gray-700 leading-relaxed">
            회원은 서비스 내 신고 기능 또는 회사가 안내한 연락처를 통해 부적절한 콘텐츠를
            신고할 수 있습니다.
          </p>
          <p className="text-gray-700 leading-relaxed">
            회사는 신고 접수 후 원칙적으로 신속히 검토하여 조치합니다. 단, 사실관계
            확인이 필요한 경우 처리 기간이 늘어날 수 있습니다.
          </p>

          <h3 className="text-lg font-semibold">제9조(지식재산권 및 콘텐츠 이용)</h3>
          <ul className="list-disc pl-6 text-gray-700 leading-relaxed space-y-1">
            <li>서비스 및 서비스에 포함된 회사 제작물(로고, UI, 데이터 편집물 등)에 대한 권리는 회사에 귀속됩니다.</li>
            <li>회원이 서비스에 게시한 콘텐츠의 저작권은 회원에게 귀속됩니다.</li>
            <li>
              다만, 회사는 서비스 운영·노출·검색·품질 개선을 위해 필요한 범위에서
              회원 콘텐츠를 비독점적으로 이용(복제, 전송, 전시, 배포, 2차적 편집)할 수 있습니다.
              회원은 언제든지 게시물 삭제로 이용을 중단시킬 수 있습니다.
            </li>
            <li>
              회원은 타인의 권리를 침해하는 콘텐츠를 게시해서는 안 되며, 침해로 인한
              분쟁은 회원이 책임을 부담합니다.
            </li>
          </ul>

          <h3 className="text-lg font-semibold">제10조(면책 및 책임의 제한)</h3>
          <ul className="list-disc pl-6 text-gray-700 leading-relaxed space-y-1">
            <li>회사는 천재지변, 장애, 통신사고 등 불가항력으로 서비스를 제공할 수 없는 경우 책임을 지지 않습니다.</li>
            <li>회사는 회원의 귀책사유로 인한 서비스 이용 장애에 대해 책임을 지지 않습니다.</li>
            <li>회사는 AI 생성 결과물의 정확성/완전성을 보증하지 않으며, 회원은 생성된 문제를 검토 후 이용해야 합니다.</li>
            <li>회사는 회원이 업로드한 자료의 적법성(저작권 등)에 대해 보증하지 않으며, 이에 대한 책임은 회원에게 있습니다.</li>
          </ul>

          <h3 className="text-lg font-semibold">제11조(계약 해지 및 이용 종료)</h3>
          <ul className="list-disc pl-6 text-gray-700 leading-relaxed space-y-1">
            <li>회원은 언제든지 서비스 내 탈퇴 기능을 통해 이용계약을 해지할 수 있습니다.</li>
            <li>탈퇴 시 회원 데이터는 관련 법령 및 개인정보처리방침에 따라 처리됩니다.</li>
            <li>회사는 회원이 본 약관을 위반한 경우 이용계약을 해지할 수 있습니다.</li>
          </ul>

          <h3 className="text-lg font-semibold">제12조(준거법 및 분쟁해결)</h3>
          <p className="text-gray-700 leading-relaxed">
            본 약관은 대한민국 법령을 준거법으로 합니다.
          </p>
          <p className="text-gray-700 leading-relaxed">
            분쟁이 발생한 경우 회사와 회원은 성실히 협의하며, 협의가 어려운 경우
            관할 법원에 소를 제기할 수 있습니다.
          </p>
        </article>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">개인정보처리방침</h2>

        <article className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
          <h3 className="text-lg font-semibold">1) 개인정보의 처리 목적</h3>
          <p className="text-gray-700 leading-relaxed">
            회사는 다음 목적을 위해 개인정보를 처리합니다.
          </p>
          <ul className="list-disc pl-6 text-gray-700 leading-relaxed space-y-1">
            <li>회원 식별 및 서비스 제공, 본인 확인</li>
            <li>공지/알림 등 커뮤니케이션 제공(선택 동의 포함)</li>
            <li>서비스 개선 및 통계 분석, 부정 이용 방지</li>
          </ul>

          <h3 className="text-lg font-semibold">2) 처리하는 개인정보 항목</h3>
          <p className="text-gray-700 leading-relaxed">
            회사는 최소한의 개인정보를 처리합니다.
          </p>
          <ul className="list-disc pl-6 text-gray-700 leading-relaxed space-y-1">
            <li>필수: 이메일 주소, 닉네임, 연락처(휴대폰 번호)</li>
            <li>선택: 위치정보 제공 동의(위치 기반 기능 제공 시)</li>
          </ul>
          <p className="text-gray-700 leading-relaxed">
            카카오 간편가입을 통해 제공받는 정보는 회원이 카카오에서 동의한 범위 내에서
            처리됩니다.
          </p>

          <h3 className="text-lg font-semibold">3) 개인정보의 보유 및 이용기간</h3>
          <p className="text-gray-700 leading-relaxed">
            원칙적으로 회원 탈퇴 시 지체 없이 파기합니다. 다만, 관계 법령에 따라 보관이
            필요한 경우 해당 법령에서 정한 기간 동안 보관할 수 있습니다.
          </p>

          <h3 className="text-lg font-semibold">4) 개인정보의 제3자 제공</h3>
          <p className="text-gray-700 leading-relaxed">
            회사는 원칙적으로 개인정보를 외부에 제공하지 않습니다. 다만 다음의 경우 예외로
            합니다.
          </p>
          <ul className="list-disc pl-6 text-gray-700 leading-relaxed space-y-1">
            <li>이용자가 사전에 동의한 경우</li>
            <li>법령에 근거하거나 수사 목적으로 적법한 절차에 따라 요청이 있는 경우</li>
          </ul>

          <h3 className="text-lg font-semibold">5) 개인정보 처리의 위탁</h3>
          <p className="text-gray-700 leading-relaxed">
            회사는 서비스 제공을 위해 다음의 같이 개인정보 처리업무를 위탁합니다.
          </p>
          <ul className="list-disc pl-6 text-gray-700 leading-relaxed space-y-1">
            <li>수탁자: Supabase</li>
            <li>위탁 업무: 회원정보 관리 및 인증(로그인/계정)</li>
          </ul>

          <h3 className="text-lg font-semibold">6) 개인정보의 안전성 확보조치</h3>
          <ul className="list-disc pl-6 text-gray-700 leading-relaxed space-y-1">
            <li>관리적: 취급 인원 최소화, 내부 교육</li>
            <li>기술적: 접근권한 관리, 접근통제, 암호화, 보안프로그램 적용</li>
            <li>물리적: 전산/자료보관 접근통제(해당 시)</li>
          </ul>

          <h3 className="text-lg font-semibold">7) 개인정보 보호책임자</h3>
          <ul className="list-disc pl-6 text-gray-700 leading-relaxed">
            <li>개인정보 보호책임자: (직책/성명 기재 권장)</li>
            <li>연락처(이메일): thenaum2030@naver.com</li>
          </ul>

          <h3 className="text-lg font-semibold">8) 정보주체의 권리 및 행사방법</h3>
          <p className="text-gray-700 leading-relaxed">이용자는 관련 법령에 따라 다음 권리를 행사할 수 있습니다.</p>
          <ul className="list-disc pl-6 text-gray-700 leading-relaxed space-y-1">
            <li>개인정보 처리현황 통지 요구, 열람 요구</li>
            <li>정정·삭제 요구, 처리정지 요구</li>
            <li>손해배상 청구</li>
          </ul>
          <p className="text-gray-700 leading-relaxed">
            권리 행사는 서면, 이메일, FAX 등으로 가능하며 회사는 지체 없이 조치합니다.
          </p>

          <h3 className="text-lg font-semibold">9) 개인정보의 파기</h3>
          <ul className="list-disc pl-6 text-gray-700 leading-relaxed space-y-1">
            <li>파기 시점: 처리 목적 달성 또는 보유기간 경과 시 지체 없이 파기</li>
            <li>
              파기 절차: 내부 방침 및 관련 법령에 따라 별도 보관 후 파기 또는 즉시
              파기
            </li>
            <li>
              파기 방법: 전자적 파일은 복구 불가능한 기술적 방법으로 삭제
            </li>
          </ul>

          <h3 className="text-lg font-semibold">10) 개인정보처리방침의 변경</h3>
          <p className="text-gray-700 leading-relaxed">
            본 방침은 시행일로부터 적용되며, 내용 추가/삭제/정정이 있는 경우
            시행 7일 전부터 공지사항을 통해 고지합니다.
          </p>

          <h3 className="text-lg font-semibold">11) 개인정보 열람청구 접수·처리</h3>
          <ul className="list-disc pl-6 text-gray-700 leading-relaxed">
            <li>접수·처리 담당: 김광현(KWANGHYUN KIM)</li>
            <li>이메일: thenaum2030@naver.com</li>
          </ul>
        </article>
      </section>
    </main>
  )
}
