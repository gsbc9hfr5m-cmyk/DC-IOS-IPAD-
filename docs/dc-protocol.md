# 디시인사이드 프로토콜 조사 (DC 클리너용)

- 조사일: 2026-11-26
- 조사 방법: 비로그인 상태에서 모바일 웹(m.dcinside.com, msign.dcinside.com)의 HTML과 JS를 정적으로 분석했다.
  - 분석한 파일: `msign/js/common.min.js?v=261012`, `m/js/common.min.js?v=2611251`, `m/js/middle.min.js?v=2611251`, `m/js/gallog.min.js?v=2611191`
- **2차 조사 (같은 날, 로그인 상태)**: 사용자가 내장 브라우저에서 직접 로그인한 뒤, 본인 갤로그의 목록 API를 호출해서 응답 **구조만** 기록했다.
  - 이 문서에는 아이디, 글 내용, 쿠키 값을 남기지 않았다.
  - 삭제 요청은 보내지 않았다.
  - 결과는 §3-3, §6-1에 반영했다.
- 표기
  - ✅ JS 코드에서 직접 확인함 (엔드포인트와 파라미터 이름)
  - ⚠️ 코드로 추정함 (실 응답으로 검증 필요)
  - ❓ 미확인

---

## 0. 설계 제약 (사용자 지시, 2026-11-26)
- 네이티브 앱으로만 만든다. 모든 화면은 React Native 네이티브 컴포넌트로 구현한다. 웹앱, PWA, WebView UI, Capacitor/Ionic/Cordova는 쓰지 않는다.
- WebView는 reCAPTCHA나 Turnstile처럼 통과가 불가피한 캡챠에 한해 시트 안에서만 최소한으로 쓴다.
- 디시와의 통신은 앱 안의 `fetch`로 직접 한다. 별도 서버나 프록시는 두지 않는다.
- 네트워크 요청은 `*.dcinside.com`과 사용자가 고른 캡챠 서비스로만 나간다.

## 1. 공통 사항

| 항목 | 내용 | 상태 |
|---|---|---|
| 도메인 | 로그인은 `msign.dcinside.com`, 그 밖의 기능은 `m.dcinside.com` | ✅ |
| User-Agent | 데스크톱 UA로 `m.dcinside.com/board/...`에 접속하면 `gall.dcinside.com`(PC판)으로 리다이렉트된다. 그래서 **모바일 UA를 반드시 보내야 한다.** | ✅ 관찰 |
| CSRF | 페이지의 `<meta name="csrf-token" content="...">` 값을 모든 AJAX 요청에 `X-CSRF-TOKEN` 헤더로 보낸다. | ✅ |
| 일회성 키 (con_key) | 상태를 바꾸는 요청마다 먼저 `POST /ajax/access`에 `token_verify=<액션명>`을 보낸다. 응답의 `Block_key`를 본 요청에 `con_key`로 넣는다. | ✅ |
| 응답 형식 | JSON이다. 성공은 `result == 1`(또는 `true`), 실패는 `result == 0`이고 이유가 `cause`에 담긴다. | ✅ 코드 / ⚠️ 실응답 |
| 쿠키 | 세션 쿠키는 `withCredentials`로 유지되는 것으로 보인다. 로그인 쿠키의 이름, 도메인, 만료는 ❓ | ❓ |

`token_verify` 액션명 (코드에서 확인): `dc_login`, `board_Del`, `com_submitDel`, `gallogDel`, `com_submit`, `com_submitModfy`, `Modifypw`

> 구현 메모: `/ajax/access`와 `X-CSRF-TOKEN` 패턴은 모든 요청이 공유한다. 디시가 이 패턴을 바꾸면 앱 전체가 깨지므로 `DcClient.acquireConKey(action)` 한 곳에 격리한다.

## 2. 로그인 (msign.dcinside.com)

### 2-1. 로그인 페이지 `GET https://msign.dcinside.com/login?r_url=...` ✅
폼 `#loginProcess`: `POST https://msign.dcinside.com/login`

| 필드 | 설명 |
|---|---|
| `code` | 로그인 ID. 화면 라벨은 "식별 코드"다. ⚠️ 기존 아이디와 같은 값인지 ❓ |
| `password` | 비밀번호 |
| `loginCash` | "로그인 유지" 체크박스. 기본으로 체크되어 있다. |
| `conKey` | hidden 필드. 페이지에 초기값이 있고, 2-2 단계에서 `Block_key`로 교체된다. |
| `r_url` | 로그인 후 돌아갈 URL |
| `_token` | hidden 필드. 비어 있는 상태로 관찰됐다. ❓ 다른 상황에서 채워지는지 |

