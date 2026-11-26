# 앱의 실제 로그인 코드(DcClient)를 PC에서 실서버로 돌려 본다. 읽기만 한다 (삭제 없음).
# 아이디/비밀번호는 이 PowerShell 프로세스의 환경변수로만 넘기고 끝나면 지운다.
# 실행: powershell -ExecutionPolicy Bypass -File tools\login-live.ps1
$id = Read-Host '디시 아이디(식별 코드)'
$sec = Read-Host '비밀번호' -AsSecureString
$env:DC_LIVE = '1'
$env:DC_LIVE_ID = $id
$env:DC_LIVE_PW = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
try {
  npx jest __tests__/live/login.live.test.ts --silent=false --verbose=false
}
finally {
  Remove-Item Env:DC_LIVE, Env:DC_LIVE_ID, Env:DC_LIVE_PW -ErrorAction SilentlyContinue
}