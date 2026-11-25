# DC 클리너

디시인사이드 **본인 계정**의 글, 댓글, 방명록을 조건에 맞춰 일괄 삭제하는 개인용 iOS 앱입니다.
Expo(React Native, SDK 58)와 TypeScript로 만든 네이티브 앱이고, 서버 없이 기기 안에서만 동작합니다.

> 현재 단계: 2단계 (스캐폴딩, 빌드 설정, 리퀴드 글래스 UI 셸). 삭제 기능은 아직 없습니다.
> 전체 Windows 설치 가이드는 12단계에서 정리합니다.

## 문서
- [docs/dc-protocol.md](docs/dc-protocol.md): 디시 요청/응답 조사 결과
- [docs/spec-addenda.md](docs/spec-addenda.md): 원 사양 이후 추가된 규칙

## 빠른 빌드 (Windows, Mac 없음)

### A. GitHub Actions로 서명 없는 IPA 만들기 (Apple Developer 계정 불필요)
1. 이 저장소의 **Actions** 탭에서 **iOS unsigned IPA**를 열고 **Run workflow**를 누릅니다. `main`에 push해도 자동으로 실행됩니다.
2. 실행이 끝나면(약 15~25분) 하단 **Artifacts**에서 `DC-Cleaner-unsigned-ipa`를 받아 압축을 풉니다.
3. Windows PC에 **Sideloadly**를 설치하고 iPhone/iPad를 USB로 연결합니다.
4. Sideloadly에 `.ipa`를 끌어다 놓고 본인 Apple ID로 서명해 설치합니다.
5. 기기에서 **설정 > 일반 > VPN 및 기기 관리**로 들어가 개발자를 신뢰합니다. iOS 16 이상이면 **설정 > 개인정보 보호 및 보안 > 개발자 모드**도 켭니다.

> 무료 Apple ID로 서명한 앱은 **7일마다 다시 서명**해야 합니다 (Sideloadly/AltStore 갱신).

### B. EAS Build (Apple Developer 계정이 있을 때)
```powershell
npm install
npx eas-cli@latest login
npx eas-cli@latest build --platform ios --profile preview
```
- `development`: 개발용 빌드 (expo-dev-client)
- `development-simulator`: 시뮬레이터용 (Mac에서만 의미 있음)
- `preview`: 내부 배포(ad hoc). Apple Developer 계정과 기기 UDID 등록이 필요합니다.
- `production`: App Store용 (지속 실행 모드 때문에 심사를 통과하지 못할 수 있음)

## 개발 명령
```powershell
npm install
npm run typecheck
npm test
npm run check:icons
npx expo lint
npx expo-doctor
```