### 2-2. 사전 검증 `POST https://msign.dcinside.com/login/access` ✅
폼을 제출하기 전에 동기 AJAX로 호출한다.
```
token_verify=dc_login&conKey=<페이지 conKey>&code=<ID>&randcode=<#randCode>&code=<captchaCode>
```
- ⚠️ 원본 JS는 `code` 키를 두 번 보낸다 (ID와 캡챠 코드). 서버가 어느 값을 쓰는지 ❓ 실요청을 관찰해서 그대로 재현해야 한다.
- 응답
  - `result == 1`이면 `Block_key`를 받아 `conKey`에 넣고 폼을 제출한다.
  - `reason == "limit_login"`이면 **이미지 캡챠**가 필요하다. `code`는 캡챠 이미지 URL이고 `randCode`도 함께 온다. 캡챠 입력칸 `#captcha_code`를 표시한다.
  - `reason == "wrong_code"`이면 캡챠 코드가 틀렸으므로 새 이미지를 받는다.
  - 그 밖의 값이면 "다시 시도하십시요."

### 2-3a. 실측 (2026-11-26, 존재하지 않는 테스트 ID로 확인) ✅
- msign 로그인 페이지에도 `<meta name="csrf-token">`이 있다. 원본 JS는 `$.ajaxSetup`으로 모든 AJAX에 `X-CSRF-TOKEN`을 붙인다.
  - 다만 `/login/access`는 이 헤더가 없어도 `{"result":true,"Block_key":"<24자>"}`를 돌려줬다.
- `/login/access`는 아이디가 존재하지 않아도 `result: true`다. 아이디가 맞는지는 이 단계에서 알 수 없다.
- **로그인에 실패하면** `POST /login`이 HTTP 200으로 로그인 페이지를 다시 준다. 리다이렉트도 alert도 없다.
  - 사유는 `<div class="alert-message">`에 있다. 예: "식별 코드 또는 비밀번호가 일치하지 않습니다. 확인 후 다시 입력해 주세요."
- "식별 코드"는 디시가 로그인 아이디를 부르는 새 이름이다. 로그인 화면의 "식별 코드 찾기"(`/find/user_code`)는 고정닉 신청 때 받은 보안 코드로 아이디를 찾는 기능이다.

### 2-3b. 실측 (2026-11-26, 실제 계정) ✅
- ⚠️ `/login/access`에 `Accept: application/json, ...`를 보내면 **HTTP 200 + 빈 본문**이 온다. 원본 jQuery와 같은 `Accept: */*`로 보내야 JSON이 온다.
- 로그인 제출은 브라우저 폼처럼 `Accept: text/html...`로 보낸다.
- 성공 흐름: `POST msign/login` → **307** `sso.dcinside.com/auth/` (POST 유지) → **307** `msign/login` (POST 유지) → 200.
  - 쿠키: `sso_token_dcinside`, `userAgent`(msign), `ssoLid`, `ssoSec`(.sso), `dc_m_login`, `dc_m_date`, `mc_enc`, `remember_secret`(.dcinside.com)
  - 그 뒤 `m.dcinside.com/`에 로그아웃 링크와 내 갤로그 링크가 보인다.
- 진단 도구: `tools/login-diagnose.ps1` (curl), `tools/login-live.ps1` (앱의 DcClient 코드로 실서버 로그인 + 갤로그 조회, 읽기 전용).

### 2-3. 로그인 제출 결과 ❓
- 성공 시 설정되는 쿠키와 리다이렉트 응답: ❓
- 실패할 때의 응답 형식(HTML 에러 페이지인지 JSON인지): ❓
- **로그인 여부 판정 방법(제안)**: `m.dcinside.com` 페이지의 hidden `#user_id`가 비어 있지 않은지 본다. 비로그인 상태의 갤로그 HTML에서는 이 값이 비어 있었다. ⚠️
- 2차 인증(OTP)이 있다: `otpLogin()`이 `POST https://msign.dcinside.com/login`에 `otp_data, con_key, otp_num`을 보낸다. OTP 계정은 수동 입력 시트로 처리한다. ✅ 코드
- 보안 코드 흐름(`/code/confirm`)도 있다. 어떤 계정에 요구되는지 ❓

### 2-4. reCAPTCHA (로그인 관련) ✅ 코드
- `m.dcinside.com/js/common.min.js`의 `#login_process` 폼 핸들러는 `#g-recaptcha` 요소가 있을 때 **reCAPTCHA v3**를 실행한다. sitekey는 `6Lf0R8EUAAAAAHVMRTt4ynVTQE3NkYFOzc_4-THf`, action은 `loginpage`다.
- 이 폼은 m. 도메인에 있는 별도 로그인 폼이다. msign 로그인 폼은 id가 `#loginProcess`라서 다르다. 어느 경로에서 `#g-recaptcha`가 렌더링되는지 ❓
- v3는 사용자가 할 일이 없는 점수 기반 방식이다. 네이티브 fetch로는 토큰을 만들 수 없다. 렌더링되는 경로라면 WebView 시트가 필요하다.

