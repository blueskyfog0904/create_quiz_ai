# 비밀번호 재설정 — Supabase 대시보드 설정 안내 (W3-7b)

회원이 비밀번호를 잊었을 때 메일로 재설정하는 기능(W3-7a 코드)이 제대로 돌아가려면, 대표가 Supabase 대시보드에서 아래 설정을 한 번 해야 합니다. 위에서부터 순서대로 따라 하면 됩니다.

- 대상: 이메일+비밀번호로 가입한 일반 회원
- 대상이 아닌 계정(이 기능으로는 재설정되지 않습니다)
  - **카카오로 가입한 회원**: 비밀번호가 없습니다. 카카오 로그인을 쓰도록 안내합니다.
  - **관리자 계정**(내부 아이디 계정, 그리고 실제 이메일을 쓰는 관리자 권한 계정 — 2026-11-17 기준 1개): 요청해도 메일이 가지 않고, 링크로 들어와도 거부됩니다.
    - 관리자 아이디 계정: 관리자 화면의 "관리자 ID 관리"에서 비밀번호를 바꿉니다.
    - 실제 이메일을 쓰는 관리자 권한 계정(대표 본인 계정 등): 로그인돼 있으면 마이페이지 › 회원정보에서, 비밀번호를 잊었으면 Supabase 대시보드 › Authentication › Users 에서 해당 사용자의 비밀번호를 직접 바꿉니다.

### 반드시 이 순서로

1. **메일 템플릿을 먼저 바꿉니다**(1번).
2. **Redirect URLs 허용 목록을 점검합니다**(2번): 우리 사이트가 아닌 도메인이나 넓은 와일드카드(`*.vercel.app`, `https://*` 등)가 없는지 확인합니다.
3. 3·4·5번 설정을 확인합니다.
4. **그 다음에 코드를 배포**합니다.

기본 템플릿(`{{ .ConfirmationURL }}`) 상태로는 이 기능을 쓰지 않습니다. 기본 템플릿의 링크는 "확인 뒤 돌아갈 주소"를 요청 때 받은 값으로 정하므로, 메일 링크가 어디로 가는지가 Redirect URLs 허용 목록에만 의존합니다. 허용 목록에 남의 도메인이나 넓은 와일드카드가 있으면 재설정 링크가 엉뚱한 곳으로 갈 수 있습니다. 1번 템플릿은 Site URL만 쓰므로 이 문제가 없습니다.

템플릿을 바꾼 뒤 코드가 배포되기 전까지는 링크가 가리키는 `/reset-password` 화면이 아직 없습니다("페이지를 찾을 수 없습니다"). 둘 사이 간격은 짧게 두고, 그동안 대시보드에서 복구 메일을 보내지 않습니다.

---

## 1. 메일 템플릿 바꾸기

위치: Supabase 대시보드 › **Authentication** › **Emails** › 템플릿 목록에서 **Reset Password**

### 1-1. 제목 (Subject)

```
[써머썬 연구소] 비밀번호 재설정 안내
```

### 1-2. 본문 (Message body) — 기존 내용을 모두 지우고 아래 전체를 붙여 넣습니다

```html
<div style="margin:0;padding:24px 12px;background-color:#f5f6f8;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:12px;">
    <tr>
      <td style="padding:32px 28px;font-family:'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',sans-serif;color:#111827;font-size:15px;line-height:1.7;">
        <p style="margin:0 0 20px;font-size:14px;font-weight:bold;color:#6b7280;">써머썬 연구소</p>
        <h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;color:#111827;">비밀번호 재설정 안내</h1>
        <p style="margin:0 0 8px;">안녕하세요. 써머썬 연구소입니다.</p>
        <p style="margin:0 0 24px;"><strong>{{ .Email }}</strong> 계정의 비밀번호 재설정 요청을 받았습니다. 아래 버튼을 눌러 새 비밀번호를 설정해 주세요.</p>
        <p style="margin:0 0 24px;text-align:center;">
          <a href="{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery" style="display:inline-block;padding:14px 28px;background-color:#111827;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;border-radius:8px;">비밀번호 재설정하기</a>
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#4b5563;">· 이 링크는 메일을 받은 뒤 <strong>1시간 동안</strong>, <strong>한 번만</strong> 쓸 수 있습니다.</p>
        <p style="margin:0 0 8px;font-size:13px;color:#4b5563;">· 재설정을 요청한 기기가 아닌 다른 기기(예: 휴대폰)에서 열어도 됩니다.</p>
        <p style="margin:0 0 24px;font-size:13px;color:#4b5563;">· 비밀번호를 바꾸면 모든 기기에서 로그아웃되며, 새 비밀번호로 다시 로그인하면 됩니다.</p>
        <p style="margin:0 0 8px;font-size:13px;color:#4b5563;">버튼이 눌리지 않으면 아래 주소를 복사해 브라우저 주소창에 붙여 넣어 주세요.</p>
        <p style="margin:0 0 24px;font-size:12px;color:#6b7280;word-break:break-all;">{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px;">
        <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">비밀번호 재설정을 요청하지 않았다면 이 메일은 무시하셔도 됩니다. 링크를 누르지 않으면 비밀번호는 바뀌지 않습니다.</p>
        <p style="margin:0;font-size:12px;color:#9ca3af;">이 메일은 발신 전용입니다.</p>
      </td>
    </tr>
  </table>
</div>
```

