# DC 로그인 진단 스크립트 (본인 PC에서 직접 실행)
# - 아이디/비밀번호는 이 창에서만 입력받고, 디시(msign.dcinside.com, m.dcinside.com) 외에는 아무 데도 보내지 않는다.
# - 출력에는 비밀번호, 쿠키 값, 토큰 값이 나오지 않는다. 상태 코드, 이동 경로, 쿠키 "이름"만 나온다.
# 실행: powershell -ExecutionPolicy Bypass -File tools\login-diagnose.ps1
$ErrorActionPreference = 'Stop'
$UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'
$dir = Join-Path $env:TEMP ("dcdiag-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dir | Out-Null
$jar = Join-Path $dir 'cj.txt'
$hdr = Join-Path $dir 'h.txt'
$out = Join-Path $dir 'b.html'
$bodyFile = Join-Path $dir 'form.txt'

function Show-Response([string]$label) {
  $lines = Get-Content $hdr
  $status = ($lines | Where-Object { $_ -match '^HTTP/' } | Select-Object -Last 1)
  $loc = ($lines | Where-Object { $_ -match '^[Ll]ocation:' } | Select-Object -Last 1)
  $cookies = $lines | Where-Object { $_ -match '^[Ss]et-[Cc]ookie:' } | ForEach-Object { ($_ -replace '^[Ss]et-[Cc]ookie:\s*', '') -replace '=.*$', '' }
  Write-Host "[$label] $status"
  if ($loc) { Write-Host "   이동: $(($loc -replace '^[Ll]ocation:\s*', '') -replace '\?.*$', '?...')" }
  if ($cookies) { Write-Host "   쿠키 이름: $($cookies -join ', ')" }
  if (-not $loc) { return '' }
  return ([string]$loc -replace '^[Ll]ocation:\s*', '').Trim()
}

try {
  $id = Read-Host '디시 아이디(식별 코드)'
  $sec = Read-Host '비밀번호' -AsSecureString
  $pw = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))

  # 1) 로그인 페이지
  & curl.exe -s -c $jar -b $jar -A $UA -D $hdr -o $out 'https://msign.dcinside.com/login?r_url=https%3A%2F%2Fm.dcinside.com' | Out-Null
  [void](Show-Response '1 로그인 페이지')
  $html = Get-Content $out -Raw -Encoding UTF8
  $conKey = [regex]::Match($html, '<input[^>]*name="conKey"[^>]*value="([^"]*)"').Groups[1].Value
  $csrf = [regex]::Match($html, 'name="csrf-token" content="([^"]*)"').Groups[1].Value
  Write-Host "   conKey 길이: $($conKey.Length), csrf 길이: $($csrf.Length)"

  # 2) 사전 확인
  $e = { param($s) [uri]::EscapeDataString($s) }
  "token_verify=dc_login&conKey=$(& $e $conKey)&code=$(& $e $id)&randcode=&code=" | Set-Content -NoNewline -Encoding ascii $bodyFile
  & curl.exe -s -c $jar -b $jar -A $UA -D $hdr -o $out -H 'X-Requested-With: XMLHttpRequest' -H "X-CSRF-TOKEN: $csrf" -H 'Referer: https://msign.dcinside.com/login' -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' --data-binary "@$bodyFile" 'https://msign.dcinside.com/login/access' | Out-Null
  [void](Show-Response '2 사전 확인')
  $acc = Get-Content $out -Raw -Encoding UTF8
  $blockKey = [regex]::Match($acc, '"Block_key":"([^"]*)"').Groups[1].Value
  $shown = $acc -replace '"Block_key":"[^"]*"', ('"Block_key":"(길이 ' + $blockKey.Length + ')"')
  $shown = $shown -replace '"code":"[^"]*"', '"code":"(캡챠 URL)"'
  Write-Host "   응답: $shown"
  if (-not $blockKey) { Write-Host '   → Block_key 없음 (캡챠 요구 등). 여기서 멈춤.'; return }

  # 3) 로그인 제출 (리다이렉트는 따라가지 않고 한 단계씩 출력)
  "code=$(& $e $id)&password=$(& $e $pw)&loginCash=on&conKey=$(& $e $blockKey)&r_url=$(& $e 'https://m.dcinside.com')&_token=" | Set-Content -NoNewline -Encoding ascii $bodyFile
  $pw = $null
  & curl.exe -s -c $jar -b $jar -A $UA -D $hdr -o $out -H 'Referer: https://msign.dcinside.com/login' -H 'Content-Type: application/x-www-form-urlencoded' --data-binary "@$bodyFile" 'https://msign.dcinside.com/login' | Out-Null
  $next = Show-Response '3 로그인 제출'
  $page = Get-Content $out -Raw -Encoding UTF8
  $alert = [regex]::Match($page, '<div class="alert-message"[^>]*>([\s\S]*?)</div>').Groups[1].Value -replace '<[^>]+>', '' -replace '\s+', ' '
  if ($alert.Trim()) { Write-Host "   실패 문구: $($alert.Trim())" }
  if ($page -match 'otp_num|form_otpjoin') { Write-Host '   → 2차 인증(OTP) 화면' }
  if (-not $next) {
    $js = [regex]::Match($page, '(location\.(href|replace)[^;]{0,120})').Groups[1].Value
    if ($js) { Write-Host "   스크립트 이동: $($js -replace '\?[^''""]*', '?...')" }
    Write-Host "   본문 길이: $($page.Length), 제목: $([regex]::Match($page, '<title>([^<]*)</title>').Groups[1].Value)"
  }

  # 4) 리다이렉트 따라가기 (최대 6단계). 307/308은 브라우저처럼 POST 본문을 그대로 다시 보낸다.
  function Show-Page([string]$label) {
    $pg = Get-Content $out -Raw -Encoding UTF8
    if (-not $pg) { return }
    $title = [regex]::Match($pg, '<title>([^<]*)</title>').Groups[1].Value
    Write-Host "   [$label 본문] 길이 $($pg.Length), 제목: $title"
    $al = ([regex]::Match($pg, '<div class="alert-message"[^>]*>([\s\S]*?)</div>').Groups[1].Value -replace '<[^>]+>', '' -replace '\s+', ' ').Trim()
    if ($al) { Write-Host "   안내 문구: $al" }
    foreach ($m in [regex]::Matches($pg, '(location\.(href|replace)\s*[=(][^;]{0,100}|<meta[^>]*refresh[^>]*>|<iframe[^>]*src="[^"]*"|<form[^>]*action="[^"]*"|alert\([^)]{0,100}\))')) {
      Write-Host "   - $($m.Value -replace '\?[^''"]*', '?...')"
    }
    if ($pg -match 'otp_num|form_otpjoin') { Write-Host '   → 2차 인증(OTP) 화면' }
    if ($pg -match 'msign\.dcinside\.com/logout') { Write-Host '   → 로그아웃 링크 있음 (로그인 상태)' }
  }
  $lastStatus = (Get-Content $hdr | Where-Object { $_ -match '^HTTP/' } | Select-Object -Last 1)
  for ($i = 1; $next -and $i -le 6; $i++) {
    if ($next -notmatch '^https?://') { $next = "https://msign.dcinside.com$next" }
    if ($lastStatus -match ' 30[78] ') {
      & curl.exe -s -c $jar -b $jar -A $UA -D $hdr -o $out -H 'Referer: https://msign.dcinside.com/login' -H 'Content-Type: application/x-www-form-urlencoded' --data-binary "@$bodyFile" $next | Out-Null
      $label = "4-$i 이동(POST 재전송)"
    } else {
      & curl.exe -s -c $jar -b $jar -A $UA -D $hdr -o $out $next | Out-Null
      $label = "4-$i 이동(GET)"
    }
    $lastStatus = (Get-Content $hdr | Where-Object { $_ -match '^HTTP/' } | Select-Object -Last 1)
    $next = Show-Response $label
    if (-not $next) { Show-Page "4-$i" }
  }
  Remove-Item $bodyFile -Force -ErrorAction SilentlyContinue

  # 쿠키 보관함: 이름과 도메인만
  Write-Host '   쿠키 보관함(도메인 / 이름):'
  Get-Content $jar | Where-Object { $_ -match "`t" } | ForEach-Object { $f = ($_ -replace '^#HttpOnly_', '') -split "`t"; "     $($f[0]) / $($f[5])" } | Sort-Object -Unique | ForEach-Object { Write-Host $_ }
  # 5) 로그인 상태 확인
  & curl.exe -s -c $jar -b $jar -A $UA -D $hdr -o $out 'https://m.dcinside.com/' | Out-Null
  [void](Show-Response '5 모바일 홈')
  $mhome = Get-Content $out -Raw -Encoding UTF8
  Write-Host "   로그아웃 링크: $([bool]($mhome -match 'msign\.dcinside\.com/logout'))"
  Write-Host "   갤로그 링크 있음: $([bool]($mhome -match 'gallog\.dcinside\.com/|/gallog/'))"
}
finally {
  Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host '위 출력 전체를 복사해서 보내 주세요. (비밀번호/쿠키 값은 포함되지 않습니다)'