## 3. 내 글/댓글 목록 수집: 모바일 갤로그 (결론: 이 경로를 쓴다)

### 3-1. 갤로그 페이지 `GET https://m.dcinside.com/gallog/{user_id}?menu=...` ✅
- hidden 필드: `g_id`(갤로그 주인), `user_id`(로그인한 사용자, 비로그인이면 빈 값), `user_name`, `profile_img`
- 메뉴 코드 (JS에서 확인)

| menu | 의미 | 상태 |
|---|---|---|
| `G_all` | 게시글 전체 | ✅ 링크 |
| `R_all` | 댓글 전체 | ✅ 링크 |
| `G`, `E`, `N` | 게시글 하위 분류. 삭제 확인 문구가 G_all과 같아서 글 계열이다. 각 코드가 일반/마이너/미니 중 무엇인지는 ❓ | ⚠️ |
| `R`, `D`, `I` | 댓글 하위 분류 (`re_comment` 처리 대상) | ⚠️ |
| `B`, `F`, `O`, `S` | 스크랩 계열. 삭제 대상이 아니다. | ✅ |
| `U` | ❓ (링크로만 존재) | ❓ |
| `search` (+`type`, `s_type`) | 갤로그 검색 | ✅ 코드 |

### 3-2. 페이지 단위 목록 `POST https://m.dcinside.com/ajax/response-galloglist` ✅
```
g_id=<uid>&menu=<menu>&page=<n>&list_more=1[&s_type=..][&confirm_id=..][&app_id=..]
헤더: X-CSRF-TOKEN
```
응답 JSON (렌더링 코드가 참조하는 필드):
- `gallog_info`: `managerskill`(본인 갤로그 여부. true일 때만 삭제 버튼이 나온다), `total_cnt`, `total_cnt_g`, `total_cnt_m`, `total_cnt_mini`
- `gallog_list`: `per_page`, `current_page`, `last_page`, `total`, `next_page_url`, `data[]`
- `data[]` 항목:

| 필드 | 의미 | 상태 |
|---|---|---|
| `no` | 갤로그 로그 번호. **삭제할 때 이 값을 쓴다.** | ✅ |
| `gall_code` | 갤러리 내부 코드(숫자) | ✅ |
| `pno` | 원본 게시글 번호 | ✅ |
| `type` | 갤러리 종류 코드 (아래 표) | ✅ |
| `subject` | 제목 | ✅ |
| `memo` | 댓글 내용 (댓글 메뉴) | ⚠️ |
| `re_comment` | 답글 여부 | ✅ |
| `gall_name`, `name`, `nick_type`, `wdate`, `total_comment` | 표시용 | ✅ |
| `secret`, `anonymity`, `anonymity_secret`, `nodate` | 비밀/익명 표시 | ✅ |
| 추천수, 조회수 | **없음**. 2-3의 추천수/조회수 필터는 원문 조회가 필요하다. | ❓ |

- 갤러리 종류 코드 → URL 경로 (스크랩 렌더링 코드에서 확인) ✅

| type | 경로 | 종류(추정) |
|---|---|---|
| `B`,`F`,`O`,`G`,`M` | `/board/{id}/{no}` | 일반 + 마이너 ⚠️ (모바일은 마이너도 /board) |
| `S`,`X`,`N` | `/mini/{id}/{no}` | 미니 |
| `Q`,`P` | `/person/{id}/{no}` | 인물 |

- `gall_code`를 갤러리 ID로 바꾸려면 `POST /gallog/list-direct`에 `gall_code, gall_type`을 보낸다. 응답은 `{ gall_id }`다. ✅
  - 대상 갤러리 필터링과 백업할 원문 링크를 만드는 데 필요하다. 결과는 캐시한다.
### 3-3. 로그인 상태 실측 결과 ✅ (2026-11-26)
- `page=1`에도 AJAX가 정상 동작한다. 첫 페이지부터 전부 `response-galloglist`로 수집하면 된다.
- 응답은 Laravel 페이지네이터 형식이다: `current_page, data[], first_page_url, from, last_page, last_page_url, next_page_url, path, per_page(=30), prev_page_url, to, total`
  - 숫자 필드의 자료형이 일정하지 않다. `total`은 `G_all`/`R_all`에서는 number, 하위 메뉴에서는 string으로 온다. `total_cnt_g/m/mini`도 string이다. **파서는 `Number()`로 정규화해야 한다.**
- `gallog_info` 추가 필드: `cate_set{...}`, `dcbest_cnt`, `head_text[]{code,name,type}`, `last_update`, `name`, `profile_image`, `total_cnt_person`
- 메뉴 코드의 의미 (건수 합계와 원문 페이지의 `is_minor`/`is_mini` 플래그로 교차 검증함)

