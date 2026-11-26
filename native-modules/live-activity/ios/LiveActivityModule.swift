import ActivityKit
import ExpoModulesCore

/// 삭제 진행 상황 Live Activity (잠금화면 / Dynamic Island). spec 2-11.
/// JS: src/native/liveActivity.ts 에서 requireOptionalNativeModule('LiveActivity')로 쓴다.
public class LiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LiveActivity")

    Function("isSupported") { () -> Bool in
      if #available(iOS 16.2, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    AsyncFunction("start") { (presetName: String, done: Int, total: Int, remaining: Int, status: String) async throws -> String? in
      guard #available(iOS 16.2, *) else { return nil }
      // 이전 활동이 남아 있으면 정리한다 (한 번에 하나만)
      for activity in Activity<DCCleanerActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      let state = DCCleanerActivityAttributes.ContentState(done: done, total: total, remaining: remaining, status: status)
      let activity = try Activity.request(
        attributes: DCCleanerActivityAttributes(presetName: presetName),
        content: ActivityContent(state: state, staleDate: nil),
        pushType: nil
      )
      return activity.id
    }

    AsyncFunction("update") { (done: Int, total: Int, remaining: Int, status: String) async in
      guard #available(iOS 16.2, *) else { return }
      let state = DCCleanerActivityAttributes.ContentState(done: done, total: total, remaining: remaining, status: status)
      for activity in Activity<DCCleanerActivityAttributes>.activities {
        await activity.update(ActivityContent(state: state, staleDate: nil))
      }
    }

    AsyncFunction("end") { (done: Int, total: Int, status: String) async in
      guard #available(iOS 16.2, *) else { return }
      let state = DCCleanerActivityAttributes.ContentState(done: done, total: total, remaining: max(0, total - done), status: status)
      for activity in Activity<DCCleanerActivityAttributes>.activities {
        await activity.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: .default)
      }
    }
  }
}
