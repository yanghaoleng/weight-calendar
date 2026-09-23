import { Fragment, useState } from "react";

const PAGE_LABELS = { calendar: "体重日历", settings: "设置", "ai-analysis": "AI 健康建议", "cloud-sync": "云端同步", donation: "打赏作者", about: "关于与隐私" };
const pageLabel = (key) => PAGE_LABELS[key] || key || "未知页面";

const COLUMNS = [
  { key: "pageKey", label: "功能板块" },
  { key: "label", label: "功能" },
  { key: "exposure", label: "曝光" },
  { key: "clicks", label: "点击" },
  { key: "ctr", label: "CTR" },
];

function columnValue(item, key) {
  switch (key) {
    case "pageKey": return pageLabel(item.pageKey);
    case "label": return item.elementLabel || item.elementKey;
    case "exposure": return item.impressionViews;
    case "clicks": return item.clickViews;
    case "ctr": return item.ctr;
    default: return "";
  }
}

function SortableHeader({ column, sortKey, direction, onSort }) {
  const active = sortKey === column.key;
  const nextDirection = active && direction === "asc" ? "降序" : "升序";
  return (
    <th aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        className={`admin-sort-button ${active ? "is-active" : ""}`}
        aria-label={`按${column.label}${nextDirection}排序`}
        onClick={() => onSort(column.key)}
      >
        <span>{column.label}</span>
        {active && <span className="admin-sort-direction" aria-hidden="true">{direction === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

export default function AdminAnalytics({ analytics = {} }) {
  const [showAllFeatures, setShowAllFeatures] = useState(false);
  const [grouped, setGrouped] = useState(true);
  const [sort, setSort] = useState({ key: "ctr", direction: "desc" });
  const pages = analytics.pages || [];
  const features = analytics.features || [];

  const changeSort = (key) => {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "ctr" ? "desc" : "asc" });
  };

  const sortedFeatures = [...features].sort((left, right) => {
    const leftValue = columnValue(left, sort.key);
    const rightValue = columnValue(right, sort.key);
    const compared = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), "zh-CN", { numeric: true, sensitivity: "base" });
    return sort.direction === "asc" ? compared : -compared;
  });
  const visibleFeatures = showAllFeatures ? sortedFeatures : sortedFeatures.slice(0, 12);

  const groups = [];
  if (grouped) {
    const pageOrder = new Map(pages.map((page, index) => [page.pageKey, index]));
    const groupedByPage = new Map();
    for (const item of visibleFeatures) {
      if (!groupedByPage.has(item.pageKey)) groupedByPage.set(item.pageKey, []);
      groupedByPage.get(item.pageKey).push(item);
    }
    for (const [pageKey, items] of groupedByPage) {
      groups.push({
        pageKey,
        page: pages.find((page) => page.pageKey === pageKey),
        items,
      });
    }
    groups.sort((left, right) => {
      const leftOrder = pageOrder.get(left.pageKey) ?? 99;
      const rightOrder = pageOrder.get(right.pageKey) ?? 99;
      return leftOrder - rightOrder || String(left.pageKey).localeCompare(String(right.pageKey), "zh-CN");
    });
  }

  const pageCount = pages.length;
  const featureCount = features.length;

  return <section className="admin-section admin-analytics-section">
    <div className="admin-section-title"><h2>行为分析</h2><span>近 {analytics.windowDays || 7} 天 · 点击表头排序，默认按转化率从高到低</span></div>
    <p className="admin-security-note">曝光访问指进入页面，点击访问指该次访问发生过互动。同一次访问重复点击不会抬高 CTR。</p>
    <div className="admin-analytics-kpis"><div><strong>{analytics.totals?.users || 0}</strong><span>活跃用户</span></div><div><strong>{analytics.totals?.pageViews || 0}</strong><span>页面访问</span></div><div><strong>{analytics.totals?.clicks || 0}</strong><span>功能点击</span></div></div>

    <div className="admin-analytics-controls">
      <label className="admin-analytics-group-toggle">
        <input type="checkbox" checked={grouped} onChange={(event) => setGrouped(event.target.checked)} />
        <span>按功能板块分组</span>
      </label>
      {featureCount > 12 && <button type="button" className="admin-secondary admin-analytics-more" onClick={() => setShowAllFeatures(!showAllFeatures)}>{showAllFeatures ? "收起" : `展开全部 ${featureCount} 个功能`}</button>}
    </div>

    <div className="admin-table-wrap admin-analytics-table">
      <table>
        <thead>
          <tr>
            {COLUMNS.map((column) => <SortableHeader key={column.key} column={column} sortKey={sort.key} direction={sort.direction} onSort={changeSort} />)}
          </tr>
        </thead>
        <tbody>
          {grouped
            ? groups.map((group) => (
              <Fragment key={group.pageKey}>
                <tr className="admin-analytics-group-head">
                  <td colSpan={COLUMNS.length}>
                    <span>{pageLabel(group.pageKey)}</span>
                    {group.page && <small>{group.page.users} 人 · 曝光 {group.page.pageViews} · 点击 {group.page.interactiveViews} · CTR {Number(group.page.ctr || 0).toFixed(1)}%</small>}
                  </td>
                </tr>
                {group.items.map((item) => (
                  <tr key={`${item.pageKey}:${item.elementKey}`}>
                    <td>{pageLabel(item.pageKey)}</td>
                    <td>{item.elementLabel || item.elementKey}</td>
                    <td>{item.impressionViews}</td>
                    <td>{item.clickViews}</td>
                    <td className="admin-analytics-ctr">{Number(item.ctr || 0).toFixed(1)}%</td>
                  </tr>
                ))}
              </Fragment>
            ))
            : visibleFeatures.map((item) => (
              <tr key={`${item.pageKey}:${item.elementKey}`}>
                <td>{pageLabel(item.pageKey)}</td>
                <td>{item.elementLabel || item.elementKey}</td>
                <td>{item.impressionViews}</td>
                <td>{item.clickViews}</td>
                <td className="admin-analytics-ctr">{Number(item.ctr || 0).toFixed(1)}%</td>
              </tr>
            ))}
          {!visibleFeatures.length && !pageCount && <tr><td colSpan={COLUMNS.length}><p className="admin-empty">暂无功能数据</p></td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}
