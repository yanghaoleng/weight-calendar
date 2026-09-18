import { Fragment, useEffect, useState } from "react";

const PAGE_LABELS = { calendar: "体重日历", settings: "设置", "ai-analysis": "AI 健康建议", "cloud-sync": "云端同步", donation: "打赏作者", about: "关于与隐私" };
const pageLabel = (key) => PAGE_LABELS[key] || key || "未知页面";

function Funnel({ label, detail, exposure, clicks, ctr }) {
  const ratio = exposure ? Math.min(1, clicks / exposure) : 0;
  return <article className="admin-funnel">
    <header><div><strong>{label}</strong><small>{detail}</small></div><b>{Number(ctr || 0).toFixed(1)}%</b></header>
    <div className="admin-funnel-stage"><span>曝光访问</span><strong>{exposure}</strong></div>
    <svg className="admin-funnel-neck" viewBox="0 0 100 18" preserveAspectRatio="none" aria-hidden="true"><path d={`M0 0 H100 L${50 + ratio * 50} 18 H${50 - ratio * 50} Z`} /></svg>
    <div className="admin-funnel-result"><i style={{ width: `${ratio * 100}%` }} /><span>点击访问</span><strong>{clicks}</strong></div>
  </article>;
}

function elapsed(current, previous) {
  const seconds = Math.max(0, Math.round((Date.parse(current) - Date.parse(previous)) / 1000));
  if (seconds < 60) return `距上一步 ${seconds} 秒`;
  if (seconds < 3600) return `距上一步 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  if (seconds < 86400) return `距上一步 ${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分`;
  return `距上一步 ${Math.floor(seconds / 86400)} 天 ${Math.floor(seconds % 86400 / 3600)} 小时`;
}

function JourneyRow({ user, revision, formatTime }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setError(false);
    fetch(`/api/admin/analytics/user?subject=${encodeURIComponent(user.subjectKey)}&limit=300`, { credentials: "same-origin", signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("读取失败"); return response.json(); })
      .then(setResult).catch((err) => { if (err.name !== "AbortError") setError(true); });
    return () => controller.abort();
  }, [user.subjectKey, revision]);
  const events = (result?.events || []).filter((event) => event.eventType === "click").sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.id - b.id);
  const identity = user.state === "anonymized" ? `匿名 A${Math.abs(user.userId)}` : `${user.displayName || "未设置昵称"} ${user.state === "local" ? "L#" : "#"}${user.subjectId}`;
  return <div className="admin-path-row">
    <div className="admin-path-identity"><strong>{identity}</strong><small>{({ local: "未注册", active: "注册用户", archived: "已注销", anonymized: "已匿名" })[user.state]}</small></div>
    <div className="admin-path-strip" aria-label={`${identity} 的行为路径`}>
      {events.map((event, index) => <Fragment key={event.id}>
        {index > 0 && <span className="admin-path-arrow" aria-hidden="true">→</span>}
        <button type="button" className="admin-path-step" title={`${pageLabel(event.pageKey)} · ${index === 0 ? formatTime(event.occurredAt) : elapsed(event.occurredAt, events[index - 1].occurredAt)}`}>
          {event.elementLabel || event.elementKey}
        </button>
      </Fragment>)}
      {!events.length && <span className="admin-path-empty">{error ? "路径读取失败，请刷新重试" : !result ? "读取中…" : "暂无功能点击"}</span>}
    </div>
  </div>;
}

export default function AdminAnalytics({ analytics = {}, formatTime, revision }) {
  const [showAllFeatures, setShowAllFeatures] = useState(false);
  const [page, setPage] = useState(0);
  const byConversion = (a, b) => b.ctr - a.ctr || b.clicks - a.clicks;
  const pages = [...(analytics.pages || [])].sort(byConversion);
  const features = [...(analytics.features || [])].sort(byConversion);
  const users = analytics.users || [];
  const pageCount = Math.max(1, Math.ceil(users.length / 10));
  const currentPage = Math.min(page, pageCount - 1);
  return <section className="admin-section admin-analytics-section">
    <div className="admin-section-title"><h2>行为分析</h2><span>近 {analytics.windowDays || 7} 天 · 转化率从高到低</span></div>
    <p className="admin-security-note">漏斗按访问去重：曝光访问 → 点击访问。同一次访问重复点击不会抬高 CTR；页面曝光指进入页面，点击指该次访问发生过互动。</p>
    <div className="admin-analytics-kpis"><div><strong>{analytics.totals?.users || 0}</strong><span>活跃用户</span></div><div><strong>{analytics.totals?.pageViews || 0}</strong><span>页面访问</span></div><div><strong>{analytics.totals?.clicks || 0}</strong><span>功能点击</span></div></div>
    <div className="admin-analytics-grid">
      <div className="admin-analytics-panel"><h3>页面 CTR</h3><div className="admin-funnel-list">{pages.map((item) => <Funnel key={item.pageKey} label={pageLabel(item.pageKey)} detail={`${item.users} 人`} exposure={item.pageViews} clicks={item.interactiveViews} ctr={item.ctr} />)}</div>{!pages.length && <p className="admin-empty">暂无页面数据</p>}</div>
      <div className="admin-analytics-panel"><h3>功能 CTR</h3><div className="admin-funnel-list">{(showAllFeatures ? features : features.slice(0, 12)).map((item) => <Funnel key={`${item.pageKey}:${item.elementKey}`} label={item.elementLabel || item.elementKey} detail={pageLabel(item.pageKey)} exposure={item.impressionViews} clicks={item.clickViews} ctr={item.ctr} />)}</div>{!features.length && <p className="admin-empty">暂无功能数据</p>}{features.length > 12 && <button type="button" className="admin-secondary admin-analytics-more" onClick={() => setShowAllFeatures(!showAllFeatures)}>{showAllFeatures ? "收起" : `展开全部 ${features.length} 个功能`}</button>}</div>
    </div>
    <div className="admin-journey-panel"><div className="admin-journey-heading"><div><h3>用户使用路径</h3><p>按时间从左到右；悬停第一步查看完整时间，后续查看距上一步的间隔。每行展示最近 300 条操作日志中的功能点击。</p></div></div>
      {users.slice(currentPage * 10, currentPage * 10 + 10).map((user) => <JourneyRow key={user.subjectKey} user={user} revision={revision} formatTime={formatTime} />)}
      {!users.length && <p className="admin-empty">暂无用户路径</p>}
      {pageCount > 1 && <div className="admin-path-pagination"><button className="admin-secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {pageCount}</span><button className="admin-secondary" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>下一页</button></div>}
    </div>
  </section>;
}