| menu | 의미 | 원문 경로 | 근거 |
|---|---|---|---|
| `G_all` | 글 전체 (= G + E + N) | - | 합계 일치 |
| `G` | 일반 갤러리 글 | `/board/{id}/{pno}` | `total_cnt_g`와 일치 |
| `E` | 마이너 갤러리 글 | `/board/{id}/{pno}` (`is_minor=1`) | `total_cnt_m`과 일치 |
| `N` | 미니 갤러리 글 | `/mini/{id}/{pno}` (`is_mini=1`) | `total_cnt_mini`와 일치 |
| `R_all` | 댓글 전체 (= R + D + I) | - | 합계 일치 |
| `R` | 일반 갤러리 댓글 | `/board/...` | ⚠️ 이름과 합계로 추정 |
| `D` | 마이너 갤러리 댓글 | `/board/...` (`is_minor=1`) | 원문 페이지로 확인 |
| `I` | 미니 갤러리 댓글 | `/mini/...` | 표본 원문이 403이었다 (폐쇄된 미니갤로 추정) ⚠️ |
| `U` | 데이터 없음 (용도 ❓) | | |

  - 각 항목의 `type`은 메뉴 코드와 같다(G/E/N/R/D/I). 그래서 **항목의 `type` 하나만 보고 글/댓글 여부와 갤러리 종류를 판정할 수 있다.**
  - 원문 페이지가 403이면 갤러리 폐쇄나 접근 제한일 수 있다. 이런 항목은 백업 실패로 처리하고, 백업 필수 모드에서는 스킵한다.
- `data[]`의 실제 필드: `no, gall_code, code(=gall_code), cid, pno, cno, gno, headnum, type, subject, memo, name, nicktype, wdate, wtime, hit, total_comment, ismember, reg_date, check_comment, re_comment(댓글만)`
  - 렌더링 코드가 쓰는 `nick_type`은 실제로는 **`nicktype`**이다. 앞으로는 JS 코드보다 실측 응답을 기준으로 삼는다.
  - `cno`: 글 항목에서는 `"0"`(1자리), 댓글 항목에서는 5~8자리 숫자다. **댓글 항목의 `cno`는 원문 페이지 HTML에 그대로 나타난다(D 표본에서 확인).** 댓글 번호로 보이므로 `/del/comment`의 `comment_no`로 쓸 수 있다. ⚠️ 삭제로 최종 확인 필요
  - `memo`: **HTML 문자열이다.** 멘션은 `<span class="mention">`, 디시콘은 `<img class="written_dccon" src="https://dcimg5.dcinside.com/dccon.php?...">` 형태로 들어 있고 줄바꿈은 `\n`이다.
    - 앱은 이 HTML을 그대로 렌더링하지 않는다. 텍스트를 추출하고, 디시콘은 `[디시콘]`으로 치환해서 표시한다.
    - 백업에는 원문 HTML과 추출한 텍스트를 함께 저장한다.
  - `pno`: 원글 번호. 댓글 항목에서는 그 댓글이 달린 원글의 번호다.
  - `no`: 갤로그 로그 번호(5자리 문자열). `/gallog/log-del`에 쓴다.
  - `hit`과 `total_comment`는 `null`로 온다. **조회수와 추천수는 목록에서 얻을 수 없다.**
  - 날짜 형식은 글과 댓글이 다르다. 글은 `wdate = "YYYY.MM.DD"`, 댓글은 `"YYYY-MM-DD"`이고, `wtime = "HH:MM:SS"`는 공통이다. 파서는 두 형식을 모두 받아야 한다.
  - `check_comment`: 값은 "0", "1", "3", "5" 중 하나로 관찰됐다. 의미는 ❓
- `/gallog/list-direct` 응답은 `{ gall_id: string }` 형태다. ✅
- CSRF: `response-galloglist`는 `X-CSRF-TOKEN` 헤더와 `X-Requested-With` 헤더가 **없어도 200 JSON을 돌려줬다.** 그래도 디시가 이후 검사를 강화할 수 있으므로 원본처럼 두 헤더를 항상 보낸다.
- UA: 데스크톱 UA로 `m.dcinside.com/gallog/{uid}`를 요청하면 `gallog.dcinside.com/{uid}`(PC판)로 리다이렉트되고, 그 페이지에는 csrf meta가 없다. 모바일 UA가 필수라는 점이 다시 확인됐다.

## 4. 삭제