붙여 넣은 뒤 **Save** 를 누릅니다.

### 1-3. 붙여 넣을 때 꼭 확인할 것

- 링크 주소는 반드시 `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery` 모양이어야 합니다. 기본 템플릿의 `{{ .ConfirmationURL }}` 은 **쓰지 않습니다**(다른 기기에서 열 수 없는 링크가 됩니다).
- `{{ .SiteURL }}`, `{{ .TokenHash }}`, `{{ .Email }}` 은 Supabase가 메일을 보낼 때 실제 값으로 바꿔 주는 자리입니다. 중괄호와 점, 대소문자를 그대로 둡니다.
- 본문의 "1시간 동안" 은 3번의 유효 시간 설정과 맞아야 합니다. 3번에서 값을 바꾸면 이 문구도 같이 고칩니다.
- 대시보드의 미리보기(Preview)에서 버튼과 한글이 깨지지 않는지 봅니다.

---

## 2. 사이트 주소 확인

위치: **Authentication** › **URL Configuration**

| 항목 | 넣을 값 | 설명 |
|---|---|---|
| **Site URL** | `https://www.summersuninst.com` | 메일 링크의 `{{ .SiteURL }}` 자리에 그대로 들어갑니다. **끝에 `/` 를 붙이지 않습니다**(붙이면 링크가 `…com//reset-password` 가 됩니다). `www` 를 포함한 운영 주소여야 합니다. |
| **Redirect URLs** | 아래 "점검" 참고 | 1번 템플릿을 쓰는 동안에는 재설정에 쓰이지 않습니다. 카카오 로그인용 항목(`/auth/callback`)은 **지우지 않습니다.** |

**Redirect URLs 점검(배포 전에 꼭)**

- 목록에 **우리 사이트(`https://www.summersuninst.com/…`)가 아닌 도메인**, `*.vercel.app` 같은 **와일드카드 도메인**, `https://*` 같은 넓은 항목이 있으면 지웁니다(개발용 `http://localhost:…` 항목은 남겨도 됩니다).
- `https://www.summersuninst.com/auth/confirm` 을 추가해 둡니다. 템플릿이 기본으로 되돌아갔을 때 링크가 돌아올 곳입니다(평소에는 쓰이지 않습니다).

이미 `https://www.summersuninst.com/**` 처럼 우리 사이트 전체를 허용하는 항목이 있으면 `/auth/confirm` 을 따로 추가하지 않아도 됩니다.

---

## 3. 링크 유효 시간

위치: **Authentication** › **Sign In / Providers** › **Email** › **Email OTP Expiration** (초 단위)

- 권장값: **3600** (1시간). 1번 템플릿의 "1시간 동안" 문구와 같은 값입니다.
- 이 값은 재설정 링크뿐 아니라 가입 확인 메일 등 다른 메일 링크에도 같이 적용됩니다.
- 86400(하루)보다 길게는 설정할 수 없습니다. 길수록 위험하므로 1시간을 넘기지 않기를 권합니다.

---

## 4. 메일 발송 한도

위치: **Authentication** › **Rate Limits**

