import { trendFor, breakdownFor, money, tokens, escapeHtml as e } from './domain.js';
import { icon } from './icons.js';

/** SVG 只负责呈现，数据始终从统一汇总函数取得，避免图表与摘要各算一套。 */
export function sparkline(points, color = '#c9e76a') {
  const values = points.map(point => point.costMicros);
  if (!values.some(Boolean)) return '';
  const maximum = Math.max(...values, 1);
  const path = values.map((value, index) => `${index ? 'L' : 'M'}${index / Math.max(values.length - 1, 1) * 110},${28 - value / maximum * 24}`).join(' ');
  return `<svg class="sparkline" viewBox="0 0 112 32" aria-hidden="true"><path d="${path}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function trendChart(projectId, period, id = 'usage') {
  const points = trendFor(projectId, period);
  if (!points.some(point => point.costMicros)) return `<div class="chart-empty">${icon('chart')}<strong>还没有消耗记录</strong><span>所选时间范围内暂无 AI 用量</span></div>`;
  const width = 800, height = 214, left = 48, right = 14, top = 20, bottom = 34;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const ceiling = Math.max(1_000_000, Math.ceil(Math.max(...points.map(point => point.costMicros)) / 1_000_000) * 1_000_000);
  const xy = points.map((point, index) => ({ x: left + index / Math.max(points.length - 1, 1) * plotWidth, y: top + plotHeight - point.costMicros / ceiling * plotHeight }));
  const line = xy.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  const area = `${line} L${xy.at(-1).x},${height - bottom} L${xy[0].x},${height - bottom} Z`;
  return `<div class="chart-surface" data-chart-surface>
    <svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="group" aria-label="${e(projectId ? '项目' : '全局')}费用趋势，USD 演示估算">
      <defs><linearGradient id="${id}-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#c9e76a" stop-opacity=".18"/><stop offset="100%" stop-color="#c9e76a" stop-opacity="0"/></linearGradient></defs>
      ${Array.from({ length: 4 }, (_, index) => {
        const y = top + index * plotHeight / 3;
        const amount = ceiling / 1_000_000 * (3 - index) / 3;
        // 低消耗坐标保留小数，避免 0.33 与 0.67 被取整成重复或不准确的标签。
        const label = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
        return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#303237" stroke-dasharray="3 5"/><text x="${left - 12}" y="${y + 4}" text-anchor="end" class="axis-text">$${label}</text>`;
      }).join('')}
      <path d="${area}" fill="url(#${id}-fill)"/><path d="${line}" stroke="#c9e76a" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" fill="none"/>
      ${points.map((point, index) => {
        const label = `${point.label} · ${money(point.costMicros)} · 输入 ${tokens(point.inputTokens)} / 输出 ${tokens(point.outputTokens)}`;
        return `<circle class="chart-point" cx="${xy[index].x}" cy="${xy[index].y}" r="6" fill="#191b1f" stroke="#c9e76a" stroke-width="2" tabindex="0" role="img" aria-label="${e(label)}" data-chart-tip="${e(label)}"/>`;
      }).join('')}
      ${points.map((point, index) => index === 0 || index === points.length - 1 || index % Math.ceil(points.length / 5) === 0 ? `<text x="${xy[index].x}" y="${height - 9}" class="axis-text" text-anchor="middle">${e(point.label)}</text>` : '').join('')}
    </svg><div class="chart-tooltip" role="status" hidden></div>
  </div>`;
}

export function modelBreakdown(projectId, period) {
  const items = breakdownFor(projectId, period);
  const total = items.reduce((sum, item) => sum + item.costMicros, 0);
  const circumference = 2 * Math.PI * 58;
  let offset = 0;
  return `<div class="model-breakdown ${total ? '' : 'is-empty'}">
    <div class="donut-wrap"><svg class="donut" viewBox="0 0 148 148" role="img" aria-label="按模型划分的估算费用分布，合计 ${e(money(total))}">
      <circle cx="74" cy="74" r="58" fill="none" stroke="#2b2d31" stroke-width="12"/>
      ${items.map(item => { const length = total ? item.costMicros / total * circumference : 0; const arc = `<circle cx="74" cy="74" r="58" fill="none" stroke="${item.color}" stroke-width="12" stroke-dasharray="${Math.max(0, length - (length ? 4 : 0))} ${circumference}" stroke-dashoffset="${-offset}" transform="rotate(-90 74 74)"/>`; offset += length; return arc; }).join('')}
      <text x="74" y="69" text-anchor="middle" class="donut-caption">估算费用</text><text x="74" y="91" text-anchor="middle" class="donut-total">${e(money(total))}</text>
    </svg></div>
    <div class="model-legend">${items.map(item => `<div class="model-legend-item"><span class="legend-dot" style="--model-color:${item.color}"></span><div><strong>${e(item.name)}</strong><span>${tokens(item.inputTokens + item.outputTokens)} Token</span></div><div class="legend-amount"><strong>${money(item.costMicros)}</strong><span>${total ? Math.round(item.costMicros / total * 100) : 0}%</span></div></div>`).join('')}</div>
  </div>`;
}