### 4-A. 갤로그에서 삭제 (권장 1순위) ✅
```
1) POST https://m.dcinside.com/ajax/access   token_verify=gallogDel   → Block_key
2) POST https://m.dcinside.com/gallog/log-del
   no=<data[].no>&g_id=<내 uid>&con_key=<Block_key>[&confirm_id=..][&app_id=..][&del_limit_chk=1]
   헤더: X-CSRF-TOKEN
```
- 글 메뉴에서 삭제하면 확인 문구가 "삭제 시 갤로그와 게시물이 동시에 삭제됩니다"이다. 원글도 같이 지워진다. ✅
- 댓글 메뉴(`R_all`)에서 같은 엔드포인트로 삭제하면 **원본 댓글까지 지워지는지 ❓**. 갤로그 기록만 지워질 수도 있으므로 반드시 검증한다. 원본이 남는다면 4-C를 쓴다.
- 응답
  - `result == 0 && cause == "del_limit"`이면 말머리 삭제 제한이다 (`msg`에 말머리 이름). 재요청에 `del_limit_chk=1`을 붙이면 **매니저 차단을 감수하고** 삭제한다.
    → 앱은 이 항목을 자동으로 재시도하지 않고 "삭제 제한(차단 위험)으로 스킵" 처리한다. 사용자가 개별 확인할 때만 진행한다.
  - `result == 0`이고 다른 `cause`이면 실패로 기록한다.
  - 성공 판정: `result == 1` 이후 목록을 다시 받아서 해당 `no`가 사라졌는지 확인한다(2단 검증).
- 캡챠: 갤로그 페이지에 서버가 `#captcha_div`를 렌더링하면 삭제 전에 캡챠를 띄운다 (`.del-rt` 핸들러가 먼저 검사한다). 렌더링 조건과 제출 경로는 ❓

#### 4-A 실측 (2026-11-26, 사용자 승인을 받고 본인 댓글 2개로 검증) ✅
- `/ajax/access`(`token_verify=gallogDel`) 응답은 `{"result": true, "Block_key": "<42자>"}`이다.
- **원글이 살아 있는 댓글**에 `log-del`을 보냈다.
  - 응답: `200 application/json {"result": true}`
  - 갤로그 목록에서 해당 `no`가 사라졌다.
  - **원글 페이지에서도 해당 `cno`가 사라졌다. 따라서 갤로그 삭제는 원본 댓글까지 지운다.** 댓글도 이 경로 하나로 처리할 수 있다.
- **원글이 이미 삭제된 댓글**에도 `log-del`을 보냈다. 응답은 똑같이 `{"result": true}`였고 갤로그 목록에서도 사라졌다.
  - 갤로그는 원글이 삭제된 뒤에도 그 글에 단 댓글을 계속 보여준다. 이런 "고아 댓글"도 정리할 수 있다.
- **이미 지운 항목에 같은 con_key로 다시 보내면** `200`에 **빈 본문**이 온다. `result: false`가 아니다.
  - → 빈 본문이나 JSON이 아닌 응답은 성공으로 보지 않고 "미확인"으로 기록한다. 이후 목록 재조회로 판정한다.
  - ⚠️ 원인이 con_key 재사용인지, 이미 없는 항목이라서인지는 구분하지 못했다. 엔진은 항목마다 새 con_key를 받는다.
- 이 테스트 동안 `x-ratelimit-remaining`은 정상 범위였다(17 이상).

### 4-B. 게시글 페이지에서 글 삭제 (대체 경로) ✅
```
1) POST /ajax/access   token_verify=board_Del → Block_key
2) POST https://m.dcinside.com/del/board   id=<gall_id>&no=<pno>&con_key=..[&del_limit_chk=1]
```
- 응답
  - `result == 1`이면 성공. 원본 JS는 이후 목록으로 이동한다.
  - `cause`가 있고 `del_limit`가 참이면 말머리 제한이다 (4-A와 같은 정책).
  - `cause == "captcha"`이면 **이미지 캡챠**가 필요하다. 이미지는 `https://m.dcinside.com/captcha/code?id=log_del_botchk&dccode=<ran_code>&type=D`이고, 응답의 `ran_code`를 `rand_code`로 다시 보낸다.
  - 입력값 제출 함수(`captcha_action`)는 이 JS 번들에 없다 ❓ 필드 이름은 `captcha_code`와 `rand_code`일 것으로 추정한다 ⚠️
- 게시글 페이지 hidden 필드: `id, no, board_id, route_id, is_minor, is_mini, is_person, best_chk, con_key, user_id, ismember` 등

### 4-C. 게시글 페이지에서 댓글 삭제 (대체 경로) ✅
```
1) POST /ajax/access   token_verify=com_submitDel → Block_key
2) POST https://m.dcinside.com/del/comment
   comment_no=<댓글번호>&id=<gall_id>&no=<pno>&best_chk=<..>&board_id=<..>&con_key=..[&mode=comment_noti]
```
- `result == 0 && cause == "comment_noti"`: 공지글 댓글을 5분 안에 삭제하면 매니저가 `msg` 사유로 차단한다는 경고다. 재요청에 `mode=comment_noti`를 붙이면 진행된다. → 앱은 **자동으로 스킵**한다.
- 댓글 번호(`comment_no`)를 갤로그 데이터에서 얻을 수 있는지 ❓ (`R_all`의 `no`가 갤로그 로그 번호인지, 댓글 번호인지 확인해야 한다)

