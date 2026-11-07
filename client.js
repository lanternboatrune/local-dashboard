/**
 * Client 半：左侧栏入口 + 控制台面板。
 *
 * 布局：
 *   · 左半边：可视化（大号累计 Tokens + CPU / 内存 / 速率走势）
 *   · 右半边：紧凑指标列表（CPU、内存、进程、累计、速率、会话数）
 *   · 底部：会话抽屉，收起成一条，点击或拖拽展开
 *
 * 数据每秒向 Host 路由轮询一次；走势与速率都由快照序列算出。
 */
window.__ModuleLoader__.load({
  id: '@local/local-dashboard',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const ROUTE = '/plugin-local-dashboard/stats';
    const PANEL_ID = 'local-dashboard';
    const POLL_MS = 1000;
    const HISTORY = 60;

    function isZh() {
      const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en';
      return lang.toLowerCase().startsWith('zh');
    }

    const TEXT = {
      title: { zh: '仪表盘', en: 'Dashboard' },
      cpu: { zh: 'CPU', en: 'CPU' },
      memory: { zh: '内存', en: 'Memory' },
      process: { zh: '进程内存', en: 'Process' },
      total: { zh: '累计 Tokens', en: 'Total tokens' },
      rate: { zh: '实时速率', en: 'Live rate' },
      sessions: { zh: '活跃会话', en: 'Live sessions' },
      input: { zh: '输入', en: 'In' },
      output: { zh: '输出', en: 'Out' },
      cached: { zh: '缓存', en: 'Cached' },
      sum: { zh: '合计', en: 'Total' },
      perSec: { zh: '速率', en: 'Rate' },
      session: { zh: '会话', en: 'Session' },
      turns: { zh: '轮', en: 'turns' },
      idle: { zh: '暂无活跃会话', en: 'No live sessions' },
      running: { zh: '运行中', en: 'Running' },
      idleState: { zh: '空闲', en: 'Idle' },
      pendingApproval: { zh: '待审批', en: 'Approval' },
      status: { zh: '状态', en: 'Status' },
      waiting: { zh: '读取中…', en: 'Loading…' },
      cores: { zh: '核', en: 'cores' },
      uptime: { zh: '运行', en: 'up' },
      updated: { zh: '更新于', en: 'updated' },
      tokenPerSec: { zh: 'tok/s', en: 'tok/s' },
      trend: { zh: '近 60 秒', en: 'last 60s' },
    };
    const t = (key) => (isZh() ? TEXT[key].zh : TEXT[key].en);

    // ── 格式化 ──────────────────────────────────────────────
    function compact(value) {
      const n = Number(value) || 0;
      if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
      if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
      if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
      return String(Math.round(n));
    }
    function bytes(value) {
      const n = Number(value) || 0;
      if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
      if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
      return `${Math.round(n / 1024)} KB`;
    }
    function duration(seconds) {
      const s = Math.max(0, Math.round(Number(seconds) || 0));
      const hh = Math.floor(s / 3600);
      const mm = Math.floor((s % 3600) / 60);
      return hh > 0 ? `${hh}h ${mm}m` : `${mm}m ${s % 60}s`;
    }
    function shortId(id) {
      const text = String(id || '');
      return text.length > 14 ? `${text.slice(0, 8)}…${text.slice(-4)}` : text;
    }
    function basename(path) {
      if (!path) return '';
      const parts = String(path).split(/[\\/]/).filter(Boolean);
      return parts.length === 0 ? '' : parts[parts.length - 1];
    }
    function collectTitles(snapshot) {
      const map = new Map();
      const seen = new Set();
      (function walk(node, depth) {
        if (!node || typeof node !== 'object' || depth > 7 || seen.has(node)) return;
        seen.add(node);
        if (typeof node.id === 'string' && typeof node.title === 'string' && node.title) map.set(node.id, node.title);
        for (const key of Object.keys(node)) {
          const value = node[key];
          if (value && typeof value === 'object') walk(value, depth + 1);
        }
      })(snapshot, 0);
      return map;
    }
    /**
     * 从工作区快照里收集「已归档会话 id」。
     * 宿主没有暴露归档集合的查询，能拿到的只有客户端快照；字段名未知，
     * 所以扫所有带 archiv 的键：数组取元素、映射取键值、布尔取所属对象。
     */
    function collectArchived(snapshot) {
      const ids = new Set();
      const seen = new Set();
      const pushId = (value) => {
        if (typeof value === 'string') { ids.add(value); return; }
        if (value && typeof value === 'object' && typeof value.id === 'string') ids.add(value.id);
      };
      (function walk(node, depth, ownerId) {
        if (!node || typeof node !== 'object' || depth > 7 || seen.has(node)) return;
        seen.add(node);
        const selfId = typeof node.id === 'string' ? node.id : ownerId;
        if (node.archived === true && selfId) ids.add(selfId);
        for (const key of Object.keys(node)) {
          const value = node[key];
          if (/archiv/i.test(key)) {
            if (Array.isArray(value)) value.forEach(pushId);
            else if (value && typeof value === 'object') {
              for (const [mapKey, mapValue] of Object.entries(value)) {
                pushId(mapKey);
                pushId(mapValue);
              }
            } else if (value === true && selfId) ids.add(selfId);
          }
          if (value && typeof value === 'object') walk(value, depth + 1, selfId);
        }
      })(snapshot, 0, null);
      return ids;
    }

    function statusOf(row) {      if (row.pendingApprovals > 0) return { color: 'var(--dsw-alias-state-warn-primary)', label: t('pendingApproval') };
      if (row.running) return { color: 'var(--dsw-alias-state-success-primary)', label: t('running') };
      return { color: 'var(--dsw-alias-label-quaternary)', label: t('idleState') };
    }

    // ── 速率 ────────────────────────────────────────────────
    let previous = null;
    function rateSince(current, at) {
      if (!previous) return { total: 0, perSession: new Map() };
      const seconds = Math.max(0.2, (at - previous.at) / 1000);
      const perSession = new Map();
      for (const row of current.sessions || []) {
        const before = previous.perSession.get(row.id) || 0;
        perSession.set(row.id, Math.max(0, (row.total - before) / seconds));
      }
      const currentTotal = (current.totals && current.totals.total) || 0;
      return { total: Math.max(0, (currentTotal - previous.totals) / seconds), perSession };
    }
    function remember(current) {
      const perSession = new Map();
      for (const row of current.sessions || []) perSession.set(row.id, row.total);
      previous = { at: current.time || Date.now(), totals: (current.totals && current.totals.total) || 0, perSession };
    }

    // ── 样式 ────────────────────────────────────────────────
    const S = {
      root: { position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box', color: 'var(--dsw-alias-label-primary)' },
      body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 20px 18px', boxSizing: 'border-box', overflowY: 'auto', overflowX: 'hidden' },
      topRow: { flex: 'none', display: 'flex', gap: 16, alignItems: 'stretch' },
      monitor: { flex: '1 1 50%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 },
      cards: { flex: '1 1 50%', minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gridTemplateRows: 'auto auto 1fr', gap: 12, height: '100%' },
      chat: { flex: 'none', display: 'flex', flexDirection: 'column', marginTop: 2 },
      head: { display: 'flex', alignItems: 'baseline', gap: 10 },
      title: { margin: 0, fontSize: 15, fontWeight: 600 },
      meta: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' },
      hero: { border: '0.5px solid var(--dsw-alias-border-l1)', borderRadius: 14, padding: '18px 20px', background: 'linear-gradient(135deg, color-mix(in srgb, var(--dash-accent, var(--dsw-alias-brand-primary)) 10%, transparent), transparent 60%), var(--dsw-alias-bg-layer-1)' },
      heroLabel: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' },
      heroValue: { fontSize: 40, lineHeight: 1.1, fontWeight: 650, fontVariantNumeric: 'tabular-nums', margin: '6px 0 4px' },
      heroSub: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums' },
      charts: { display: 'flex', flexDirection: 'column', gap: 10 },
      chart: { border: '0.5px solid var(--dsw-alias-border-l1)', borderRadius: 12, padding: '10px 12px', background: 'var(--dsw-alias-bg-layer-1)' },
      chartHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 },
      chartLabel: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' },
      chartValue: { fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
      /* 右侧：紧凑指标行，用发丝线分隔而非一堆盒子 */
      panel: { border: '0.5px solid var(--dsw-alias-border-l1)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-1)', padding: '4px 14px' },
      row: { display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 0', borderBottom: '0.5px solid var(--dsw-alias-border-l1)' },
      rowTop: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
      rowLast: { borderBottom: 'none' },
      rowLabel: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' },
      rowValue: { fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
      rowSub: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', marginTop: 2 },
      track: { height: 4, borderRadius: 2, background: 'var(--dsw-alias-fill-tertiary, rgba(0,0,0,.08))', overflow: 'hidden', width: '100%' },
      /* 会话区：常显，不再折叠 */
      section: { display: 'flex', flexDirection: 'column', border: '0.5px solid var(--dsw-alias-border-l1)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-1)', padding: '4px 14px 10px' },
      sectionHead: { display: 'flex', alignItems: 'baseline', gap: 8, padding: '12px 0 8px' },
      sectionTitle: { margin: 0, fontSize: 13, fontWeight: 600 },
      sectionCount: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' },
      cardBox: { border: '0.5px solid var(--dsw-alias-border-l1)', borderRadius: 14, background: 'var(--dsw-alias-bg-layer-1)', padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8, boxShadow: '0 1px 2px rgba(0,0,0,.06)' },
      calSplit: { display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' },
      calSide: { flex: '0 0 auto', width: 268, display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'space-between' },
      monthBox: { flex: '1 1 auto', minWidth: 260, display: 'flex', flexDirection: 'column', gap: 6 },
      monthHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
      monthLabel: { fontSize: 12.5, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      monthNav: { width: 24, height: 24, display: 'grid', placeItems: 'center', font: 'inherit', fontSize: 14, lineHeight: 1, cursor: 'pointer', borderRadius: 6, color: 'var(--dsw-alias-label-secondary)', background: 'transparent', border: '0.5px solid var(--dsw-alias-border-l1)' },
      monthWeek: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 },
      monthWeekCell: { textAlign: 'center', fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', paddingBottom: 2 },
      monthGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 },
      monthCell: { display: 'grid', placeItems: 'center', height: 30, fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' },
      monthDay: { display: 'grid', placeItems: 'center', width: 24, height: 24, borderRadius: 12 },
      monthToday: { display: 'grid', placeItems: 'center', width: 24, height: 24, borderRadius: 12, color: 'var(--dsw-alias-label-primary-foreground)', background: 'var(--dash-accent, var(--dsw-alias-brand-primary))', fontWeight: 600 },
      cardHead: { display: 'flex', alignItems: 'center', gap: 7 },
      cardDot: { width: 8, height: 8, borderRadius: 4, background: 'var(--dash-accent, var(--dsw-alias-brand-primary))', opacity: 0.9, flex: 'none' },
      cardTitle: { fontSize: 12.5, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      cardMore: { marginLeft: 'auto', fontSize: 14, lineHeight: 1, color: 'var(--dsw-alias-label-tertiary)', cursor: 'default' },
      cardBody: { display: 'flex', flexDirection: 'column', gap: 8, flex: '1 1 auto', minHeight: 0 },
      cardFoot: { fontSize: 11.5, color: 'var(--dash-accent, var(--dsw-alias-brand-primary))' },
      cardNote: { fontSize: 10.5, color: 'var(--dsw-alias-label-quaternary)' },
      weatherCell: { gridColumn: '2', gridRow: '2 / span 2', minHeight: 0, height: '100%', gap: 8, overflow: 'hidden' },
      weatherScroll: { display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'space-between', overflowY: 'auto', minHeight: 0, flex: '1 1 auto', paddingRight: 2 },
      chips: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 },
      chip: { border: '0.5px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: '6px 8px', minWidth: 0 },
      chipLabel: { fontSize: 10.5, color: 'var(--dsw-alias-label-tertiary)' },
      chipValue: { fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      blockTitle: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', marginTop: 2 },
      hourlyStrip: { display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 },
      hourCell: { flex: '0 0 auto', width: 46, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '6px 0', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-2)' },
      hourLabel: { fontSize: 10, color: 'var(--dsw-alias-label-tertiary)' },
      hourTemp: { fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
      hourRain: { fontSize: 9.5, color: 'var(--dsw-alias-label-quaternary)' },
      dailyList: { display: 'flex', flexDirection: 'column' },
      dailyRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '0.5px solid var(--dsw-alias-border-l1)', fontSize: 12 },
      dailyDay: { width: 42, color: 'var(--dsw-alias-label-secondary)' },
      dailyTemp: { marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-primary)' },
      bigValue: { fontSize: 26, fontWeight: 650, fontVariantNumeric: 'tabular-nums', letterSpacing: '.5px', lineHeight: 1.15 },
      btnRow: { display: 'flex', gap: 8 },
      btnPrimary: { font: 'inherit', fontSize: 12.5, lineHeight: 1, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', border: 'none', color: 'var(--dsw-alias-label-primary-foreground)', background: 'var(--dsw-alias-button-primary-fill)' },
      btnGhost: { font: 'inherit', fontSize: 12.5, lineHeight: 1, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', color: 'var(--dsw-alias-label-primary)', background: 'transparent', border: '0.5px solid var(--dsw-alias-border-l1)' },
      clock: { fontSize: 34, fontWeight: 650, fontVariantNumeric: 'tabular-nums', letterSpacing: '.5px', lineHeight: 1.1 },
      calDate: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' },
      calLunar: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' },
      calStats: { display: 'flex', gap: 14, fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' },
      calRule: { height: 1, background: 'var(--dsw-alias-border-l1)', margin: '4px 0 2px' },
      calTopGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
      calBottom: { display: 'flex', flexDirection: 'column', gap: 8 },
      calChips: { display: 'flex', flexWrap: 'wrap', gap: 4, minWidth: 0 },
      chipYi: { fontSize: 11.5, lineHeight: 1.5, padding: '1px 8px', borderRadius: 999, color: 'var(--dsw-alias-state-success-primary)', background: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent)' },
      chipBu: { fontSize: 11.5, lineHeight: 1.5, padding: '1px 8px', borderRadius: 999, color: 'var(--dsw-alias-state-error-primary)', background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)' },
      calYiji: { display: 'flex', flexDirection: 'column', gap: 6 },
      calRow: { display: 'flex', gap: 8, alignItems: 'flex-start' },
      calKeyYi: { fontSize: 11.5, fontWeight: 600, color: 'var(--dsw-alias-state-success-primary)', flex: 'none', width: 30, paddingTop: 2 },
      calKeyBu: { fontSize: 11.5, fontWeight: 600, color: 'var(--dsw-alias-state-error-primary)', flex: 'none', width: 30, paddingTop: 2 },
      calValue: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5 },
      calNote: { fontSize: 10.5, color: 'var(--dsw-alias-label-quaternary)', marginTop: 2 },
      tableWrap: { overflow: 'visible' },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
      th: { textAlign: 'left', padding: '7px 10px', fontSize: 11, fontWeight: 500, color: 'var(--dsw-alias-label-tertiary)', borderBottom: '0.5px solid var(--dsw-alias-border-l1)', position: 'sticky', top: 0, background: 'var(--dsw-alias-bg-layer-1)' },
      td: { padding: '8px 10px', borderBottom: '0.5px solid var(--dsw-alias-border-l1)', verticalAlign: 'top' },
      num: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
      empty: { padding: '24px 10px', textAlign: 'center', fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' },
      path: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', marginTop: 2 },
      live: { display: 'inline-block', width: 6, height: 6, borderRadius: 3, marginRight: 6, verticalAlign: 'middle' },
    };

    // ── 侧栏图标 ────────────────────────────────────────────
    function ConsoleIcon(props) {
      const size = Number(props && props.size) || 18;
      const active = Boolean(props && props.active);
      const stroke = active ? 'var(--dash-accent, var(--dsw-alias-brand-primary))' : 'var(--dsw-alias-label-secondary)';
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, style: { display: 'block' } }, [
        h('rect', { key: 'a', x: 3, y: 4, width: 18, height: 16, rx: 3, stroke, strokeWidth: 1.6 }),
        h('path', { key: 'b', d: 'M7 15v-3M12 15v-6M17 15v-4', stroke, strokeWidth: 1.8, strokeLinecap: 'round' }),
      ]);
    }

    function Spark({ points, color, max }) {
      const width = 100;
      const height = 30;
      const list = points || [];
      const ceiling = Math.max(1, max || 100);
      const step = list.length > 1 ? width / (list.length - 1) : width;
      const coords = list.map((value, index) => {
        const x = index * step;
        const y = height - Math.max(0, Math.min(1, value / ceiling)) * height;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      });
      return h('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', width: '100%', height: 30, style: { display: 'block' } }, [
        h('polyline', {
          key: 'line',
          points: coords.join(' '),
          fill: 'none',
          stroke: color,
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          vectorEffect: 'non-scaling-stroke',
        }),
      ]);
    }

    function Chart({ label, value, points, color, max }) {
      return h('div', { style: S.chart }, [
        h('div', { key: 'h', style: S.chartHead }, [
          h('span', { key: 'l', style: S.chartLabel }, label),
          h('span', { key: 'v', style: S.chartValue }, value),
        ]),
        h(Spark, { key: 's', points, color, max }),
      ]);
    }

    function StatRow({ label, value, sub, percent, last }) {
      const width = percent === undefined ? null : Math.max(0, Math.min(100, Number(percent) || 0));
      return h('div', { style: last ? { ...S.row, ...S.rowLast } : S.row }, [
        h('div', { key: 'top', style: S.rowTop }, [
          h('div', { key: 'l', style: { minWidth: 0 } }, [
            h('div', { key: 'a', style: S.rowLabel }, label),
            sub ? h('div', { key: 'b', style: S.rowSub }, sub) : null,
          ]),
          h('div', { key: 'v', style: S.rowValue }, value),
        ]),
        width === null ? null : h('div', { key: 'bar', style: S.track },
          h('div', { style: { height: '100%', width: `${width}%`, borderRadius: 'inherit', background: 'var(--dash-accent, var(--dsw-alias-brand-primary))', transition: 'width .25s ease' } })),
      ]);
    }

    // ── 会话列表（常显，不折叠） ────────────────────────────
    function SessionsSection({ rows, rates, titles }) {
      const pendingCount = rows.filter((row) => row.pendingApprovals > 0).length;
      return h('div', { style: S.section }, [
        h('div', { key: 'head', style: S.sectionHead }, [
          h('h3', { key: 't', style: S.sectionTitle }, t('sessions')),
          h('span', { key: 'n', style: S.sectionCount }, String(rows.length)),
          pendingCount > 0
            ? h('span', { key: 'p', style: { fontSize: 11.5, color: 'var(--dsw-alias-state-warn-primary)' } }, `${pendingCount} ${t('pendingApproval')}`)
            : null,
        ]),
        rows.length === 0
          ? h('div', { key: 'empty', style: S.empty }, t('idle'))
          : h('div', { key: 'wrap', style: S.tableWrap }, h('table', { style: S.table }, [
            h('thead', { key: 'h' }, h('tr', null, [
              h('th', { key: 's', style: S.th }, t('session')),
              h('th', { key: 'st', style: S.th }, t('status')),
              h('th', { key: 'i', style: { ...S.th, textAlign: 'right' } }, t('input')),
              h('th', { key: 'o', style: { ...S.th, textAlign: 'right' } }, t('output')),
              h('th', { key: 'c', style: { ...S.th, textAlign: 'right' } }, t('cached')),
              h('th', { key: 't', style: { ...S.th, textAlign: 'right' } }, t('sum')),
              h('th', { key: 'r', style: { ...S.th, textAlign: 'right' } }, t('perSec')),
            ])),
            h('tbody', { key: 'b' }, rows.map((row) => {
              const status = statusOf(row);
              const title = titles.get(row.id) || basename(row.cwd) || shortId(row.id);
              return h('tr', { key: row.id }, [
                h('td', { key: 's', style: S.td }, [
                  h('div', { key: 'n' }, [h('span', { key: 'd', style: { ...S.live, background: status.color } }), title]),
                  h('div', { key: 'p', style: S.path }, `${shortId(row.id)} · ${row.turns} ${t('turns')}`),
                ]),
                h('td', { key: 'st', style: S.td }, h('span', { style: { fontSize: 11, color: status.color, whiteSpace: 'nowrap' } }, status.label)),
                h('td', { key: 'i', style: { ...S.td, ...S.num } }, compact(row.input)),
                h('td', { key: 'o', style: { ...S.td, ...S.num } }, compact(row.output)),
                h('td', { key: 'c', style: { ...S.td, ...S.num } }, compact(row.cached)),
                h('td', { key: 't', style: { ...S.td, ...S.num } }, compact(row.total)),
                h('td', { key: 'r', style: { ...S.td, ...S.num } }, compact(rates.perSession.get(row.id) || 0)),
              ]);
            })),
          ])),
      ]);
    }

    // ── 日历卡片（时间 / 农历 / 周数 / 宜忌） ─────────────
    const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const LUNAR_DAYS = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
      '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
      '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];
    const JIANCHU = ['建', '除', '满', '平', '定', '执', '破', '危', '成', '收', '开', '闭'];
    const JIANCHU_YI = {
      建: ['出行', '上任', '会友'], 除: ['扫舍', '沐浴', '疗病'], 满: ['祭祀', '祈福', '开市'],
      平: ['修饰', '平治', '整理'], 定: ['订盟', '纳采', '安床'], 执: ['捕捉', '立约', '纳畜'],
      破: ['破屋', '坏垣', '求医'], 危: ['安床', '纳采', '祭祀'], 成: ['开市', '交易', '嫁娶'],
      收: ['纳财', '捕捉', '进人口'], 开: ['开市', '出行', '入学'], 闭: ['筑堤', '埋穴', '安葬'],
    };
    const JIANCHU_BUYI = {
      建: ['动土', '开仓'], 除: ['远行', '开市'], 满: ['安葬', '赴任'],
      平: ['开市', '嫁娶'], 定: ['诉讼', '出行'], 执: ['开市', '搬迁'],
      破: ['嫁娶', '开市'], 危: ['登高', '行船'], 成: ['诉讼', '破屋'],
      收: ['开仓', '安葬'], 开: ['安葬', '破土'], 闭: ['开市', '出行'],
    };

    /** 公历日期 → 儒略日（正午）。 */
    function julianDay(date) {
      const y = date.getFullYear();
      const m = date.getMonth() + 1;
      const d = date.getDate();
      const a = Math.floor((14 - m) / 12);
      const yy = y + 4800 - a;
      const mm = m + 12 * a - 3;
      return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4)
        - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
    }

    /** 农历信息：中文月日、月序（用于建除）、是否闰月。 */
    function lunarInfo(date) {
      try {
        const fmt = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' });
        const parts = fmt.formatToParts(date);
        const monthText = (parts.find((part) => part.type === 'month') || {}).value || '';
        const dayText = (parts.find((part) => part.type === 'day') || {}).value || '';
        const numeric = /(\d+)/.exec(monthText);
        let monthNumber = numeric ? Number(numeric[1]) : null;
        if (monthNumber === null && /[正二三四五六七八九十冬腊]/.test(monthText)) {
          const map = { 正: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 冬: 11, 腊: 12 };
          const key = monthText.replace('闰', '').match(/[正二三四五六七八九十冬腊]/);
          monthNumber = key ? map[key[0]] : null;
        }
        const dayNumber = Number(dayText);
        const dayLabel = Number.isFinite(dayNumber) && LUNAR_DAYS[dayNumber - 1] ? LUNAR_DAYS[dayNumber - 1] : dayText;
        return { text: `${monthText}${dayLabel}`, monthNumber, leap: monthText.includes('闰') };
      } catch (error) {
        return { text: '', monthNumber: null, leap: false };
      }
    }

    function dayOfYear(date) {
      const start = new Date(date.getFullYear(), 0, 1);
      return Math.floor((date - start) / 86400000) + 1;
    }

    function isoWeek(date) {
      const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const dayNr = (target.getDay() + 6) % 7;
      target.setDate(target.getDate() - dayNr + 3);
      const firstThursday = new Date(target.getFullYear(), 0, 4);
      const firstDayNr = (firstThursday.getDay() + 6) % 7;
      firstThursday.setDate(firstThursday.getDate() - firstDayNr + 3);
      return 1 + Math.round((target - firstThursday) / (7 * 86400000));
    }

    /** 建除十二值：日支（JDN 推算）相对月建（农历月支）。简化算法，仅装饰用。 */
    function jianchuOf(date, lunarMonth) {
      const ganzhi = ((julianDay(date) + 49) % 60 + 60) % 60;
      const dayBranch = ganzhi % 12;
      const monthBranch = ((lunarMonth || 1) + 1) % 12; // 正月建寅
      return JIANCHU[(dayBranch - monthBranch + 12) % 12];
    }

    // ── 卡片外壳：统一头部（图标 + 标题 + 省略号） ─────────
    function CardShell({ title, children, footer, span, alignSelf, boxStyle }) {
      let base = span ? { ...S.cardBox, gridColumn: 'span 2' } : S.cardBox;
      if (alignSelf) base = { ...base, alignSelf };
      if (boxStyle) base = { ...base, ...boxStyle };
      return h('section', { style: base }, [
        h('div', { key: 'head', style: S.cardHead }, [
          h('span', { key: 'dot', style: S.cardDot }),
          h('span', { key: 't', style: S.cardTitle }, title),
          h('span', { key: 'more', style: S.cardMore }, '⋯'),
        ]),
        h('div', { key: 'body', style: S.cardBody }, children),
        footer ? h('div', { key: 'foot', style: S.cardFoot }, footer) : null,
      ]);
    }

    function pad2(value) {
      return String(Math.max(0, Math.floor(value))).padStart(2, '0');
    }

    /** 计时器：累计毫秒 = 已暂停的累计 + 当前运行段的真实差值（不做增量累加，避免漂移）。 */
    function StopwatchCard() {
      const [baseMs, setBaseMs] = React.useState(0);
      const [since, setSince] = React.useState(null); // 运行中：本段起点时间戳
      const [, setTick] = React.useState(0);          // 仅用于驱动重绘

      React.useEffect(() => {
        if (since === null) return undefined;
        const timer = setInterval(() => setTick((tick) => tick + 1), 50);
        return () => clearInterval(timer);
      }, [since]);

      const running = since !== null;
      const totalMs = Math.max(0, baseMs + (running ? Date.now() - since : 0));
      const totalSeconds = Math.floor(totalMs / 1000);
      const mins = Math.floor(totalSeconds / 60);
      const secs = totalSeconds % 60;
      const centis = Math.floor((totalMs % 1000) / 10);

      return h(CardShell, { title: isZh() ? '计时器' : 'Stopwatch', alignSelf: 'start' }, [
        h('div', { key: 'v', style: S.bigValue }, `${pad2(mins)}:${pad2(secs)}.${pad2(centis)}`),
        h('div', { key: 'row', style: S.btnRow }, [
          h('button', {
            key: 'toggle',
            type: 'button',
            style: S.btnPrimary,
            onClick: () => {
              if (running) {
                setBaseMs(baseMs + (Date.now() - since));
                setSince(null);
              } else {
                setSince(Date.now());
              }
            },
          }, running ? (isZh() ? '暂停' : 'Pause') : (isZh() ? '开始' : 'Start')),
          h('button', {
            key: 'reset',
            type: 'button',
            style: S.btnGhost,
            onClick: () => { setBaseMs(0); setSince(null); },
          }, isZh() ? '重置' : 'Reset'),
        ]),
      ]);
    }

    /** 月历网格：可翻月，今天高亮。 */
    function MonthGrid({ anchor }) {
      const [offset, setOffset] = React.useState(0);
      const base = new Date(anchor.getFullYear(), anchor.getMonth() + offset, 1);
      const year = base.getFullYear();
      const month = base.getMonth();
      const firstWeekday = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      const cells = [];
      for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
      for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);

      const isCurrentMonth = offset === 0;
      const today = anchor.getDate();

      return h('div', { style: S.monthBox }, [
        h('div', { key: 'head', style: S.monthHead }, [
          h('button', {
            key: 'prev', type: 'button', style: S.monthNav, 'aria-label': isZh() ? '上一月' : 'Previous month',
            onClick: () => setOffset(offset - 1),
          }, '‹'),
          h('span', { key: 'label', style: S.monthLabel }, `${year} 年 ${month + 1} 月`),
          h('button', {
            key: 'next', type: 'button', style: S.monthNav, 'aria-label': isZh() ? '下一月' : 'Next month',
            onClick: () => setOffset(offset + 1),
          }, '›'),
        ]),
        h('div', { key: 'week', style: S.monthWeek },
          ['日', '一', '二', '三', '四', '五', '六'].map((label, index) => h('span', { key: index, style: S.monthWeekCell }, label))),
        h('div', { key: 'grid', style: S.monthGrid },
          cells.map((day, index) => h('div', {
            key: index,
            style: day === null ? { ...S.monthCell, visibility: 'hidden' } : S.monthCell,
          }, day === null ? null : h('span', {
            key: 'd',
            style: isCurrentMonth && day === today ? { ...S.monthToday } : S.monthDay,
          }, String(day))))),
      ]);
    }

    function CalendarCard() {
      const [now, setNow] = React.useState(() => new Date());
      const prefs = useDashPrefs();

      React.useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(timer);
      }, []);

      const lunar = lunarInfo(now);
      const jianchu = jianchuOf(now, lunar.monthNumber);
      const yi = JIANCHU_YI[jianchu] || [];
      const buYi = JIANCHU_BUYI[jianchu] || [];
      const time = formatClock(now, prefs);

      return h(CardShell, { title: isZh() ? '日历' : 'Calendar', span: true }, [
        h('div', { key: 'split', style: S.calSplit }, [
          h('div', { key: 'side', style: S.calSide }, [
            h('div', { key: 'top', style: S.calTopGroup }, [
              h('div', { key: 'time', style: S.clock }, time),
              h('div', { key: 'date', style: S.calDate }, `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${WEEKDAY_ZH[now.getDay()]}`),
              h('div', { key: 'lunar', style: S.calLunar }, `农历 ${lunar.text || '—'}${lunar.leap ? '（闰月）' : ''}`),
              h('div', { key: 'stats', style: S.calStats }, [
                h('span', { key: 'w' }, `第 ${isoWeek(now)} 周`),
                h('span', { key: 'd' }, `今年第 ${dayOfYear(now)} 天`),
              ]),
            ]),
            h('div', { key: 'rule', style: S.calRule }),
            h('div', { key: 'bottom', style: S.calBottom }, [
              h('div', { key: 'yi', style: S.calRow }, [
                h('span', { key: 'k', style: S.calKeyYi }, '宜'),
                h('div', { key: 'v', style: S.calChips }, yi.map((item, index) => h('span', { key: index, style: S.chipYi }, item))),
              ]),
              h('div', { key: 'buyi', style: S.calRow }, [
                h('span', { key: 'k', style: S.calKeyBu }, '不宜'),
                h('div', { key: 'v', style: S.calChips }, buYi.map((item, index) => h('span', { key: index, style: S.chipBu }, item))),
              ]),
              h('div', { key: 'note', style: S.calNote }, `${jianchu}日 · 简化推算，仅供装饰`),
            ]),
          ]),
          h(MonthGrid, { key: 'month', anchor: now }),
        ]),
      ]);
    }

    // ── 桌宠卡：复用 desk-pet 的状态接口，立绘由自己的路由提供 ──
    const PET_ROUTE = '/plugin-desk-pet/state';
    const PET_SPRITE_OF = {
      thinking: 'smile-closed',
      tool: 'typing',
      reading: 'notes',
      waiting: 'knock',
      celebrate: 'confetti',
      idle: 'smile',
      error: 'panic',
      aborted: 'guilty',
      stone: 'stone',
    };
    const PET_CSS = `
.pcp-box{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;height:100%;min-height:0;padding:2px}
.pcp-bubble{max-width:100%;padding:4px 9px;border-radius:10px;font-size:11.5px;line-height:1.35;
  color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);
  border:0.5px solid var(--dsw-alias-border-l1);text-align:center;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pcp-sprite{display:block;max-height:100%;max-width:100%;object-fit:contain;
  animation:pcp-bob 3.2s ease-in-out infinite;transform-origin:50% 100%}
.pcp-tool{animation:pcp-typing .28s ease-in-out infinite}
.pcp-thinking{animation-duration:4.4s}
.pcp-error{animation:pcp-panic .12s linear infinite}
.pcp-stone{animation:none}
@keyframes pcp-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes pcp-typing{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-2px) scale(1.006)}}
@keyframes pcp-panic{0%,100%{transform:translate(0,0)}25%{transform:translate(-2px,1px)}75%{transform:translate(2px,-1px)}}
@media (prefers-reduced-motion:reduce){.pcp-sprite{animation:none!important}}
.pcp-zone{width:100%;height:100%;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:4px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;
  background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.pcp-zone-title{font-size:12px;font-weight:500;letter-spacing:.02em}
.pcp-zone-hint{font-size:10.5px;opacity:.8}
`;

    function PetCard() {
      const [pet, setPet] = React.useState({ state: 'waiting', text: '', online: null });

      React.useEffect(() => {
        let alive = true;
        let timer = null;

        async function poll() {
          try {
            const response = await fetch(PET_ROUTE, { headers: { accept: 'application/json' }, cache: 'no-store' });
            if (!response.ok) {
              if (alive) setPet((prev) => ({ ...prev, online: false }));
              return;
            }
            const data = await response.json();
            const rows = Array.isArray(data.sessions) ? data.sessions : [];
            const pick = rows.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
            if (!alive) return;
            if (pick) setPet({ state: pick.state || 'waiting', text: pick.text || '', online: true });
            else setPet((prev) => ({ ...prev, online: true }));
          } catch (error) {
            // 桌宠插件未安装/未就绪：切到占位区，保留上一状态以便恢复。
            if (alive) setPet((prev) => ({ ...prev, online: false }));
          }
        }

        poll();
        timer = setInterval(poll, 400);
        return () => {
          alive = false;
          if (timer !== null) clearInterval(timer);
        };
      }, []);

      if (pet.online === false) {
        return h('div', { className: 'pcp-box' }, [
          h('style', { key: 'css' }, PET_CSS),
          h('div', { key: 'zone', className: 'pcp-zone' }, [
            h('div', { key: 't', className: 'pcp-zone-title' }, mt('petZone')),
            h('div', { key: 'h', className: 'pcp-zone-hint' }, mt('petHint')),
          ]),
        ]);
      }

      const sprite = PET_SPRITE_OF[pet.state] || 'smile';

      return h('div', { className: 'pcp-box' }, [
        h('style', { key: 'css' }, PET_CSS),
        pet.text ? h('div', { key: 'bubble', className: 'pcp-bubble' }, pet.text) : null,
        h('img', {
          key: 'sprite',
          className: `pcp-sprite pcp-${pet.state}`,
          src: `/plugin-local-dashboard/pet/${sprite}.webp`,
          alt: '',
          draggable: false,
        }),
      ]);
    }

    // ── 天气卡：纯客户端取数（open-meteo，无需密钥），铺满右侧预留框 ──
    const WEATHER_CACHE_KEY = 'dsh.perf-console.weather.v2';
    const WEATHER_TTL = 10 * 60 * 1000;
    const FALLBACK_PLACE = { city: '北京', latitude: 39.9042, longitude: 116.4074 };

    /** 预设城市：设置页直接选，避免每次都要联网地理编码。 */
    const CITY_PRESETS = [
      { name: '北京', latitude: 39.9042, longitude: 116.4074 },
      { name: '上海', latitude: 31.2304, longitude: 121.4737 },
      { name: '广州', latitude: 23.1291, longitude: 113.2644 },
      { name: '深圳', latitude: 22.5431, longitude: 114.0579 },
      { name: '杭州', latitude: 30.2741, longitude: 120.1551 },
      { name: '南京', latitude: 32.0603, longitude: 118.7969 },
      { name: '成都', latitude: 30.5728, longitude: 104.0668 },
      { name: '重庆', latitude: 29.5630, longitude: 106.5516 },
      { name: '武汉', latitude: 30.5928, longitude: 114.3055 },
      { name: '西安', latitude: 34.3416, longitude: 108.9398 },
      { name: '苏州', latitude: 31.2989, longitude: 120.5853 },
      { name: '天津', latitude: 39.0842, longitude: 117.2010 },
      { name: '香港', latitude: 22.3193, longitude: 114.1694 },
      { name: '台北', latitude: 25.0330, longitude: 121.5654 },
      { name: '东京', latitude: 35.6762, longitude: 139.6503 },
      { name: '新加坡', latitude: 1.3521, longitude: 103.8198 },
      { name: '悉尼', latitude: -33.8688, longitude: 151.2093 },
      { name: '伦敦', latitude: 51.5074, longitude: -0.1278 },
      { name: '纽约', latitude: 40.7128, longitude: -74.0060 },
      { name: '旧金山', latitude: 37.7749, longitude: -122.4194 },
    ];

    /** WMO 天气码 → 文字 + 图标。 */
    const WMO = {
      0: ['晴', '☀️'], 1: ['大部晴朗', '🌤️'], 2: ['多云', '⛅'], 3: ['阴', '☁️'],
      45: ['雾', '🌫️'], 48: ['雾凇', '🌫️'],
      51: ['小毛毛雨', '🌦️'], 53: ['毛毛雨', '🌦️'], 55: ['大毛毛雨', '🌧️'],
      56: ['冻毛毛雨', '🌧️'], 57: ['冻毛毛雨', '🌧️'],
      61: ['小雨', '🌦️'], 63: ['中雨', '🌧️'], 65: ['大雨', '🌧️'],
      66: ['冻雨', '🌧️'], 67: ['冻雨', '🌧️'],
      71: ['小雪', '🌨️'], 73: ['中雪', '🌨️'], 75: ['大雪', '❄️'], 77: ['雪粒', '🌨️'],
      80: ['阵雨', '🌦️'], 81: ['强阵雨', '🌧️'], 82: ['暴雨', '⛈️'],
      85: ['阵雪', '🌨️'], 86: ['强阵雪', '❄️'],
      95: ['雷阵雨', '⛈️'], 96: ['雷阵雨伴冰雹', '⛈️'], 99: ['强雷暴伴冰雹', '⛈️'],
    };

    function weatherLabel(code) {
      return WMO[code] || ['未知', '🌡️'];
    }

    /** 缓存数据结构校验：老版本只存了 current，缺 hourly/daily 的一律当脏数据。 */
    function isValidWeather(data) {
      return Boolean(data)
        && Boolean(data.current)
        && Boolean(data.hourly && Array.isArray(data.hourly.time) && data.hourly.time.length > 0)
        && Boolean(data.daily && Array.isArray(data.daily.time) && data.daily.time.length > 0);
    }

    function readWeatherCache() {
      try {
        const raw = window.localStorage.getItem(WEATHER_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch (error) {
        return null;
      }
    }

    function writeWeatherCache(value) {
      try {
        window.localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(value));
      } catch (error) {
        // 配额或隐私模式：静默。
      }
    }

    /** 城市 → 坐标（open-meteo 地理编码，CORS 开放）。 */
    async function geocodeCity(name) {
      const url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(name)
        + '&count=1&language=zh&format=json';
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('geocode HTTP ' + response.status);
      const data = await response.json();
      const hit = Array.isArray(data.results) ? data.results[0] : null;
      if (!hit) throw new Error(isZh() ? '找不到这个城市' : 'city not found');
      return { city: hit.name || name, latitude: hit.latitude, longitude: hit.longitude, at: Date.now() };
    }

    /** 定位：设置页指定 > 已有缓存 > ipwho.is > 北京。 */
    async function resolvePlace() {
      const prefCity = readPrefs().city;
      if (prefCity) {
        const hit = CITY_PRESETS.find((item) => item.name === prefCity);
        if (hit) return { city: hit.name, latitude: hit.latitude, longitude: hit.longitude, at: Date.now() };
        try {
          return await geocodeCity(prefCity);
        } catch (error) {
          // 指定城市解析失败：继续走缓存/自动定位。
        }
      }
      const cached = readWeatherCache();
      if (cached && cached.override) return cached.override;
      if (cached && cached.place && Date.now() - (cached.place.at || 0) < 24 * 3600 * 1000) {
        return cached.place;
      }
      try {
        const response = await fetch('https://ipwho.is/', { headers: { accept: 'application/json' } });
        if (response.ok) {
          const data = await response.json();
          const latitude = Number(data.latitude);
          const longitude = Number(data.longitude);
          if (data.success !== false && Number.isFinite(latitude) && Number.isFinite(longitude)) {
            return { city: data.city || data.region || '当前位置', latitude, longitude, at: Date.now() };
          }
        }
      } catch (error) {
        // 定位失败：走兜底城市。
      }
      return { ...FALLBACK_PLACE, at: Date.now() };
    }

    async function fetchWeather(place) {
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + place.latitude
        + '&longitude=' + place.longitude
        + '&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m,surface_pressure,is_day'
        + '&hourly=temperature_2m,weather_code,precipitation_probability'
        + '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,uv_index_max'
        + '&timezone=auto&forecast_days=7';
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      return {
        at: Date.now(),
        place,
        current: data.current || {},
        hourly: data.hourly || {},
        daily: data.daily || {},
        timezone: data.timezone || '',
      };
    }

    /** 取「从现在开始」的逐小时切片：起点对齐当前小时，每 3 小时一格，共 8 格。 */
    function hourlySlots(hourly) {
      const times = Array.isArray(hourly.time) ? hourly.time : [];
      const temps = Array.isArray(hourly.temperature_2m) ? hourly.temperature_2m : [];
      const codes = Array.isArray(hourly.weather_code) ? hourly.weather_code : [];
      const rains = Array.isArray(hourly.precipitation_probability) ? hourly.precipitation_probability : [];
      const now = Date.now();
      let start = -1;
      for (let i = 0; i < times.length; i += 1) {
        const stamp = new Date(times[i]).getTime();
        if (Number.isFinite(stamp) && stamp >= now - 3600000) { start = i; break; }
      }
      if (start < 0) return [];
      const rows = [];
      for (let k = 0; k < 8; k += 1) {
        const index = start + k * 3;
        if (index >= times.length) break;
        rows.push({ time: times[index], temp: temps[index], code: codes[index], rain: rains[index] });
      }
      return rows;
    }

    function dayLabel(iso, index) {
      if (index === 0) return isZh() ? '今天' : 'Today';
      if (index === 1) return isZh() ? '明天' : 'Tomorrow';
      const date = new Date(iso);
      return isZh() ? WEEKDAY_ZH[date.getDay()] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
    }

    function clockOf(iso) {
      if (!iso) return '—';
      const date = new Date(iso);
      return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    }

    function WeatherCard() {
      const [state, setState] = React.useState({ data: null, error: null, loading: true });
      const prefs = useDashPrefs();

      const load = async (force) => {
        try {
          const cached = readWeatherCache();
          if (!force && cached && isValidWeather(cached.data) && Date.now() - (cached.at || 0) < WEATHER_TTL) {
            setState({ data: cached.data, error: null, loading: false });
            return;
          }
          const place = await resolvePlace();
          const data = await fetchWeather(place);
          const previous = readWeatherCache() || {};
          writeWeatherCache({ ...previous, at: Date.now(), place, data });
          setState({ data, error: null, loading: false });
        } catch (error) {
          setState({ data: null, error: String((error && error.message) || error), loading: false });
        }
      };

      React.useEffect(() => {
        let alive = true;
        const run = (force) => {
          if (alive) load(force);
        };
        run(true);
        const timer = setInterval(() => run(false), WEATHER_TTL);
        return () => {
          alive = false;
          clearInterval(timer);
        };
      }, [prefs.city, prefs.unit]);

      const changeCity = async () => {
        const name = window.prompt(isZh() ? '城市名（留空恢复自动定位）' : 'City name (empty = auto)', prefs.city);
        if (name === null) return;
        try {
          const cached = readWeatherCache() || {};
          writeWeatherCache({ ...cached, override: null });
          setPrefs({ city: name.trim() });
          await load(true);
        } catch (error) {
          setState((prev) => ({ ...prev, error: String((error && error.message) || error) }));
        }
      };

      const { data, error, loading } = state;

      if (!data) {
        return h(CardShell, { title: isZh() ? '天气' : 'Weather', boxStyle: S.weatherCell }, [
          h('div', { key: 'scroll', style: S.weatherScroll }, [
            h('div', { key: 'v', style: S.bigValue }, loading ? '—' : 'n/a'),
            h('div', { key: 'note', style: S.cardNote }, error
              ? `${isZh() ? '取数失败' : 'Failed'}: ${error}`
              : (isZh() ? '正在获取…' : 'Loading…')),
          ]),
        ]);
      }

      const current = data.current || {};
      const daily = data.daily || {};
      const hourly = data.hourly || {};
      const [text, icon] = weatherLabel(current.weather_code);
      const temp = Number(current.temperature_2m);
      const feels = Number(current.apparent_temperature);
      const high = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] : null;
      const low = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[0] : null;
      const sunRise = Array.isArray(daily.sunrise) ? daily.sunrise[0] : null;
      const sunSet = Array.isArray(daily.sunset) ? daily.sunset[0] : null;
      const rainMax = Array.isArray(daily.precipitation_probability_max) ? daily.precipitation_probability_max[0] : null;
      const uv = Array.isArray(daily.uv_index_max) ? daily.uv_index_max[0] : null;

      const slots = hourlySlots(hourly);
      const days = (Array.isArray(daily.time) ? daily.time : []).slice(0, 7);

      const chips = [
        { key: 'hum', label: '湿度', value: current.relative_humidity_2m == null ? '—' : `${current.relative_humidity_2m}%` },
        { key: 'wind', label: '风速', value: current.wind_speed_10m == null ? '—' : `${Math.round(current.wind_speed_10m)} km/h` },
        { key: 'press', label: '气压', value: current.surface_pressure == null ? '—' : `${Math.round(current.surface_pressure)} hPa` },
        { key: 'uv', label: '紫外线', value: uv == null ? '—' : `${Math.round(uv)}` },
        { key: 'rain', label: '降水', value: rainMax == null ? '—' : `${rainMax}%` },
        { key: 'sun', label: '日出/日落', value: `${clockOf(sunRise)} / ${clockOf(sunSet)}` },
      ];

      return h(CardShell, { title: isZh() ? '天气' : 'Weather', boxStyle: S.weatherCell }, [
        h('div', { key: 'scroll', style: S.weatherScroll }, [
        // 当前
        h('div', { key: 'now', style: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' } }, [
          h('span', { key: 't', style: { fontSize: 40, fontWeight: 650, fontVariantNumeric: 'tabular-nums', lineHeight: 1.05 } },
            Number.isFinite(temp) ? formatTemp(temp, prefs) : '—'),
          h('span', { key: 'i', style: { fontSize: 22 } }, icon),
          h('span', { key: 'd', style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' } }, text),
        ]),
        h('div', {
          key: 'city',
          onClick: changeCity,
          role: 'button',
          tabIndex: 0,
          title: isZh() ? '点击更换城市' : 'Click to change city',
          onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); changeCity(); } },
          style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' },
        }, `${data.place.city} · 最高 ${high == null ? '—' : formatTemp(Number(high), prefs)} 最低 ${low == null ? '—' : formatTemp(Number(low), prefs)}`
          + (Number.isFinite(feels) ? ` · 体感 ${formatTemp(feels, prefs)}` : '')),

        // 指标块
        h('div', { key: 'chips', style: S.chips },
          chips.map((chip) => h('div', { key: chip.key, style: S.chip }, [
            h('div', { key: 'l', style: S.chipLabel }, chip.label),
            h('div', { key: 'v', style: S.chipValue }, chip.value),
          ]))),

        // 逐小时
        h('div', { key: 'hourly-title', style: S.blockTitle }, isZh() ? '未来 24 小时' : 'Next 24 hours'),
        h('div', { key: 'hourly', style: S.hourlyStrip },
          slots.map((slot, index) => {
            const [, slotIcon] = weatherLabel(slot.code);
            const date = new Date(slot.time);
            return h('div', { key: index, style: S.hourCell }, [
              h('div', { key: 'h', style: S.hourLabel }, index === 0 ? (isZh() ? '现在' : 'now') : `${pad2(date.getHours())}时`),
              h('div', { key: 'i', style: { fontSize: 15, lineHeight: 1.2 } }, slotIcon),
              h('div', { key: 't', style: S.hourTemp }, Number.isFinite(Number(slot.temp)) ? formatTemp(Number(slot.temp), prefs) : '—'),
              h('div', { key: 'r', style: S.hourRain }, slot.rain == null ? '' : `${slot.rain}%`),
            ]);
          })),

        // 未来 7 天
        h('div', { key: 'daily-title', style: S.blockTitle }, isZh() ? '未来 7 天' : 'Next 7 days'),
        h('div', { key: 'daily', style: S.dailyList },
          days.map((iso, index) => {
            const code = Array.isArray(daily.weather_code) ? daily.weather_code[index] : null;
            const [, dayIcon] = weatherLabel(code);
            const max = daily.temperature_2m_max[index];
            const min = daily.temperature_2m_min[index];
            return h('div', { key: iso, style: S.dailyRow }, [
              h('span', { key: 'd', style: S.dailyDay }, dayLabel(iso, index)),
              h('span', { key: 'i', style: { fontSize: 13 } }, dayIcon),
              h('span', { key: 't', style: S.dailyTemp },
                `${min == null ? '—' : formatTemp(Number(min), prefs)} / ${max == null ? '—' : formatTemp(Number(max), prefs)}`),
            ]);
          })),

        h('div', { key: 'src', style: S.cardNote }, isZh() ? 'open-meteo · 10 分钟更新 · 设置里可改城市/单位' : 'open-meteo · updates every 10 min · city/unit in Settings'),
        ]),
      ]);
    }

    // ── 面板 ────────────────────────────────────────────────
    let history = [];

    function PerfConsolePanel(props) {
      const [state, setState] = React.useState({ data: null, rates: { total: 0, perSession: new Map() }, history: [], error: null });

      let titles = new Map();
      let archived = new Set();
      try {
        if (props && typeof props.useSessions === 'function') {
          const snapshot = props.useSessions((value) => value);
          titles = collectTitles(snapshot);
          archived = collectArchived(snapshot);
        }
      } catch (error) {
        titles = new Map();
        archived = new Set();
      }

      const shared = useDashStats();
      const [view, setView] = React.useState({ data: null, rates: { total: 0, perSession: new Map() }, history: [], error: null });

      React.useEffect(() => {
        if (!shared) return;
        const rates = rateSince(shared, shared.time || Date.now());
        remember(shared);
        history = history.concat([{
          cpu: (shared.cpu && shared.cpu.percent) || 0,
          memory: (shared.memory && shared.memory.percent) || 0,
          rate: rates.total,
        }]).slice(-HISTORY);
        setView({ data: shared, rates, history, error: null });
      }, [shared]);

      const { data, rates, history: samples, error } = view;
      const accentStyle = accentVars(useDashAccent());

      if (!data) {
        return h('div', { style: { ...S.root, ...accentStyle } }, h('div', { style: { ...S.body } },
          h('div', { key: 'x', style: S.monitor }, [
            h('h2', { key: 't', style: S.title }, t('title')),
            h('div', { key: 'w', style: S.empty }, error ? `读取失败：${error}` : t('waiting')),
          ])));
      }

      const cpu = data.cpu || {};
      const memory = data.memory || {};
      const proc = data.process || {};
      const allRows = data.sessions || [];
      // 归档的会话仍留在内存里（归档只是注册表标记），这里按快照的归档集合剔除。
      const rows = archived.size > 0 ? allRows.filter((row) => !archived.has(row.id)) : allRows;
      const totals = rows.reduce((acc, row) => ({
        input: acc.input + (row.input || 0),
        output: acc.output + (row.output || 0),
        cached: acc.cached + (row.cached || 0),
        total: acc.total + (row.total || 0),
      }), { input: 0, output: 0, cached: 0, total: 0 });
      const cpuSeries = samples.map((sample) => sample.cpu);
      const memSeries = samples.map((sample) => sample.memory);
      const rateSeries = samples.map((sample) => sample.rate);
      const ratePeak = Math.max(1, ...rateSeries);

      return h('div', { style: { ...S.root, ...accentStyle } }, [
        h('div', { key: 'body', style: S.body }, [
          h('div', { key: 'top', style: S.topRow }, [
            h('div', { key: 'monitor', style: S.monitor }, [
            h('div', { key: 'head', style: S.head }, [
              h('h2', { key: 't', style: S.title }, t('title')),
              h('span', { key: 'm', style: S.meta }, `${t('updated')} ${new Date(data.time).toLocaleTimeString()}`),
            ]),
            h('div', { key: 'hero', style: S.hero }, [
              h('div', { key: 'l', style: S.heroLabel }, t('total')),
              h('div', { key: 'v', style: S.heroValue }, compact(totals.total)),
              h('div', { key: 's', style: S.heroSub }, `${t('input')} ${compact(totals.input)} · ${t('output')} ${compact(totals.output)} · ${t('cached')} ${compact(totals.cached)}`),
            ]),
            h('div', { key: 'charts', style: S.charts }, [
              h(Chart, { key: 'cpu', label: `${t('cpu')} · ${t('trend')}`, value: `${cpu.percent == null ? '—' : cpu.percent}%`, points: cpuSeries, color: 'var(--dash-accent, var(--dsw-alias-brand-primary))', max: 100 }),
              h(Chart, { key: 'mem', label: `${t('memory')} · ${t('trend')}`, value: `${memory.percent == null ? '—' : memory.percent}%`, points: memSeries, color: 'var(--dsw-alias-state-success-primary)', max: 100 }),
              h(Chart, { key: 'rate', label: `${t('rate')} · ${t('trend')}`, value: `${compact(rates.total)} ${t('tokenPerSec')}`, points: rateSeries, color: 'var(--dsw-alias-state-warn-primary)', max: ratePeak }),
            ]),
            h('div', { key: 'p1', style: S.panel }, [
              h(StatRow, { key: 'cpu', label: t('cpu'), value: `${cpu.percent == null ? '—' : cpu.percent}%`, sub: `${cpu.cores} ${t('cores')}`, percent: cpu.percent || 0 }),
              h(StatRow, { key: 'mem', label: t('memory'), value: `${memory.percent == null ? '—' : memory.percent}%`, sub: `${bytes(memory.usedBytes)} / ${bytes(memory.totalBytes)}`, percent: memory.percent || 0 }),
              h(StatRow, { key: 'proc', label: t('process'), value: bytes(proc.rssBytes), sub: `${t('uptime')} ${duration(proc.uptimeSeconds)}`, last: true }),
            ]),
            h('div', { key: 'p2', style: { ...S.panel, flex: '1 1 auto', minHeight: 0 } }, [
              h(StatRow, { key: 'tot', label: t('total'), value: compact(totals.total), sub: `${t('input')} ${compact(totals.input)} · ${t('output')} ${compact(totals.output)}` }),
              h(StatRow, { key: 'rate', label: t('rate'), value: `${compact(rates.total)} ${t('tokenPerSec')}` }),
              h(StatRow, { key: 'ses', label: t('sessions'), value: String(rows.length), last: true }),
            ]),
            ]),
            h('div', { key: 'cards', style: S.cards }, [
              h(CalendarCard, { key: 'calendar' }),
              h(StopwatchCard, { key: 'stopwatch' }),
              // 预留空卡：跨两列，等你自己往里放内容
              // 右列：天气卡直接占网格（跨第 2、3 行）
              h(WeatherCard, { key: 'weather' }),
              // 预留卡 B：左列第三行，吃掉计时器下方的剩余高度
              // 小预留框：桌宠
              h('div', { key: 'reserved-b', style: { ...S.cardBox, gridColumn: '1', gridRow: '3', minHeight: 120, padding: 8, overflow: 'hidden' } }, [
                h(PetCard, { key: 'pet' }),
              ]),
            ]),
          ]),
          h('div', { key: 'chat', style: S.chat }, [
            h(SessionsSection, { key: 'sessions', rows, rates, titles }),
          ]),
        ]),
      ]);
    }

    class PanelBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }

      static getDerivedStateFromError(error) {
        return { error };
      }

      render() {
        const state = this.state || {};
        if (state.error) {
          return h('div', { style: S.root }, h('div', { style: S.body }, h('div', { style: S.monitor }, [
            h('h2', { key: 't', style: S.title }, t('title')),
            h('pre', { key: 'e', style: { marginTop: 12, padding: 12, borderRadius: 8, fontSize: 11, whiteSpace: 'pre-wrap', background: 'var(--dsw-alias-bg-layer-1)' } },
              String((state.error && state.error.message) || state.error)),
          ])));
        }
        return this.props.children;
      }
    }

    function Panel(props) {
      return h(PanelBoundary, null, h(PerfConsolePanel, props));
    }

    // ── 仪表盘强调色（独立于全局品牌色） ────────────────────
    const ACCENT_KEY = 'dsh.local-dashboard.v1';

    /** 20 个强调色：与主主题色板同一套色相。 */
    const ACCENT_COLORS = [
      { id: 'red', hex: '#e5484d' },
      { id: 'vermilion', hex: '#e5683d' },
      { id: 'orange', hex: '#e8871e' },
      { id: 'amber', hex: '#d9a02a' },
      { id: 'olive', hex: '#c6b320' },
      { id: 'lime', hex: '#8fae1b' },
      { id: 'green', hex: '#4f9d3a' },
      { id: 'emerald', hex: '#0f9d68' },
      { id: 'teal', hex: '#12968f' },
      { id: 'cyan', hex: '#1a9aa8' },
      { id: 'sky', hex: '#2b8fc9' },
      { id: 'blue', hex: '#2f6bff' },
      { id: 'indigo', hex: '#4b5bd6' },
      { id: 'violet', hex: '#6b47d6' },
      { id: 'purple', hex: '#8b3fd1' },
      { id: 'magenta', hex: '#b03bc0' },
      { id: 'pink', hex: '#d13a92' },
      { id: 'rose', hex: '#c2455f' },
      { id: 'brown', hex: '#8a6a52' },
      { id: 'graphite', hex: '#5b6472' },
    ];

    const isHexColor = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

    function readDashAccent() {
      try {
        const raw = window.localStorage.getItem(ACCENT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && isHexColor(parsed.accent) ? parsed.accent.toLowerCase() : null;
      } catch (error) {
        return null;
      }
    }

    function writeDashAccent(value) {
      try {
        if (!value) window.localStorage.removeItem(ACCENT_KEY);
        else window.localStorage.setItem(ACCENT_KEY, JSON.stringify({ accent: value }));
      } catch (error) {
        // 隐私模式/配额：静默。
      }
    }

    let dashAccent = readDashAccent();
    const dashAccentListeners = new Set();

    function setDashAccent(value) {
      dashAccent = isHexColor(value) ? value.toLowerCase() : null;
      writeDashAccent(dashAccent);
      for (const listener of Array.from(dashAccentListeners)) listener();
    }

    function subscribeDashAccent(listener) {
      dashAccentListeners.add(listener);
      return () => dashAccentListeners.delete(listener);
    }

    function useDashAccent() {
      return React.useSyncExternalStore(subscribeDashAccent, () => dashAccent);
    }

    /** 把强调色注入插件根节点的局部变量；为空时各组件自行回落到全局品牌色。 */
    function accentVars(value) {
      return value ? { '--dash-accent': value } : null;
    }

    // ── 仪表盘个性化偏好（时钟 / 天气 / 右侧卡） ───────────
    const PREFS_KEY = 'dsh.local-dashboard.prefs.v1';

    const DEFAULT_PREFS = {
      hour12: false,   // 12/24 小时制
      seconds: true,   // 是否显示秒
      unit: 'c',       // 温度单位：c / f
      city: '',        // 空 = 自动定位
      pin: true,       // 右侧卡默认钉住
      rows: { cpu: true, memory: true, tokens: true, cost: true, clock: true },
    };

    function normalizePrefs(raw) {
      const input = raw && typeof raw === 'object' ? raw : {};
      const rows = input.rows && typeof input.rows === 'object' ? input.rows : {};
      return {
        hour12: input.hour12 === true,
        seconds: input.seconds !== false,
        unit: input.unit === 'f' ? 'f' : 'c',
        city: typeof input.city === 'string' ? input.city : '',
        pin: input.pin !== false,
        rows: {
          cpu: rows.cpu !== false,
          memory: rows.memory !== false,
          tokens: rows.tokens !== false,
          cost: rows.cost !== false,
          clock: rows.clock !== false,
        },
      };
    }

    function readPrefs() {
      try {
        const raw = window.localStorage.getItem(PREFS_KEY);
        return normalizePrefs(raw ? JSON.parse(raw) : null);
      } catch (error) {
        return normalizePrefs(null);
      }
    }

    let dashPrefs = readPrefs();
    const dashPrefsListeners = new Set();

    function setPrefs(patch) {
      dashPrefs = normalizePrefs({ ...dashPrefs, ...patch, rows: { ...dashPrefs.rows, ...(patch.rows || {}) } });
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(dashPrefs));
      } catch (error) {
        // 隐私模式/配额：静默。
      }
      for (const listener of Array.from(dashPrefsListeners)) listener();
    }

    function subscribePrefs(listener) {
      dashPrefsListeners.add(listener);
      return () => dashPrefsListeners.delete(listener);
    }

    function useDashPrefs() {
      return React.useSyncExternalStore(subscribePrefs, () => dashPrefs);
    }

    /** 按偏好格式化时间：12/24 小时制 + 可选秒。 */
    function formatClock(date, prefs) {
      const pad = (value) => String(value).padStart(2, '0');
      let hour = date.getHours();
      let suffix = '';
      if (prefs.hour12) {
        const isPm = hour >= 12;
        hour = hour % 12;
        if (hour === 0) hour = 12;
        suffix = isPm ? ' PM' : ' AM';
      }
      const body = `${pad(hour)}:${pad(date.getMinutes())}`;
      return `${body}${prefs.seconds ? `:${pad(date.getSeconds())}` : ''}${suffix}`;
    }

    /** 摄氏度 → 展示温度。 */
    function formatTemp(value, prefs) {
      if (!Number.isFinite(value)) return '—';
      const shown = prefs.unit === 'f' ? (value * 9) / 5 + 32 : value;
      return `${Math.round(shown)}°`;
    }

    // ── 仪表盘文案（右侧卡片/桌宠占位） ─────────────────────
    const MON_TEXT = {
      title: { zh: '运行状态', en: 'System' },
      tokens: { zh: 'Token', en: 'Tokens' },
      cost: { zh: '金额', en: 'Cost' },
      estimate: { zh: '估算', en: 'est.' },
      peak: { zh: '高峰', en: 'peak' },
      offPeak: { zh: '空闲', en: 'off-peak' },
      cores: { zh: '{count} 核', en: '{count} cores' },
      unavailable: { zh: '—', en: '—' },
      aria: { zh: '系统资源与本轮对话用量', en: 'System resources and conversation usage' },
      pin: { zh: '固定卡片', en: 'Pin card' },
      unpin: { zh: '取消固定', en: 'Unpin card' },
      petZone: { zh: '桌宠接入区', en: 'Desk pet slot' },
      petHint: { zh: '安装桌宠插件后显示立绘', en: 'Install desk-pet to show sprites' },
    };

    function mt(key, params) {
      let value = isZh() ? MON_TEXT[key].zh : MON_TEXT[key].en;
      if (params) {
        for (const [name, replacement] of Object.entries(params)) {
          value = value.replace(`{${name}}`, String(replacement));
        }
      }
      return value;
    }

    const ACC_TEXT = {
      title: { zh: '仪表盘', en: 'Dashboard' },
      intro: {
        zh: '给仪表盘选一个强调色：只影响图表线条、进度条、高亮和右侧状态卡的装饰色，不改动界面其他部分。默认跟随全局品牌色。',
        en: 'Pick an accent for the dashboard: chart lines, progress bars, highlights and the status card decoration only. Defaults to the global brand color.',
      },
      reset: { zh: '恢复默认（跟随全局）', en: 'Reset to theme color' },
      current: { zh: '当前', en: 'Current' },
      inherit: { zh: '跟随全局品牌色', en: 'theme accent' },
      accentGroup: { zh: '强调色', en: 'Accent color' },
      timeGroup: { zh: '时间显示', en: 'Time' },
      hour12: { zh: '12 小时制', en: '12-hour clock' },
      seconds: { zh: '显示秒', en: 'Show seconds' },
      weatherGroup: { zh: '天气', en: 'Weather' },
      city: { zh: '城市', en: 'City' },
      autoCity: { zh: '自动定位', en: 'Auto locate' },
      unit: { zh: '温度单位', en: 'Unit' },
      cardGroup: { zh: '右侧状态卡', en: 'Status card' },
      pin: { zh: '默认钉住', en: 'Pinned by default' },
      rows: { zh: '显示项目', en: 'Visible rows' },
      rowCpu: { zh: 'CPU', en: 'CPU' },
      rowMemory: { zh: '内存', en: 'Memory' },
      rowTokens: { zh: 'Token', en: 'Tokens' },
      rowCost: { zh: '金额', en: 'Cost' },
      rowClock: { zh: '时钟', en: 'Clock' },
      resetAll: { zh: '全部恢复默认', en: 'Reset everything' },
      savedNote: { zh: '改动即时生效，保存在本机。', en: 'Changes apply instantly and are stored locally.' },
    };

    function at(key) {
      return isZh() ? ACC_TEXT[key].zh : ACC_TEXT[key].en;
    }

    // ── 右侧监控卡（原 resource-monitor） ──────────────────
    /** 官方 deepseek-flash 单价：人民币 / 百万 token，高峰时段与空闲半价。 */
    const DASH_PRICING = {
      currency: 'CNY',
      peak: { input: 2, cacheRead: 0.04, cacheWrite: 2, output: 8 },
      offPeak: { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 },
    };

    const BEIJING_CLOCK = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    function priceTier(date) {
      const parts = BEIJING_CLOCK.formatToParts(date);
      const read = (type) => {
        const part = parts.find((candidate) => candidate.type === type);
        return part === undefined ? '' : part.value;
      };
      const weekday = read('weekday');
      if (weekday === 'Sat' || weekday === 'Sun') return 'offPeak';
      const minutes = Number(read('hour')) * 60 + Number(read('minute'));
      return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60)
        ? 'peak'
        : 'offPeak';
    }

    const CURRENCY_SYMBOLS = { CNY: '¥', USD: '$', EUR: '€', JPY: '¥', GBP: '£' };

    function moneyText(value, currency) {
      const symbol = CURRENCY_SYMBOLS[currency] ?? '';
      if (!Number.isFinite(value) || value <= 0) return `${symbol}0.00`;
      if (value < 0.01) return `${symbol}${value.toFixed(4)}`;
      if (value < 1) return `${symbol}${value.toFixed(3)}`;
      return `${symbol}${value.toFixed(2)}`;
    }

    function groupThousands(value) {
      return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function compactTokens(value) {
      if (!Number.isFinite(value) || value <= 0) return '0';
      if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e7 ? 1 : 2)}M`;
      if (value >= 1e4) return `${(value / 1e3).toFixed(1)}k`;
      return groupThousands(value);
    }

    /** composer dock 里的空渲染桥：把当前会话 tokenUsage 投影广播给浮层卡片。 */
    let dashUsage = { usage: null };
    const dashUsageListeners = new Set();

    function publishDashUsage(patch) {
      dashUsage = { ...dashUsage, ...patch };
      for (const listener of Array.from(dashUsageListeners)) listener();
    }

    function subscribeDashUsage(listener) {
      dashUsageListeners.add(listener);
      return () => dashUsageListeners.delete(listener);
    }

    function useDashUsage() {
      return React.useSyncExternalStore(subscribeDashUsage, () => dashUsage);
    }

    function UsageBridge({ useProjection, sessionId }) {
      const usage = useProjection('tokenUsage');

      React.useEffect(() => {
        publishDashUsage({ usage: { sessionId, usage } });
      }, [sessionId, usage]);

      React.useEffect(() => () => publishDashUsage({ usage: null }), [sessionId]);

      return null;
    }

    // 共享统计轮询：面板与右侧卡任一挂载就开一个 1s 定时器，两边读同一份快照，避免重复请求。
    let dashStats = null;
    let dashStatsTimer = null;
    const dashStatsSubs = new Set();

    function publishDashStats(next) {
      if (next) dashStats = next;
      dashStatsSubs.forEach((fn) => fn());
    }

    async function requestDashStats() {
      try {
        const response = await fetch(ROUTE, { cache: 'no-store', credentials: 'same-origin', headers: { accept: 'application/json' } });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        publishDashStats(await response.json());
      } catch (error) {
        // Host 半未挂载时保持上一次读数。
      }
    }

    function subscribeDashStats(fn) {
      dashStatsSubs.add(fn);
      if (dashStatsTimer === null) {
        requestDashStats();
        dashStatsTimer = window.setInterval(requestDashStats, POLL_MS);
      }
      return () => {
        dashStatsSubs.delete(fn);
        if (dashStatsSubs.size === 0 && dashStatsTimer !== null) {
          window.clearInterval(dashStatsTimer);
          dashStatsTimer = null;
        }
      };
    }

    function useDashStats() {
      return React.useSyncExternalStore(subscribeDashStats, () => dashStats);
    }

    const RC = {
      card: {
        position: 'fixed',
        right: '6px',
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 1,
        boxSizing: 'border-box',
        width: '204px',
        padding: '12px',
        border: '.5px solid var(--dsw-alias-border-l1)',
        borderRadius: 'var(--dsw-radius-lg, 12px)',
        background: 'var(--dsw-specific-menu, var(--dsw-alias-bg-overlay))',
        boxShadow: 'var(--dsw-elevation-prominent, 0 8px 24px rgba(0, 0, 0, .12))',
        backdropFilter: 'var(--dsw-menu-backdrop-filter, none)',
        color: 'var(--dsw-alias-label-secondary)',
        fontFamily: 'inherit',
        fontSize: '12px',
        lineHeight: '18px',
        fontVariantNumeric: 'tabular-nums',
        pointerEvents: 'none',
        userSelect: 'none',
      },
      header: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' },
      dot: { width: '6px', height: '6px', borderRadius: '999px', background: 'var(--dsw-alias-state-success-primary)', flex: 'none' },
      headerText: {
        fontSize: '11px',
        letterSpacing: '.04em',
        textTransform: 'uppercase',
        color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))',
        whiteSpace: 'nowrap',
      },
      row: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' },
      label: { color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))', whiteSpace: 'nowrap' },
      value: { color: 'var(--dsw-alias-label-primary)', fontWeight: 500, whiteSpace: 'nowrap' },
      sub: {
        marginTop: '1px',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      track: { height: '3px', marginTop: '5px', borderRadius: '999px', background: 'var(--dsw-alias-interactive-bg-hover)', overflow: 'hidden' },
      fill: { height: '100%', borderRadius: '999px', background: 'var(--dash-accent, var(--dsw-alias-brand-primary))', transition: 'width .3s ease' },
      divider: { height: '.5px', margin: '10px 0', background: 'var(--dsw-alias-border-l1)' },
      clock: { textAlign: 'center' },
      time: { color: 'var(--dsw-alias-label-primary)', fontSize: '20px', fontWeight: 600, lineHeight: '26px', letterSpacing: '.02em' },
      date: { marginTop: '2px', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))' },
      handle: {
        position: 'fixed',
        right: '6px',
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 1,
        width: '6px',
        height: '96px',
        padding: '0',
        border: '0',
        display: 'block',
        appearance: 'none',
        WebkitAppearance: 'none',
        borderRadius: '999px',
        background: 'var(--dash-accent, var(--dsw-alias-brand-primary))',
        boxShadow: '0 2px 12px color-mix(in srgb, var(--dash-accent, var(--dsw-alias-brand-primary)) 45%, transparent), 0 0 0 0.5px rgba(0, 0, 0, 0.05)',
        cursor: 'pointer',
        pointerEvents: 'auto',
        transition: 'opacity .15s ease',
      },
      pin: {
        marginLeft: 'auto',
        width: '22px',
        height: '22px',
        padding: '0',
        border: '0',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        borderRadius: '7px',
        background: 'transparent',
        color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))',
        cursor: 'pointer',
      },
      pinActive: {
        background: 'color-mix(in srgb, var(--dash-accent, var(--dsw-alias-brand-primary)) 16%, transparent)',
        color: 'var(--dash-accent, var(--dsw-alias-brand-primary))',
      },
    };

    function RcMetric({ label, value, sub, percent, showBar }) {
      return h('div', null,
        h('div', { style: RC.row },
          h('span', { style: RC.label }, label),
          h('span', { style: RC.value }, value)),
        showBar && percent !== null && percent !== undefined
          ? h('div', { style: RC.track }, h('div', { style: { ...RC.fill, width: `${Math.min(100, Math.max(0, percent))}%` } }))
          : null,
        sub ? h('div', { style: RC.sub }, sub) : null);
    }

    function RcPinIcon({ pinned }) {
      return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true },
        h('line', { x1: '4.2', y1: '11.8', x2: '8.2', y2: '7.8', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' }),
        h('circle', { cx: '10.2', cy: '5.8', r: '3', fill: pinned ? 'currentColor' : 'none', stroke: 'currentColor', strokeWidth: '1.5' }));
    }

    const rcPad = (value) => String(value).padStart(2, '0');

    /** 右缘把手 + 可钉住的运行状态卡。 */
    function RightCard() {
      const stats = useDashStats();
      const store = useDashUsage();
      const accent = useDashAccent();
      const prefs = useDashPrefs();
      const [now, setNow] = React.useState(() => new Date());
      const [open, setOpen] = React.useState(true);
      const [pinned, setPinned] = React.useState(() => prefs.pin);
      const closeTimer = React.useRef(0);
      const pinnedRef = React.useRef(prefs.pin);

      React.useEffect(() => {
        const timer = window.setInterval(() => setNow(new Date()), 1000);
        return () => window.clearInterval(timer);
      }, []);

      const cancelClose = () => {
        if (closeTimer.current !== 0) {
          window.clearTimeout(closeTimer.current);
          closeTimer.current = 0;
        }
      };
      const show = () => {
        cancelClose();
        setOpen(true);
      };
      const scheduleClose = () => {
        if (pinnedRef.current) return;
        cancelClose();
        closeTimer.current = window.setTimeout(() => {
          closeTimer.current = 0;
          setOpen(false);
        }, 160);
      };
      const togglePin = () => {
        pinnedRef.current = !pinnedRef.current;
        setPinned(pinnedRef.current);
        cancelClose();
        setOpen(true);
      };

      React.useEffect(() => () => {
        if (closeTimer.current !== 0) window.clearTimeout(closeTimer.current);
      }, []);

      const usageEntry = store.usage;
      const usage = usageEntry ? usageEntry.usage : undefined;
      const sessionId = usageEntry ? usageEntry.sessionId : null;

      React.useEffect(() => {
        pinnedRef.current = prefs.pin;
        setPinned(prefs.pin);
        setOpen(true);
      }, [sessionId]);

      if (usageEntry === null) return null;

      const tier = priceTier(now);
      const pricing = DASH_PRICING[tier];
      const cpuPercent = stats && stats.cpu && typeof stats.cpu.percent === 'number' ? stats.cpu.percent : null;
      const memory = stats && stats.memory ? stats.memory : null;
      const cores = stats && stats.cpu ? stats.cpu.cores : null;

      const input = usage
        ? (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0)
        : 0;
      const output = usage ? usage.outputTokens || 0 : 0;
      const total = input + output;
      const cost = usage
        ? ((usage.uncachedInputTokens || 0) / 1e6) * pricing.input +
          ((usage.cacheReadTokens || 0) / 1e6) * pricing.cacheRead +
          ((usage.cacheWriteTokens || 0) / 1e6) * pricing.cacheWrite +
          (output / 1e6) * pricing.output
        : 0;

      const time = formatClock(now, prefs);
      const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

      const body = [];
      if (prefs.rows.cpu) {
        body.push(h(RcMetric, {
          key: 'cpu',
          label: t('cpu'),
          value: cpuPercent === null ? mt('unavailable') : `${cpuPercent.toFixed(1)}%`,
          sub: cores === null ? null : mt('cores', { count: cores }),
          percent: cpuPercent,
          showBar: true,
        }));
        body.push(h('div', { key: 'gap-cpu', style: { height: '10px' } }));
      }
      if (prefs.rows.memory) {
        body.push(h(RcMetric, {
          key: 'memory',
          label: t('memory'),
          value: memory === null ? mt('unavailable') : `${memory.percent.toFixed(1)}%`,
          sub: memory === null ? null : `${(memory.usedBytes / 1024 ** 3).toFixed(1)} / ${(memory.totalBytes / 1024 ** 3).toFixed(1)} GB`,
          percent: memory === null ? null : memory.percent,
          showBar: true,
        }));
      }
      if (prefs.rows.tokens || prefs.rows.cost) {
        body.push(h('div', { key: 'div-usage', style: RC.divider }));
      }
      if (prefs.rows.tokens) {
        body.push(h(RcMetric, {
          key: 'tokens',
          label: mt('tokens'),
          value: usage ? compactTokens(total) : mt('unavailable'),
          sub: usage ? `${t('input')} ${groupThousands(input)} · ${t('output')} ${groupThousands(output)}` : null,
        }));
        body.push(h('div', { key: 'gap-tokens', style: { height: '8px' } }));
      }
      if (prefs.rows.cost) {
        body.push(h(RcMetric, {
          key: 'cost',
          label: mt('cost'),
          value: usage ? moneyText(cost, DASH_PRICING.currency) : mt('unavailable'),
          sub: usage ? `${mt('estimate')} · ${mt(tier)}` : null,
        }));
      }
      if (prefs.rows.clock) {
        body.push(h('div', { key: 'div-clock', style: RC.divider }));
        body.push(h('div', { key: 'clock', style: RC.clock },
          h('div', { style: RC.time }, time),
          h('div', { style: RC.date }, date)));
      }

      const handle = h('button', {
        key: 'handle',
        type: 'button',
        'aria-label': mt('aria'),
        'aria-expanded': open,
        title: mt('aria'),
        'data-dsh-local-dashboard-handle': true,
        style: { ...RC.handle, ...accentVars(accent), opacity: open ? 0 : 1 },
        onMouseEnter: show,
        onMouseLeave: scheduleClose,
        onFocus: show,
        onBlur: scheduleClose,
        onClick: show,
      });

      const card = open
        ? h('aside', {
            key: 'card',
            style: { ...RC.card, ...accentVars(accent), pointerEvents: 'auto' },
            role: 'group',
            'aria-label': mt('aria'),
            'data-dsh-local-dashboard': true,
            onMouseEnter: show,
            onMouseLeave: scheduleClose,
          },
          h('div', { style: RC.header },
            h('span', { style: RC.dot, 'aria-hidden': true }),
            h('span', { style: RC.headerText }, mt('title')),
            h('button', {
              type: 'button',
              'aria-pressed': pinned,
              'aria-label': mt(pinned ? 'unpin' : 'pin'),
              title: mt(pinned ? 'unpin' : 'pin'),
              style: { ...RC.pin, ...(pinned ? RC.pinActive : null) },
              onClick: togglePin,
            }, h(RcPinIcon, { pinned }))),
          ...body)
        : null;

      return h(React.Fragment, null, card, handle);
    }

    // ── 设置页：仪表盘强调色 ────────────────────────────────
    const AS = {
      root: { display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0 28px' },
      intro: { margin: 0, fontSize: 13, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)', maxWidth: '64ch' },
      grid: { display: 'flex', flexWrap: 'wrap', gap: 10, maxWidth: 520 },
      swatch: { width: 34, height: 34, borderRadius: 10, padding: 0, cursor: 'pointer', border: '1px solid rgba(0,0,0,.12)', boxShadow: '0 1px 2px rgba(0,0,0,.12)' },
      swatchOn: {
        border: '2px solid var(--dsw-alias-label-primary)',
        boxShadow: '0 0 0 2px var(--dsw-alias-bg-layer-1), 0 0 0 3px var(--dsw-alias-label-primary)',
      },
      foot: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
      reset: {
        font: 'inherit', fontSize: 13, lineHeight: 1, padding: '8px 14px', borderRadius: 999, cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary)', background: 'transparent', border: '0.5px solid var(--dsw-alias-border-l1)',
      },
      note: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
      hex: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
      group: {
        display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', borderRadius: 12,
        border: '0.5px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)',
      },
      groupHead: { margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
      rowLabel: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' },
      seg: {
        display: 'inline-flex', padding: 2, borderRadius: 9, background: 'var(--dsw-alias-bg-layer-1)',
        border: '0.5px solid var(--dsw-alias-border-l1)',
      },
      segBtn: {
        font: 'inherit', fontSize: 12.5, lineHeight: 1, padding: '7px 12px', borderRadius: 7, cursor: 'pointer',
        background: 'transparent', border: 'none', color: 'var(--dsw-alias-label-secondary)',
      },
      segOn: {
        background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', fontWeight: 600,
        boxShadow: '0 1px 2px rgba(0,0,0,.12)',
      },
      toggle: {
        width: 38, height: 22, borderRadius: 999, padding: 2, cursor: 'pointer', border: 'none',
        background: 'var(--dsw-alias-border-l1)', display: 'inline-flex', alignItems: 'center',
        justifyContent: 'flex-start', transition: 'background .16s',
      },
      toggleOn: { background: 'var(--dash-accent, var(--dsw-alias-brand-primary))', justifyContent: 'flex-end' },
      knob: { width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)' },
      select: {
        font: 'inherit', fontSize: 12.5, padding: '6px 8px', borderRadius: 8,
        border: '0.5px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
      },
      chips: { display: 'flex', gap: 6, flexWrap: 'wrap' },
      chip: {
        font: 'inherit', fontSize: 12, lineHeight: 1, padding: '6px 10px', borderRadius: 999, cursor: 'pointer',
        background: 'transparent', border: '0.5px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-secondary)',
      },
      chipOn: {
        background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
        borderColor: 'var(--dash-accent, var(--dsw-alias-brand-primary))',
      },
    };

    function DashboardSection() {
      const current = useDashAccent();
      const prefs = useDashPrefs();

      const seg = (key, items, value, onPick) => h('div', { key, style: AS.seg },
        items.map((item) => h('button', {
          key: item.value,
          type: 'button',
          'aria-pressed': value === item.value,
          style: value === item.value ? { ...AS.segBtn, ...AS.segOn } : AS.segBtn,
          onClick: () => onPick(item.value),
        }, item.label)));

      const toggle = (key, on, onPick) => h('button', {
        key,
        type: 'button',
        role: 'switch',
        'aria-checked': on,
        style: on ? { ...AS.toggle, ...AS.toggleOn } : AS.toggle,
        onClick: () => onPick(!on),
      }, h('span', { style: AS.knob }));

      const row = (key, label, control) => h('div', { key, style: AS.row },
        h('span', { style: AS.rowLabel }, label), control);

      const group = (key, title, children) => h('section', { key, style: AS.group }, [
        h('h4', { key: 'h', style: AS.groupHead }, title),
        ...children,
      ]);

      const rows = [
        ['cpu', at('rowCpu')],
        ['memory', at('rowMemory')],
        ['tokens', at('rowTokens')],
        ['cost', at('rowCost')],
        ['clock', at('rowClock')],
      ];

      return h('div', { style: AS.root }, [
        h('p', { key: 'intro', style: AS.intro }, at('intro')),

        group('time', at('timeGroup'), [
          row('hour12', at('hour12'), toggle('t12', prefs.hour12, (v) => setPrefs({ hour12: v }))),
          row('seconds', at('seconds'), toggle('sec', prefs.seconds, (v) => setPrefs({ seconds: v }))),
        ]),

        group('weather', at('weatherGroup'), [
          row('city', at('city'), h('select', {
            key: 'sel',
            style: AS.select,
            value: prefs.city,
            onChange: (event) => setPrefs({ city: event.target.value }),
          }, [
            h('option', { key: 'auto', value: '' }, at('autoCity')),
            ...CITY_PRESETS.map((item) => h('option', { key: item.name, value: item.name }, item.name)),
          ])),
          row('unit', at('unit'), seg('unit', [
            { value: 'c', label: '°C' },
            { value: 'f', label: '°F' },
          ], prefs.unit, (v) => setPrefs({ unit: v }))),
        ]),

        group('card', at('cardGroup'), [
          row('pin', at('pin'), toggle('pin', prefs.pin, (v) => setPrefs({ pin: v }))),
          row('rows', at('rows'), h('div', { style: AS.chips },
            rows.map(([key, label]) => {
              const on = prefs.rows[key];
              return h('button', {
                key,
                type: 'button',
                'aria-pressed': on,
                style: on ? { ...AS.chip, ...AS.chipOn } : AS.chip,
                onClick: () => setPrefs({ rows: { [key]: !on } }),
              }, label);
            }))),
        ]),

        group('accent', at('accentGroup'), [
          h('div', { key: 'grid', style: AS.grid },
            ACCENT_COLORS.map((color) => h('button', {
              key: color.id,
              type: 'button',
              title: color.id,
              'aria-label': color.id,
              style: current === color.hex
                ? { ...AS.swatch, ...AS.swatchOn, background: color.hex }
                : { ...AS.swatch, background: color.hex },
              onClick: () => setDashAccent(color.hex),
            }))),
          h('div', { key: 'foot', style: AS.foot }, [
            h('button', {
              key: 'reset',
              type: 'button',
              style: { ...AS.reset, opacity: current ? 1 : 0.5 },
              disabled: !current,
              onClick: () => setDashAccent(null),
            }, at('reset')),
            h('span', { key: 'label', style: AS.note }, `${at('current')} `),
            h('span', { key: 'hex', style: AS.hex }, current || at('inherit')),
          ]),
        ]),

        h('div', { key: 'all', style: AS.foot }, [
          h('button', {
            key: 'resetAll',
            type: 'button',
            style: AS.reset,
            onClick: () => {
              setDashAccent(null);
              setPrefs(DEFAULT_PREFS);
            },
          }, at('resetAll')),
          h('span', { key: 'saved', style: AS.note }, at('savedNote')),
        ]),
      ]);
    }

    class DashBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }

      static getDerivedStateFromError(error) {
        return { error };
      }

      render() {
        const state = this.state || {};
        if (state.error) {
          return h('div', { style: AS.root },
            h('p', { style: AS.intro }, '强调色设置加载失败'),
            h('pre', {
              style: { margin: 0, padding: 12, borderRadius: 8, fontSize: 11, whiteSpace: 'pre-wrap', background: 'var(--dsw-alias-bg-layer-2)' },
            }, String((state.error && state.error.message) || state.error)));
        }
        return this.props.children;
      }
    }

    function DashboardSettings() {
      return h(DashBoundary, null, h(DashboardSection));
    }

    // 设置导航图标：仪表盘（半圆表盘 + 指针）
    function DashboardNavIcon(props) {
      const size = props && props.size ? props.size : 16;
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      }, [
        h('path', { key: 'arc', d: 'M2.4 11.9a6.1 6.1 0 0 1 11.2 0' }),
        h('path', { key: 'needle', d: 'M8 11.9 10.9 6.9' }),
        h('circle', { key: 'hub', cx: 8, cy: 11.9, r: 1.05, fill: 'currentColor', stroke: 'none' }),
      ]);
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: () => (isZh() ? TEXT.title.zh : TEXT.title.en),
        }, ConsoleIcon)), 'local-dashboard: sidebar icon');

        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, Panel)), 'local-dashboard: panel');

        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'local-dashboard-monitor',
          order: 11,
        }, RightCard)), 'local-dashboard: status card');

        ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'local-dashboard-bridge',
          order: 101,
        }, UsageBridge)), 'local-dashboard: usage bridge');

        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'local-dashboard',
          order: 34,
          label: () => at('title'),
        }, DashboardSettings)), 'local-dashboard: accent settings');

        ctx.effect(() => ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: 'local-dashboard',
        }, DashboardNavIcon)), 'local-dashboard: settings nav icon');
      },
    };
  },
});