| 항목 | 권장값 | 설명 |
|---|---|---|
| **Rate limit for sending emails** (시간당 메일 수) | 현재 값: **미확인 — 대시보드에서 실제 값 확인**. 출시할 때 예상 가입·재설정 수에 맞춰 정함(예: 100) | 프로젝트 전체 한도이며 **가입 확인 메일과 합산**됩니다. Supabase 문서는 "직접 연결한 SMTP를 쓰면 이 한도를 설정할 수 있다"고만 합니다. Resend 요금제의 하루·월 발송 한도 안에서 정합니다. |
| 같은 회원의 재요청 간격 | **60초**(Supabase 문서의 기본값) 그대로. 설정 칸의 위치: **미확인 — 대시보드에서 확인**(Rate Limits 또는 Sign In / Providers › Email 아래) | 요청 화면의 안내 문구가 "1분 뒤에 다시 요청"이라고 말합니다. 값을 바꾸면 문구와 어긋납니다. |

한도에 걸리면 회원에게는 평소와 같은 안내("가입된 계정이 있으면 메일을 보냈습니다")가 보이고 메일은 가지 않습니다(가입 여부가 드러나지 않게 하려는 것입니다). "메일이 안 온다"는 문의가 몰리면 이 한도와 Resend 발송 기록을 먼저 확인합니다.

### 결정할 것 — 요청 남용 대책

지금 코드에는 재설정 요청 횟수를 자체적으로 제한하는 장치가 없습니다. 알아 둘 점:

- 재설정 요청은 우리 서버가 Supabase를 대신 호출합니다. 그래서 Supabase의 **IP 기준 제한은 방문자 IP가 아니라 우리 서버(Vercel)의 IP에 걸립니다.** 방문자별로 막아 주지 않습니다.
- 누군가 가입된 주소 여러 개로(또는 한 주소로 1분마다) 반복 요청하면 **프로젝트의 시간당 메일 한도를 다 써 버릴 수 있습니다.** 그동안 다른 회원의 재설정 메일·가입 확인 메일이 나가지 않습니다. 한 회원에게 가는 메일은 60초 간격 제한으로 시간당 최대 60통입니다.
- 권장 대책: Supabase의 **CAPTCHA**(Authentication › Bot and Abuse Protection › Enable CAPTCHA protection, Cloudflare Turnstile 또는 hCaptcha) 켜기. **켜면 코드 수정이 필요합니다**(가입·로그인·재설정 요청 화면에 위젯을 넣고 토큰을 함께 보내야 하며, 수정 없이 켜면 가입·로그인·재설정이 실패할 수 있습니다). 그러므로 코드 작업과 함께 켭니다.
- 그 밖의 선택지: 서버 쪽 요청 횟수 제한(IP·주소별)을 따로 만들기.

출시 전에 "CAPTCHA를 넣을지 / 서버 제한을 만들지 / 당분간 한도 관찰만 할지"를 정해 주세요.

### 함께 확인: Resend 의 링크 추적 끄기

Resend 대시보드 › Domains › `summersuninst.com` › **Click tracking** 이 꺼져 있어야 합니다. 켜져 있으면 Resend가 메일 안의 링크를 자기 주소로 바꿔서, 재설정 링크가 달라지거나 미리 열릴 수 있습니다.

---

## 5. 비밀번호 관련 설정 확인

위치: **Authentication** › **Sign In / Providers** › **Email** (메뉴 이름이 다르면 Email 제공자 설정 안에서 찾습니다)

| 항목 | 권장 | 재설정에 미치는 영향 |
|---|---|---|
| **Minimum password length** (최소 비밀번호 길이) | 지금 화면 문구는 "최소 6자"입니다. 대시보드 값이 6이면 그대로 맞습니다. | 대시보드 값이 6보다 크면, 6~(값-1)자 비밀번호는 화면 검사를 통과한 뒤 Supabase에서 거절되어 "비밀번호가 너무 단순합니다" 안내가 나옵니다. 값을 올리려면(Supabase는 8자 이상을 권합니다) 화면의 길이 규칙도 같이 고쳐야 하므로 코드 작업과 함께 합니다. |
| **Password requirements** (숫자·대소문자·기호 요구) | 지금 값 유지 | 요구 조건이 켜져 있으면 조건에 안 맞는 비밀번호는 위와 같은 안내와 함께 거절됩니다. 화면에는 조건이 따로 안내되지 않습니다. |
| **Secure password change** / "Require reauthentication when changing password" (최근 24시간 안에 로그인한 세션만 재인증 없이 변경) | 켜도 됩니다 | 재설정 링크로 들어오면 방금 만든 세션이라 문서상 "최근 로그인"에 해당합니다. **실제로 통과하는지는 6번 확인 절차로 확인**합니다. |
| **Require current password** (비밀번호를 바꿀 때 현재 비밀번호 요구) | **끔** | 켜면 현재 비밀번호를 모르는 재설정이 막힐 수 있습니다(재설정 세션이 예외인지 문서에서 확인하지 못했습니다). 켜려면 먼저 6번 절차로 재설정이 되는지 확인합니다. |