## 4-D. 방명록 (spec 2-18) — 2026-11-26 조사

### 방향별 가능 여부
| 방향 | 가능 여부 | 근거 |
|---|---|---|
| 내 갤로그에 달린 방명록 | **가능** | 목록 API와 삭제 API가 있다. 갤로그 주인(`managerskill=true`)에게는 모든 항목에 삭제 버튼이 나온다. |
| 내가 남긴 방명록 (다른 사람 갤로그) | **불가 → 옵션 비활성화** | "내가 쓴 방명록" 목록을 주는 API나 메뉴가 없다. 갤로그 JS와 메뉴에서 찾지 못했다. 찾으려면 남의 갤로그를 하나씩 뒤져야 하는데, 이는 사양 5절(타인 콘텐츠 스크래핑 금지)에 어긋난다. ❓ 디시 앱 전용 API가 따로 있는지는 모른다. |

### 목록 `POST /ajax/response-galloglistGb` ✅ 실측
```
g_id=<내 uid>&menu=U&page=<n>&year=<YYYY>&list_more=1   (헤더: X-CSRF-TOKEN)
```
- 갤로그 화면에서 방명록 메뉴의 코드는 `U`다. 실측해 보니 API는 `menu` 값(U/L)과 상관없이 같은 결과를 돌려줬다.
- **목록은 연도 단위로 조회한다.** `year`를 빼면 올해 목록이 나오고, 기록이 없는 연도는 `total: 0`이다.
- 선택할 수 있는 연도 목록은 갤로그 방명록 페이지 HTML의 `<select onchange="guestBook_change(...)">`에 있는 `<option value="YYYY">`들이다. → 연도별 개수는 연도마다 `total`을 조회해서 구한다.
- 응답은 Laravel 페이지네이터 형식이다 (`per_page: 30`, `total`, `last_page`, …).
  - ⚠️ 실측에서 한 연도의 `total`이 정확히 30, `last_page`가 1이었고 2페이지는 빈 배열이었다. 연도당 30개로 잘리는지, 실제로 30개인지는 확인하지 못했다. 30개가 넘는 연도가 있는 계정으로 검증해야 한다.
- `gallog_info`: `allow_write`, `managerskill`, `total_cnt`, `use_block`, `name`, …
- `data[]` 필드

| 필드 | 의미 | 상태 |
|---|---|---|
| `no` | 방명록 번호. 삭제에 쓴다. | ✅ |
| `headnum` | 답글을 달 때 쓰는 그룹 번호 | ✅ |
| `user_id`, `name`, `nicktype`, `islevel` | 작성자 정보. `islevel == 9`이면 갤로그 링크가 있는 회원이다. | ✅ |
| `ismember` | 회원 번호. `"0"`이면 비회원이고, 이때는 `ip`를 표시한다. | ✅ |
| `memo` | 내용. 원본 JS가 `nl2br`로 표시하므로 줄바꿈이 포함된 텍스트다. | ✅ |
| `write_time` | **`"YYYY.MM.DD HH:MM:SS"`**. 연도와 월 필터에 쓴다. | ✅ |
| `category` | `"0"`이면 비밀글, `"1"`이면 공개 | ✅ |
| `del_scope`, `modify_scope` | 그 항목에 대한 내 권한 (`true`/`null`) | ✅ |
| `reple[]` | 답글 목록 (같은 구조) | ✅ |
| `chk`, `hit`, `homepage`, `subject` | 관찰값은 `"0"` 또는 `null` | ❓ |

### 삭제 `POST /gallog/guestbook_del` ✅ 코드 / ❓ 실응답
```
1) POST /ajax/access   token_verify=guestbookDel → Block_key
2) POST /gallog/guestbook_del   no=<no>&g_id=<내 uid>&con_key=<Block_key>[&del_type=comment][&confirm_id..][&app_id..]
```
- 원본 JS는 갤로그 주인(`managerskill`)이거나 `del_scope`가 참일 때 삭제 버튼을 보여준다.
  - 비회원이 쓴 항목이고 주인이 아니면 비밀번호 입력(`gb_pw_form`: `gb_pw, no, mode, del_type`)을 요구한다. 앱은 이 경우를 지원하지 않는다.
- 답글이 달린 원글을 주인이 지우면 "답글까지 삭제됩니다"를 확인한 뒤 `del_type=comment`를 붙인다.
  → 백업할 때 답글(`reple[]`)도 함께 저장하고, Dry-run에서 "답글 N개도 함께 삭제" 수를 보여준다.
