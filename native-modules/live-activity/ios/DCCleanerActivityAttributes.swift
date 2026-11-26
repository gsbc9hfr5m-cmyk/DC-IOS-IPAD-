import ActivityKit
import Foundation

// 앱(native-modules/live-activity)과 위젯 확장이 같은 정의를 써야 한다. 두 파일을 함께 고친다.
struct DCCleanerActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var done: Int
    var total: Int
    var remaining: Int
    /// "삭제 중" / "일시정지됨" / "캡챠 필요" 등
    var status: String
  }

  var presetName: String
}
