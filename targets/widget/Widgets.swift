import ActivityKit
import SwiftUI
import WidgetKit

// 앱이 ExtensionStorage로 써 둔 값을 읽는다 (app.config.ts의 APP_GROUP과 같아야 한다)
private let appGroup = "group.io.github.gsbc9hfr5m.dccleaner"

// MARK: - 홈 화면 위젯: 최근 실행 결과

struct LastRunEntry: TimelineEntry {
  let date: Date
  let deleted: Int
  let lastRunAt: String
  let status: String
}

struct LastRunProvider: TimelineProvider {
  func placeholder(in context: Context) -> LastRunEntry {
    LastRunEntry(date: Date(), deleted: 0, lastRunAt: "-", status: "")
  }

  func getSnapshot(in context: Context, completion: @escaping (LastRunEntry) -> Void) {
    completion(load())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<LastRunEntry>) -> Void) {
    completion(Timeline(entries: [load()], policy: .after(Date().addingTimeInterval(30 * 60))))
  }

  private func load() -> LastRunEntry {
    let d = UserDefaults(suiteName: appGroup)
    return LastRunEntry(
      date: Date(),
      deleted: d?.integer(forKey: "lastDeleted") ?? 0,
      lastRunAt: d?.string(forKey: "lastRunAt") ?? "-",
      status: d?.string(forKey: "lastStatus") ?? ""
    )
  }
}

struct LastRunWidgetView: View {
  var entry: LastRunEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      // 아이콘은 윤곽선만 쓴다 (spec-addenda B)
      Label("DC 클리너", systemImage: "trash")
        .font(.caption)
        .foregroundStyle(.secondary)
      Text("\(entry.deleted)")
        .font(.system(size: 34, weight: .bold, design: .rounded))
        .minimumScaleFactor(0.5)
      Text("개 삭제")
        .font(.caption)
      Spacer(minLength: 0)
      Text(entry.status.isEmpty ? entry.lastRunAt : "\(entry.status) · \(entry.lastRunAt)")
        .font(.caption2)
        .foregroundStyle(.secondary)
        .lineLimit(2)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .containerBackground(for: .widget) { Color.clear }
  }
}

struct LastRunWidget: Widget {
  let kind = "LastRunWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: LastRunProvider()) { entry in
      LastRunWidgetView(entry: entry)
    }
    .configurationDisplayName("최근 삭제")
    .description("마지막 실행의 삭제 건수와 시각을 보여줍니다.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

// MARK: - Live Activity: 진행 중인 삭제 작업

private func progress(_ s: DCCleanerActivityAttributes.ContentState) -> Double {
  s.total > 0 ? Double(s.done) / Double(s.total) : 0
}

struct CleanerLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: DCCleanerActivityAttributes.self) { context in
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Image(systemName: "trash")
          Text(context.attributes.presetName).font(.headline).lineLimit(1)
          Spacer()
          Text(context.state.status).font(.caption).foregroundStyle(.secondary)
        }
        ProgressView(value: progress(context.state))
        Text("\(context.state.done) / \(context.state.total) · 남은 \(context.state.remaining)개")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      .padding()
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: "trash")
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text("\(context.state.remaining)").font(.headline)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 4) {
            Text("\(context.attributes.presetName) · \(context.state.status)").font(.caption).lineLimit(1)
            ProgressView(value: progress(context.state))
          }
        }
      } compactLeading: {
        Image(systemName: "trash")
      } compactTrailing: {
        Text("\(context.state.remaining)")
      } minimal: {
        Image(systemName: "trash")
      }
    }
  }
}

@main
struct DCCleanerWidgets: WidgetBundle {
  var body: some Widget {
    LastRunWidget()
    CleanerLiveActivity()
  }
}