- 응답 `result == 0`이면 `cause`를 표시한다.
  - 권한 없음 응답의 문구는 ❓
  - 엔진은 `result==0`을 "권한 없음"으로 스킵할지 실패로 셀지를 `cause` 문구로 구분해야 한다. 문구를 모르므로, 처음 나오는 `cause`는 디버그 로그로 수집해서 규칙 테이블에 추가한다.
- 캡챠: 갤로그 삭제와 마찬가지로 `#captcha_div`가 있으면 먼저 요구한다. 조건은 ❓
- **실제 삭제 응답은 아직 검증하지 않았다.** 사용자가 고른 방명록 1개로 검증해야 한다.

### 권한 정책 (앱)
- 대상: `managerskill == true`인 내 갤로그에서, `del_scope == true`이거나 주인 권한이 있는 항목
- 삭제 응답이 권한 오류이면 "권한 없음"으로 스킵한다. 실패 횟수에는 세지 않는다.

## 5. 캡챠 정리

| 지점 | 종류 | 근거 | 상태 |
|---|---|---|---|
| 로그인 (`limit_login`) | 이미지 코드 (`code` URL + `randCode`) | msign JS | ✅ 코드 |
| 로그인 (m. 폼, `#g-recaptcha`가 있을 때) | reCAPTCHA v3 (`loginpage`) | m. JS | ✅ 코드, 발생 조건 ❓ |
| 글 삭제 (`cause=captcha`) | 이미지 코드 `/captcha/code?id=log_del_botchk&type=D` | m. JS | ✅ 코드 |
| 갤로그 삭제 (`#captcha_div`) | 서버 렌더링 캡챠, 종류 ❓ | gallog JS | ⚠️ |
| 댓글 작성 | Cloudflare Turnstile (`cf-turnstile-response`) | m. JS | ✅ (삭제 흐름과 무관) |

- 확인된 삭제 캡챠는 **이미지 코드형**이다. 이미지를 네이티브 `Image`로 띄우고 입력받을 수 있으므로 WebView가 필요 없다. 외부 서비스의 이미지 인식 API(ImageToText)에도 대응된다.
- reCAPTCHA v3와 Turnstile은 네이티브 fetch로 토큰을 만들 수 없다. 실제로 요구되는 경우에만 WebView 시트를 쓴다.
- 클라이언트는 `navigator.webdriver`와 WebGL 렌더러(SwiftShader/Mesa/VMware)로 봇을 판정하는 코드를 갖고 있다 (`isBotWebGL`). 지금은 댓글 작성 쿠키(`cmtw_chk`)에만 쓰인다. 서버 측 봇 판정 기준은 ❓

## 6. 차단, 제한, 이상 응답 (DcClient 규칙 테이블 후보)

| 신호 | 출처 | 처리 | 상태 |
|---|---|---|---|
| `cause == "captcha"` / `limit_login` | 삭제/로그인 | 캡챠 흐름 | ✅ |
| `cause == "del_limit"` / `del_limit: true` | 글 삭제 | 스킵하고 "차단 위험" 기록 | ✅ |
| `cause == "comment_noti"` | 댓글 삭제 | 스킵 | ✅ |
| `cause`에 "통신사 IP" / "VPN IP" 포함 | 댓글 작성 | IP 제한이다. 삭제에도 나오면 중단하고 안내한다. | ✅ (작성), ❓ (삭제) |
| `bot == 1` | 계정 찾기 API | 봇 판정. 다른 API에도 나오면 즉시 중단한다. | ✅ (해당 API만) |
| **HTTP 429 `{"message":"Too Many Attempts."}`** | m. 전체 (실측) | 즉시 일시정지 + 쿨다운 (§6-1) | ✅ 실측 |
| HTTP 403 + 본문 "게시물 작성자가 삭제했거나 존재하지 않는 페이지입니다" | 원문 페이지 (실측) | **원글이 삭제된 것이지 차단이 아니다.** 백업은 갤로그 데이터(`subject`, `memo`)만으로 하고, 삭제는 `log-del`로 진행한다. | ✅ 실측 |
| HTTP 403이고 위 문구가 없음 | 원문 페이지 | 차단이나 제한으로 의심한다. 연속으로 나오면 중단한다. | ⚠️ |
| `log-del`이 200에 빈 본문 | 갤로그 삭제 (실측) | 성공으로 보지 않는다. 재조회로 판정한다. | ✅ 실측 |
| Cloudflare 챌린지 HTML | - | 중단 + 쿨다운 | ❓ 미관찰 |
| 응답이 JSON이 아니거나 HTML 로그인 페이지 | - | 세션 만료로 보고 재로그인 | ⚠️ |
| 예상한 JSON 키(`gallog_list.data` 등) 누락 | - | **구조 변경으로 보고 삭제를 중단** | 설계 |
| 데스크톱 UA로 인한 리다이렉트 | - | UA 설정 오류 | ✅ |
| "잠시후 다시 시도해주세요" (timeout) | gallog JS | 백오프 | ✅ |