---

## 6. 설정 뒤 확인 절차

코드가 배포된 뒤, **대표 본인의 시험 계정**(관리자·팀원 계정이 아닌, 이메일+비밀번호로 가입한 외부 주소)으로 확인합니다. 네이버 주소 계정과 Gmail 주소 계정으로 **각각 한 번씩** 합니다.

1. **PC**에서 `https://www.summersuninst.com/login` → "비밀번호를 잊으셨나요?" → 이메일 입력 → "재설정 메일 받기".
   - 화면에 "해당 이메일로 가입된 계정이 있으면 … 메일을 보냈습니다" 안내가 나옵니다.
2. **휴대폰**에서 메일함을 엽니다(네이버 메일 앱 / Gmail 앱).
   - 보낸 사람이 **SMTP 설정에 입력한 값**(2026-11-17 시험 메일에서는 `no-reply@summersuninst.com`, 표시 이름 써머썬연구소)인지, 제목이 "[써머썬 연구소] 비밀번호 재설정 안내"인지, 한글 본문과 버튼이 보이는지 확인합니다. 스팸함에 들어갔는지도 봅니다.
3. 휴대폰에서 "비밀번호 재설정하기" 버튼을 누릅니다.
   - "새 비밀번호 설정" 화면에 **"계속"** 버튼이 나옵니다 → 누릅니다.
   - 새 비밀번호·확인 입력 칸이 나옵니다 → 입력하고 "비밀번호 변경".
   - 로그인 화면으로 이동하고 "비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요." 가 보입니다.
4. 휴대폰에서 **새 비밀번호로 로그인**이 되는지, **옛 비밀번호로는 안 되는지** 확인합니다.
5. **확인 항목**: PC에 재설정 전에 로그인해 둔 창이 있었다면, 새로 고쳤을 때 로그아웃되는지 봅니다(코드는 모든 기기 로그아웃을 요청하지만 실제 동작은 여기서 확인합니다. 로그아웃되지 않으면 알려 주세요).
6. 같은 메일의 버튼을 **한 번 더** 누릅니다 → "계속" → "링크가 만료되었거나 이미 사용되었습니다" 화면과 "재설정 메일 다시 요청하기" 링크가 나와야 합니다.

추가로 한 번씩:

- 가입하지 않은 주소로 요청 → 화면 안내는 1번과 같고, 메일은 오지 않습니다.
- 카카오로 가입한 계정의 이메일로 요청 → 화면 안내는 같고, 메일은 오지 않습니다.
- 관리자 아이디 주소(`…@admin.summersun.local`)로 요청 → "사용할 수 없는 이메일 주소입니다."
- 1분 안에 같은 주소로 두 번 요청 → 화면 안내는 같고, 메일은 한 통만 옵니다.
- **확인 항목**: 대시보드에서 직접 보낸 복구 메일(Authentication › Users › 해당 사용자 › Send password recovery)도 같은 템플릿으로 나가고, 버튼 → "계속" → 새 비밀번호 화면으로 이어지는지 봅니다(같을 것으로 보지만 확인하지 못했습니다).
- **확인 항목**: 5번의 비밀번호 설정을 바꿨다면, 바꾼 상태에서 3~4번 단계가 그대로 되는지 다시 봅니다.

문제가 있으면 Supabase 대시보드 › Authentication › Logs 와 Resend 대시보드의 발송 기록을 봅니다.

---

## 7. 템플릿을 바꾸기 전과 후, 코드는 이렇게 동작합니다

