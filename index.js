/**
 * Host 半：一次只读快照，包含
 *   · 系统 CPU / 内存 / 进程内存
 *   · 每个活跃会话的累计 Token（从 assistant/message.usage 增量累加）
 *
 * 浏览器半无法读系统计数器，也拿不到会话事件，所以这些都在这里算，
 * 通过同源 HTTP 路由交给面板轮询。
 */
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROUTE = '/plugin-local-dashboard/stats';

/** 静态素材目录（桌宠立绘）。 */
const ASSETS = fileURLToPath(new URL('./assets/', import.meta.url));
const PET_SPRITES = ['smile', 'smile-closed', 'typing', 'notes', 'knock', 'confetti', 'panic', 'guilty', 'stone', 'confident'];

/** 每个 CPU 的累计 tick 计数。 */
function cpuTimes() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const value of Object.values(cpu.times)) total += value;
    idle += cpu.times.idle;
  }
  return { idle, total, cores: cpus.length };
}

let previous = cpuTimes();
let previousAt = Date.now();
let lastCpuPercent = null;

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

/** sessionId -> 已累加的 Token 与已扫描到的事件序号。 */
const progress = new Map();

/** GPU 快照：由后台每 2 秒问一次 nvidia-smi，取不到就标记 missing。 */
const gpu = { name: null, percent: null, usedBytes: null, totalBytes: null, missing: false, at: 0 };
let gpuBusy = false;

function pollGpu() {
  if (gpuBusy) return;
  gpuBusy = true;
  execFile(
    'nvidia-smi',
    ['--query-gpu=utilization.gpu,memory.used,memory.total,name', '--format=csv,noheader,nounits'],
    { timeout: 1500, windowsHide: true },
    (error, stdout) => {
      gpuBusy = false;
      if (error || !stdout) {
        gpu.missing = true;
        gpu.at = Date.now();
        return;
      }
      const line = String(stdout).trim().split(/\r?\n/)[0] || '';
      const parts = line.split(',').map((part) => part.trim());
      const util = Number(parts[0]);
      const usedMb = Number(parts[1]);
      const totalMb = Number(parts[2]);
      gpu.name = parts[3] || null;
      gpu.percent = Number.isFinite(util) ? clampPercent(util) : null;
      gpu.usedBytes = Number.isFinite(usedMb) ? usedMb * 1024 * 1024 : null;
      gpu.totalBytes = Number.isFinite(totalMb) ? totalMb * 1024 * 1024 : null;
      gpu.missing = false;
      gpu.at = Date.now();
    },
  );
}

function emptyTally() {
  return { seq: 0, input: 0, output: 0, cached: 0, lastAt: null, turns: 0, running: false, pendingApprovals: 0 };
}

/** 把 session 里新增的 assistant/message 用量折进 tally。只读、增量。 */
function foldSession(session, tally) {
  let events = [];
  try {
    events = session.snapshotEvents(tally.seq);
  } catch (error) {
    return tally;
  }
  for (const event of events) {
    if (!event) continue;
    const type = String(event.type || '');

    // 运行状态：turn/start 打开、turn/end 关闭。
    // 审批只可能存在于一轮之内，轮次结束就作废（否则被中断的审批会一直挂着）。
    if (type === 'turn/start') tally.running = true;
    else if (type === 'turn/end') { tally.running = false; tally.turns += 1; tally.pendingApprovals = 0; }

    // 审批：请求入队，决定出队（两种命名都兜住）。
    if (type.includes('approval')) {
      if (type.includes('request') || type.includes('asked')) tally.pendingApprovals += 1;
      else if (type.includes('decided')) tally.pendingApprovals = Math.max(0, tally.pendingApprovals - 1);
    }

    if (type !== 'assistant/message') continue;
    const usage = event.data && event.data.usage;
    if (!usage) continue;
    tally.input += Number(usage.inputTokens) || 0;
    tally.output += Number(usage.outputTokens) || 0;
    tally.cached += (Number(usage.cacheReadTokens) || 0) + (Number(usage.cacheWriteTokens) || 0);
    tally.lastAt = event.time || tally.lastAt;
  }
  try {
    const next = Number(session.seq);
    if (Number.isFinite(next)) tally.seq = next;
  } catch (error) {
    // 老版本没有 seq 时维持原值。
  }
  return tally;
}