### 6-1. 레이트리밋 실측 ✅ (2026-11-26)
- 간격 없이 약 15회 연속으로 요청하자 `HTTP 429`와 `{"message":"Too Many Attempts."}`(Laravel throttle)가 돌아왔다.
- 응답 헤더: `x-ratelimit-limit: 20`, `x-ratelimit-remaining: N`. `Retry-After`와 `X-RateLimit-Reset` 헤더는 정상 응답에 없었다.
- **카운터는 엔드포인트 사이에 공유된다.** `response-galloglist`, `list-direct`, 원문 페이지 GET이 모두 같은 카운터를 깎았다(관찰한 remaining: 18→17→16→14→13…).
- 1~2분 뒤에는 다시 `remaining 19`로 회복됐다. 창 길이는 Laravel 기본값인 60초로 추정한다. ⚠️
- 엔진에 주는 함의
  - 앱은 매 응답의 `x-ratelimit-remaining`을 읽는다. 남은 값이 5 이하이면 다음 창까지 대기한다. 429를 받으면 최소 60초 이상 쿨다운하고 지수 백오프한다.
  - 기본 간격은 **요청당 4초 이상**(분당 15회 이하)으로 잡는다. 삭제 1건에 `/ajax/access`와 삭제 요청이 필요하고, 백업용 원문 조회까지 하면 요청이 2~3개다. 따라서 **삭제 처리량은 분당 약 5~7건**이 상한이다.
    - 예: 항목이 1만 개를 넘으면 전부 지우는 데 하루 이상 걸린다. UI에 예상 소요 시간을 표시한다.
  - 수집 단계(30개/페이지)도 같은 카운터를 쓴다. 수집과 삭제의 요청 예산을 하나의 토큰 버킷으로 관리한다.

## 7. 수집 → 삭제 권장 흐름 (안)
1. 로그인 → `m.dcinside.com/gallog/{uid}`를 GET해서 `csrf-token`, `g_id`, `user_id`를 확인한다. 본인 갤로그인지와 `managerskill`을 검사한다.
2. `response-galloglist`로 `G_all`, `R_all`을 끝까지 페이징하며 수집한다 (`last_page` 기준).
3. `gall_code`를 `list-direct`로 갤러리 ID로 바꾼다(캐시). 이어서 필터, 보호 목록, Dry-run을 적용한다.
4. 백업한다. 본문은 `/board|mini|person/{gall_id}/{pno}` 페이지를 GET해서 파싱한다. 댓글은 원글 링크와 `memo`를 저장한다.
5. `log-del`로 삭제한다 (항목마다 새 `con_key`). 응답을 검증하고, 목록을 다시 조회해 2단으로 확인한다.

## 8. 앱 설계에 주는 함의
- 모든 요청에 모바일 Safari UA를 넣는다. 쿠키 저장소는 RN의 기본 쿠키 처리(NSHTTPCookieStorage)에 맡길지, 수동으로 `Cookie` 헤더를 관리할지 3단계에서 정한다. 세션 복원과 마스킹 때문에 수동 관리 쪽으로 기운다.
- 추천수/조회수 필터는 갤로그 데이터에 없다. 원문을 추가로 조회해야 하므로 요청 수가 늘어난다. 이 필터를 켜면 UI에서 경고한다.
- `del_limit`나 `comment_noti` 경고를 앱이 자동으로 수락하면 사용자가 매니저 차단을 당한다. 이런 경고는 **절대 자동으로 진행하지 않는다.**

## 9. 남은 검증 (로그인된 세션 필요)
아래 항목은 사용자가 앱 내 브라우저 창에서 **직접 로그인한 뒤** 네트워크 요청을 관찰해 확인한다. 나는 비밀번호를 입력하지 않는다.
1. `/login/access`, `/login`의 실제 요청 본문과 응답, 성공 시 쿠키 이름과 만료
   - 세션 쿠키는 HttpOnly여서 `document.cookie`로 보이지 않았다. 이름을 확인하려면 로그인 과정의 네트워크 응답을 캡처해야 한다(다음 로그인 때).
2. ~~`response-galloglist` 실제 JSON~~ → §3-3에서 완료
3. ~~`log-del`로 원본 댓글도 삭제되는지~~ → §4-A 실측에서 완료 (삭제된다)
   - `/del/comment`에 `cno`를 넣는 대체 경로는 검증하지 않았다. 4-A가 동작하므로 우선순위를 낮춘다. 4-A가 막히는 경우를 위한 예비 경로로만 둔다. ❓
4. `log-del`의 성공/실패 응답 원문
5. 세션 만료 후 AJAX 응답 형태
6. 차단/레이트리밋 응답은 일부러 유발하지 않는다. 실제로 발생할 때 디버그 로그로 수집해서 규칙 테이블에 추가한다.