| | 템플릿을 **바꾼 뒤** (1번 적용) | 템플릿을 **바꾸기 전** (Supabase 영문 기본 템플릿, `{{ .ConfirmationURL }}`) |
|---|---|---|
| 메일 링크가 가는 곳 | 우리 사이트 `/reset-password?token_hash=…&type=recovery` | Supabase 주소(`…supabase.co/auth/v1/verify?…`) → 확인 뒤 우리 사이트 `/auth/confirm?code=…` 로 돌아옴 |
| 요청한 **같은 브라우저**에서 열기 | 됩니다 | 됩니다(2번의 Redirect URLs 에 `/auth/confirm` 이 허용돼 있을 때). 바로 새 비밀번호 입력 화면이 나옵니다. |
| **다른 기기·다른 브라우저**에서 열기 (PC 요청 → 휴대폰) | **됩니다** | **안 됩니다.** "이 링크는 재설정을 요청한 브라우저에서만 열 수 있습니다" 화면과 "재설정 메일 다시 요청하기" 링크가 나옵니다. 휴대폰에서 다시 요청하면 그 휴대폰에서는 열 수 있습니다. |
| 메일 서비스가 링크를 미리 열어 보는 경우 | 영향 없음. 화면을 여는 것만으로는 링크가 쓰이지 않고, 사람이 "계속"을 눌러야 쓰입니다. | 링크가 미리 쓰여 버릴 수 있습니다. 그러면 회원이 눌렀을 때 "링크가 만료되었거나 이미 사용되었습니다" 화면이 나옵니다. |
| 만료·이미 쓴 링크 | "계속"을 누른 뒤 "링크가 만료되었거나 이미 사용되었습니다" + 다시 요청 링크 | 같은 화면 |
| Redirect URLs 에 `/auth/confirm` 이 없을 때 | 영향 없음 | Supabase가 링크를 Site URL(홈)로 돌려보내서, 홈 화면만 열리고 재설정 화면은 나오지 않습니다. 사이트는 깨지지 않지만 재설정은 할 수 없습니다. |
| 대시보드에서 직접 보낸 복구 메일(Users › Send password recovery) | 같은 템플릿으로 나갑니다. 위와 같이 동작할 것으로 보지만 **미확인 — 6번에서 확인** | 요청한 브라우저 정보가 없는 링크라 우리 사이트의 재설정 화면으로 이어지지 않을 것으로 봅니다(미확인) |

정리: 템플릿을 바꾸기 전에 코드가 먼저 배포돼도 사이트가 깨지지는 않습니다. 하지만 그 상태에서는 "PC에서 요청 → 휴대폰에서 열기"가 안 되고, 링크 주소가 Redirect URLs 허용 목록에 의존하므로 **기본 템플릿 상태로 운영하지 않습니다.** 맨 위의 순서(템플릿 → 허용 목록 점검 → 배포)를 지킵니다.

---

## 8. 참고 — 화면 흐름과 구현 방식

1. `/login` 의 "비밀번호를 잊으셨나요?" → `/forgot-password` (이메일 입력)
2. 메일의 버튼 → `/reset-password?token_hash=…&type=recovery` ("계속" 버튼)
3. "계속" → 서버(`/auth/confirm`, POST)가 링크를 확인 → `/reset-password` (새 비밀번호 입력)
4. "비밀번호 변경" → 모든 기기에서 로그아웃 요청 → `/login?reset=done` (완료 안내)

- Supabase 공식 문서의 예시는 메일 링크를 `/auth/confirm?token_hash=…` 로 보내고 그 주소를 여는 순간(GET) 바로 확인합니다. 우리는 주소(`/reset-password`)와 방식이 다릅니다: 화면을 여는 것만으로는 링크를 쓰지 않고, "계속" 버튼의 POST에서 확인합니다(메일 서비스의 링크 미리 열기 대비). 그래서 **1번의 링크 주소를 공식 문서 예시로 바꾸면 동작하지 않습니다.**
- "계속" 버튼의 요청은 우리 사이트의 화면에서 보낸 것만 받습니다(다른 사이트가 남의 브라우저로 링크를 제출하는 것 방지).
- 새 비밀번호 입력 화면은 링크를 확인한 뒤 30분 동안, 그 브라우저에서만 열립니다. 그 뒤에는 `/forgot-password` 로 돌아가므로 메일을 다시 요청하면 됩니다. 이 "30분 표시"는 화면을 보여 줄지 정하는 표시일 뿐 보안 장치는 아닙니다(서명이 없어 브라우저에서 직접 만들어 넣을 수 있습니다). 로그인한 사람은 원래 Supabase를 통해 자기 비밀번호를 바꿀 수 있으므로, 이 표시가 새 위험을 만들지는 않습니다.
- 가입 여부를 숨기는 정도: 가입된 주소·가입 안 된 주소·카카오 가입 주소·관리자 권한 주소 모두 화면 안내와 응답에 실리는 쿠키 모양이 같습니다. **응답 시간의 차이는 남습니다**(실제로 메일을 보내는 경우가 조금 더 걸립니다). 관리자 내부 아이디 주소(`…@admin.summersun.local`)만 "사용할 수 없는 이메일 주소입니다"로 다르게 답합니다(가입 화면과 같음, 그 주소의 계정이 있는지와는 무관).