function readSessions(ctx) {
  const store = ctx.get('sessions');
  if (!store || typeof store.list !== 'function') return { sessions: [], totals: { input: 0, output: 0, cached: 0, total: 0 } };

  let live = [];
  try {
    live = store.list() || [];
  } catch (error) {
    return { sessions: [], totals: { input: 0, output: 0, cached: 0, total: 0 } };
  }

  const seen = new Set();
  const rows = [];
  const totals = { input: 0, output: 0, cached: 0, total: 0 };

  for (const session of live) {
    let id;
    try {
      id = String(session.id);
    } catch (error) {
      continue;
    }
    seen.add(id);
    const tally = foldSession(session, progress.get(id) || emptyTally());
    progress.set(id, tally);

    let cwd = null;
    let createdAt = null;
    try {
      cwd = session.header && session.header.cwd ? String(session.header.cwd) : null;
      createdAt = session.header && session.header.createdAt ? Number(session.header.createdAt) : null;
    } catch (error) {
      // 忽略。
    }

    const total = tally.input + tally.output + tally.cached;
    rows.push({
      id,
      cwd,
      createdAt,
      input: tally.input,
      output: tally.output,
      cached: tally.cached,
      total,
      turns: tally.turns,
      running: tally.running,
      pendingApprovals: tally.pendingApprovals,
      lastAt: tally.lastAt,
    });
    totals.input += tally.input;
    totals.output += tally.output;
    totals.cached += tally.cached;
    totals.total += total;
  }

  // 会话已关闭就丢掉它的进度，避免 Map 无限增长。
  for (const id of progress.keys()) {
    if (!seen.has(id)) progress.delete(id);
  }

  // 最近有动静的排前面。
  rows.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  return { sessions: rows, totals };
}

function snapshot(ctx) {
  const now = cpuTimes();
  const at = Date.now();
  const elapsed = at - previousAt;
  if (elapsed >= 250) {
    const totalDelta = now.total - previous.total;
    const idleDelta = now.idle - previous.idle;
    if (totalDelta > 0) lastCpuPercent = clampPercent(((totalDelta - idleDelta) / totalDelta) * 100);
    previous = now;
    previousAt = at;
  }

  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  const memoryUsage = process.memoryUsage();

  return {
    time: at,
    cpu: { percent: lastCpuPercent, cores: now.cores },
    memory: {
      totalBytes,
      freeBytes,
      usedBytes,
      percent: totalBytes > 0 ? clampPercent((usedBytes / totalBytes) * 100) : null,
    },
    process: {
      rssBytes: memoryUsage.rss,
      heapUsedBytes: memoryUsage.heapUsed,
      uptimeSeconds: Math.round(process.uptime()),
    },
    gpu: { ...gpu },
    ...readSessions(ctx),
  };
}

export function apply(ctx) {
  ctx.effect(() => {
    pollGpu();
    const timer = setInterval(pollGpu, 2000);
    return () => clearInterval(timer);
  }, 'local-dashboard: gpu sampler');

  ctx.inject(['webServer'], (child) => {
    child.effect(
      () => child.webServer.register({
        kind: 'exact',
        path: ROUTE,
        handler: (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { allow: 'GET, HEAD' });
            res.end();
            return;
          }
          const body = JSON.stringify(snapshot(ctx));
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'content-length': Buffer.byteLength(body),
          });
          res.end(req.method === 'HEAD' ? undefined : body);
        },
      }),
      'local-dashboard: stats route',
    );

    // 桌宠立绘：固定文件列表，精确路由 + 长缓存。
    child.effect(() => {
      const routes = PET_SPRITES.map((name) => ({
        kind: 'exact',
        path: '/plugin-local-dashboard/pet/' + name + '.webp',
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { allow: 'GET, HEAD' });
            res.end();
            return;
          }
          const target = path.join(ASSETS, 'pet', name + '.webp');
          try {
            const info = await stat(target);
            res.writeHead(200, {
              'content-type': 'image/webp',
              'cache-control': 'public, max-age=86400',
              'content-length': info.size,
            });
            if (req.method === 'HEAD') { res.end(); return; }
            createReadStream(target).pipe(res);
          } catch (error) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('sprite not found');
          }
        },
      }));
      const disposers = routes.map((route) => child.webServer.register(route));
      return () => disposers.forEach((dispose) => dispose());
    }, 'local-dashboard: pet sprites');
  });
}
