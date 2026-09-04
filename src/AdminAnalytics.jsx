import { useMemo, useState } from "react";

const PAGE_LABELS = {
  calendar: "体重日历",
  settings: "设置",
  "ai-analysis": "AI 健康建议",
  "cloud-sync": "云端同步",
  donation: "打赏作者",
  about: "关于与隐私",
};

function pageLabel(pageKey) {
  return PAGE_LABELS[pageKey] || pageKey || "未知页面";
}

function percent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function userLabel(user) {
  const state = user.state === "active" ? "使用中" : user.state === "archived" ? "已注销" : "已匿名";
  const identity = user.state === "anonymized"
    ? `匿名路径 A${Math.abs(user.userId)}`
    : `${user.displayName || "未设置昵称"} #${user.userId}`;
  return `${identity} · ${state}`;
}

function CtrCell({ value }) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <td className="admin-ctr-cell">
      <strong>{percent(safeValue)}</strong>
      <span aria-hidden="true"><i style={{ width: `${safeValue}%` }} /></span>
    </td>
  );
}

export default function AdminAnalytics({
  analytics = {},
  selectedUserId,
  journey,
  journeyLoading,
  onSelectUser,
  formatTime,
}) {
  const [showAllFeatures, setShowAllFeatures] = useState(false);
  const pages = analytics.pages || [];
  const features = analytics.features || [];
  const users = analytics.users || [];
  const visibleFeatures = showAllFeatures ? features : features.slice(0, 12);
  const eventLabels = { page_view: "进入页面", click: "点击功能" };
  const selectedSummary = useMemo(
    () => users.find((user) => String(user.userId) === String(selectedUserId)),
    [selectedUserId, users],
  );

  return (
    <section className="admin-section admin-analytics-section">
      <div className="admin-section-title">
        <h2>行为分析</h2>
        <span>近 {analytics.windowDays || 7} 天</span>
      </div>
      <p className="admin-security-note">
        功能 CTR 按“点击访问 ÷ 功能曝光访问”计算；页面 CTR 是该页面至少发生一次点击的访问占比。同一次访问内重复点击不会抬高 CTR。
      </p>

      <div className="admin-analytics-kpis" aria-label="行为数据概况">
        <div><strong>{analytics.totals?.users || 0}</strong><span>活跃用户</span></div>
        <div><strong>{analytics.totals?.pageViews || 0}</strong><span>页面访问</span></div>
        <div><strong>{analytics.totals?.clicks || 0}</strong><span>功能点击</span></div>
      </div>

      <div className="admin-analytics-grid">
        <div className="admin-analytics-panel">
          <h3>页面 CTR</h3>
          {pages.length ? (
            <div className="admin-table-wrap">
              <table>
                <thead><tr><th>页面</th><th>访问</th><th>互动访问</th><th>CTR</th><th>点击</th></tr></thead>
                <tbody>
                  {pages.map((page) => (
                    <tr key={page.pageKey}>
                      <td><strong>{pageLabel(page.pageKey)}</strong><small>{page.users} 人</small></td>
                      <td>{page.pageViews}</td>
                      <td>{page.interactiveViews}</td>
                      <CtrCell value={page.ctr} />
                      <td>{page.clicks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="admin-empty">上线后有用户访问才会开始累计</p>}
        </div>

        <div className="admin-analytics-panel">
          <h3>功能 CTR</h3>
          {features.length ? (
            <>
              <div className="admin-table-wrap">
                <table>
                  <thead><tr><th>功能</th><th>页面</th><th>曝光访问</th><th>点击访问</th><th>CTR</th><th>点击</th></tr></thead>
                  <tbody>
                    {visibleFeatures.map((feature) => (
                      <tr key={`${feature.pageKey}:${feature.elementKey}`}>
                        <td><strong>{feature.elementLabel || feature.elementKey}</strong><small>{feature.elementKey}</small></td>
                        <td>{pageLabel(feature.pageKey)}</td>
                        <td>{feature.impressionViews}</td>
                        <td>{feature.clickViews}</td>
                        <CtrCell value={feature.ctr} />
                        <td>{feature.clicks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {features.length > 12 && (
                <button type="button" className="admin-secondary admin-analytics-more" onClick={() => setShowAllFeatures((current) => !current)}>
                  {showAllFeatures ? "收起" : `展开全部 ${features.length} 个功能`}
                </button>
              )}
            </>
          ) : <p className="admin-empty">暂无功能曝光和点击</p>}
        </div>
      </div>

      <div className="admin-journey-panel">
        <div className="admin-journey-heading">
          <div>
            <h3>用户使用路径</h3>
            <p>曝光事件不放进路径，只展示用户进入了哪个页面、点击了什么。</p>
          </div>
          <label>
            <span>选择用户</span>
            <select value={selectedUserId || ""} onChange={(event) => onSelectUser(event.target.value)} disabled={!users.length}>
              {users.length ? users.map((user) => (
                <option key={user.userId} value={user.userId}>{userLabel(user)}</option>
              )) : <option value="">暂无用户</option>}
            </select>
          </label>
        </div>
        {selectedSummary && (
          <div className="admin-journey-summary">
            <span>{selectedSummary.pageViews} 次页面访问</span>
            <span>{selectedSummary.clicks} 次点击</span>
            <span>最近：{formatTime(selectedSummary.lastEventAt)}</span>
          </div>
        )}
        {journeyLoading ? <p className="admin-empty">正在读取路径...</p> : journey?.events?.length ? (
          <div className="admin-table-wrap admin-journey-table">
            <table>
              <thead><tr><th>时间</th><th>页面</th><th>行为</th><th>功能</th></tr></thead>
              <tbody>
                {journey.events.map((event) => (
                  <tr key={event.id}>
                    <td>{formatTime(event.occurredAt)}</td>
                    <td>{pageLabel(event.pageKey)}</td>
                    <td>{eventLabels[event.eventType] || event.eventType}</td>
                    <td>{event.eventType === "click" ? (event.elementLabel || event.elementKey) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="admin-empty">该用户还没有可查看的使用路径</p>}
      </div>
    </section>
  );
}