확인한 Supabase 문서: [Password-based Auth](https://supabase.com/docs/guides/auth/passwords), [Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates), [Rate limits](https://supabase.com/docs/guides/auth/rate-limits), [Passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless)(Email OTP Expiration 위치), [Password security](https://supabase.com/docs/guides/auth/password-security), [CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha).

대시보드 메뉴 이름은 Supabase가 가끔 바꿉니다. 위 이름과 다르면 Authentication 아래에서 "Emails / Templates", "URL Configuration", "Providers › Email", "Rate Limits", "Bot and Abuse Protection" 에 해당하는 곳을 찾으면 됩니다. 이 문서의 대시보드 값(현재 한도, 허용 목록, 비밀번호 설정)은 작성할 때 대시보드에서 직접 보지 못했으므로, 표에 "미확인"으로 적은 곳은 실제 값을 확인해 주세요.

---

## 부록. 회원가입 확인 메일 템플릿 (2026-11-19 적용)

위치: **Authentication** › **Emails** › **Confirm sign up**. 재설정 메일과 같은 모양으로 맞췄다. 대시보드에서 직접 넣었고 이 문서가 그 원본이다.

- 링크는 Supabase 기본 링크 `{{ .ConfirmationURL }}`를 **그대로 쓴다.** 가입 코드(`src/app/auth/actions.ts`의 `signUp`)는 돌아올 주소를 따로 주지 않는다. 그래서 링크를 누르면 Supabase가 이메일 인증을 끝낸 뒤 Site URL(첫 화면)로 보낸다. 인증은 Supabase 쪽에서 끝나므로 다른 기기에서 열어도 된다. 회원은 그다음 이메일과 비밀번호로 로그인한다.
- 유효 시간 "1시간"은 3번의 Email OTP Expiration(3600초)과 같은 값이다.
- 메일 서비스가 링크를 미리 열어 보면 그때 인증이 끝나 버릴 수 있다. 그 뒤 회원이 버튼을 누르면 첫 화면에 오류 값이 붙은 채로 열리지만, 이미 인증된 상태라 로그인은 된다.

### 제목

```
[써머썬 연구소] 회원가입 이메일 인증 안내
```

### 본문

```html
<div style="margin:0;padding:24px 12px;background-color:#f5f6f8;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:12px;">
    <tr>
      <td style="padding:32px 28px;font-family:'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',sans-serif;color:#111827;font-size:15px;line-height:1.7;">
        <p style="margin:0 0 20px;font-size:14px;font-weight:bold;color:#6b7280;">써머썬 연구소</p>
        <h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;color:#111827;">이메일 인증 안내</h1>
        <p style="margin:0 0 8px;">안녕하세요. 써머썬 연구소에 가입해 주셔서 감사합니다.</p>
        <p style="margin:0 0 24px;"><strong>{{ .Email }}</strong> 주소로 회원가입 요청을 받았습니다. 아래 버튼을 눌러 이메일 인증을 완료해 주세요.</p>
        <p style="margin:0 0 24px;text-align:center;">
          <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 28px;background-color:#111827;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;border-radius:8px;">이메일 인증하기</a>
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#4b5563;">· 이 링크는 메일을 받은 뒤 <strong>1시간 동안</strong>, <strong>한 번만</strong> 쓸 수 있습니다.</p>
        <p style="margin:0 0 8px;font-size:13px;color:#4b5563;">· 가입한 기기가 아닌 다른 기기(예: 휴대폰)에서 열어도 됩니다.</p>
        <p style="margin:0 0 24px;font-size:13px;color:#4b5563;">· 인증이 끝나면 써머썬 연구소 첫 화면으로 이동합니다. 가입한 이메일과 비밀번호로 로그인해 주세요.</p>
        <p style="margin:0 0 8px;font-size:13px;color:#4b5563;">버튼이 눌리지 않으면 아래 주소를 복사해 브라우저 주소창에 붙여 넣어 주세요.</p>
        <p style="margin:0 0 24px;font-size:12px;color:#6b7280;word-break:break-all;">{{ .ConfirmationURL }}</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px;">
        <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">회원가입을 요청하지 않았다면 이 메일은 무시하셔도 됩니다. 인증하지 않은 계정은 로그인할 수 없습니다.</p>
        <p style="margin:0;font-size:12px;color:#9ca3af;">이 메일은 발신 전용입니다.</p>
      </td>
    </tr>
  </table>
</div>
```
