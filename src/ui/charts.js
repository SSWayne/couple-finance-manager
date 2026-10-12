/**
 * Chart.js 按需註冊（只載入用到的元件，減少打包體積）。
 * 收支長條圖：收入往上、支出往下；平時灰色，強調中的那一根以斜線紋理上色並跟著滑鼠移動；黃色結餘線。
 */
import { Chart, BarController, BarElement, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler } from 'chart.js';
import { formatMoney } from '../lib/money.js';

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler);
Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--cf-font').trim() || 'Inter, sans-serif';
Chart.defaults.color = '#8A918B';

const COLORS = {
  gray: '#ECEDEB',
  grayDark: '#E2E4E0',
  lime: '#A9D94F',
  limeDark: '#8DBF35',
  orange: '#F5B26B',
  orangeDark: '#E99A45',
  yellow: '#E2D640',
  text: '#202421',
};

/** 斜線紋理（canvas pattern，CSP 不受影響）。 */
export function hatchPattern(base, stripe, size = 10) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = stripe;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  for (let i = -size; i <= size * 2; i += size / 2) {
    ctx.moveTo(i, size);
    ctx.lineTo(i + size, 0);
  }
  ctx.stroke();
  return ctx.createPattern(c, 'repeat');
}

/** 1234567 → 123萬；12000 → 1.2萬；800 → 800 */
export function compactMoney(v) {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 10000) return `${sign}${Number((abs / 10000).toFixed(abs >= 100000 ? 0 : 1))}萬`;
  return `${sign}${abs}`;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ labels: string[], titles: string[], series: {income:number,expense:number,net:number}[], defaultIndex: number, onActiveChange?: (i:number)=>void }} opts
 */
export function createCashflowChart(canvas, { labels, titles, series, defaultIndex, onActiveChange }) {
  let active = defaultIndex;
  const incomePattern = hatchPattern(COLORS.lime, COLORS.limeDark);
  const expensePattern = hatchPattern(COLORS.orange, COLORS.orangeDark);

  const setActive = (i, chart) => {
    if (i === active) return;
    active = i;
    chart.update('none');
    onActiveChange?.(i);
  };

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          type: 'line',
          label: '結餘',
          data: series.map((s) => s.net),
          borderColor: COLORS.yellow,
          borderWidth: 2.5,
          // monotone：曲線不會超出相鄰資料點，避免 0 元的日子看起來像負值
          cubicInterpolationMode: 'monotone',
          pointRadius: (ctx) => (ctx.dataIndex === active ? 4 : 0),
          pointBackgroundColor: COLORS.yellow,
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          order: 0,
        },
        {
          type: 'bar',
          label: '收入',
          data: series.map((s) => s.income),
          backgroundColor: (ctx) => (ctx.dataIndex === active ? incomePattern : COLORS.gray),
          borderRadius: 8,
          borderSkipped: false,
          stack: 'flow',
          order: 1,
        },
        {
          type: 'bar',
          label: '支出',
          data: series.map((s) => -s.expense),
          backgroundColor: (ctx) => (ctx.dataIndex === active ? expensePattern : COLORS.grayDark),
          borderRadius: 8,
          borderSkipped: false,
          stack: 'flow',
          order: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      interaction: { mode: 'index', intersect: false },
      datasets: { bar: { categoryPercentage: 0.78, barPercentage: 0.82, maxBarThickness: 46 } },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          border: { display: false },
          ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 8, font: { size: 11 } },
        },
        y: {
          stacked: true,
          grid: { color: '#F0F1EF' },
          border: { display: false },
          ticks: { callback: (v) => compactMoney(v), maxTicksLimit: 6, font: { size: 11 } },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#FFFFFF',
          titleColor: COLORS.text,
          bodyColor: COLORS.text,
          borderColor: '#E4E6E2',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 10,
          boxPadding: 4,
          usePointStyle: true,
          callbacks: {
            title: (items) => titles[items[0].dataIndex],
            label: (item) => `${item.dataset.label}：${formatMoney(Math.abs(item.raw))}${item.dataset.label === '結餘' && item.raw < 0 ? '（赤字）' : ''}`,
            labelColor: (item) => {
              const c = item.dataset.label === '收入' ? COLORS.lime : item.dataset.label === '支出' ? COLORS.orange : COLORS.yellow;
              return { backgroundColor: c, borderColor: c };
            },
          },
        },
      },
      onHover: (evt, _elements, c) => {
        const els = c.getElementsAtEventForMode(evt, 'index', { intersect: false }, false);
        if (els.length) setActive(els[0].index, c);
      },
    },
  });

  canvas.addEventListener('mouseleave', () => setActive(defaultIndex, chart));
  return chart;
}
