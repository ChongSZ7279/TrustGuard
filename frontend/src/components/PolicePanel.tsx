import { useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl } from '../api';
import type { BlockedUserEntry, Decision, PersistedTransaction, PoliceTicket, RelatedTransactionsResponse, TicketStatus } from '../types';
import { decisionClasses } from './decisionStyles';
import { RiskCharts } from './RiskCharts';

type PoliceTx = PersistedTransaction & {
  tx_id: string;
  timestamp?: string;
};

const pill = (color: 'rose' | 'amber' | 'emerald' | 'sky' | 'slate', filled = false) => {
  const map = {
    rose: filled ? 'bg-rose-600 text-white border-rose-500' : 'bg-rose-950/40 text-rose-300 border-rose-700/60',
    amber: filled ? 'bg-amber-600 text-white border-amber-500' : 'bg-amber-950/30 text-amber-300 border-amber-700/50',
    emerald: filled ? 'bg-emerald-700 text-white border-emerald-600' : 'bg-emerald-950/30 text-emerald-300 border-emerald-700/50',
    sky: filled ? 'bg-sky-600 text-white border-sky-500' : 'bg-sky-950/30 text-sky-300 border-sky-700/50',
    slate: filled ? 'bg-slate-700 text-slate-100 border-slate-600' : 'bg-slate-900/50 text-slate-400 border-slate-700/50',
  };
  return `inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${map[color]}`;
};

const card = 'rounded-2xl border border-slate-800/80 bg-slate-900/50';
const inputCls = 'w-full h-8 rounded-lg border border-slate-700/80 bg-slate-950/70 px-3 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500/60 transition';
const labelCls = 'block text-[10px] font-medium text-slate-500 mb-1 uppercase tracking-wider';

export const PolicePanel: React.FC = () => {
  const [policeKey, setPoliceKey] = useState<string>('police-demo-key');
  const [blockUserId, setBlockUserId] = useState<string>('');
  const [blockReason, setBlockReason] = useState<string>('Confirmed fraud / mule account');
  const [blocked, setBlocked] = useState<BlockedUserEntry[]>([]);
  const [todayTx, setTodayTx] = useState<PoliceTx[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<string>('');
  const [decisionFilter, setDecisionFilter] = useState<Decision | 'ALL'>('ALL');
  const [minRisk, setMinRisk] = useState<number>(0.0);
  const [userIdFilter, setUserIdFilter] = useState<string>('');
  const [merchantFilter, setMerchantFilter] = useState<string>('');
  const [amountMin, setAmountMin] = useState<string>('');
  const [amountMax, setAmountMax] = useState<string>('');
  const [preset, setPreset] = useState<'CUSTOM' | 'HIGH_RISK' | 'NEW_DEVICES' | 'LARGE_TX'>('CUSTOM');
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(() => new Set());
  const [confirmBlockOpen, setConfirmBlockOpen] = useState<boolean>(false);
  const [pendingBlock, setPendingBlock] = useState<{ user_id: string; reason: string } | null>(null);
  const [confirmUnblockOpen, setConfirmUnblockOpen] = useState<boolean>(false);
  const [pendingUnblockUserId, setPendingUnblockUserId] = useState<string | null>(null);
  const [caseByTxId, setCaseByTxId] = useState<
    Record<
      string,
      {
        status: 'Pending' | 'Under Investigation' | 'Resolved';
        assignedTo: string;
        notes: string;
        updatedAt: number;
        ticketId?: string;
        createdAt?: number;
      }
    >
  >({});
  const [lastBlockImpact, setLastBlockImpact] = useState<{ user_id: string; preventedTx: number; estimatedSavings: number; at: number } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [ticketToast, setTicketToast] = useState<{ ticketId: string; txId: string; assignedTo: string; at: number } | null>(null);
  const [policeView, setPoliceView] = useState<'CONSOLE' | 'TICKETS'>('CONSOLE');
  const [tickets, setTickets] = useState<PoliceTicket[]>([]);
  const [ticketStatusFilter, setTicketStatusFilter] = useState<TicketStatus | 'ALL'>('OPEN');
  const [isTicketsLoading, setIsTicketsLoading] = useState(false);
  const [relatedTrail, setRelatedTrail] = useState<RelatedTransactionsResponse | null>(null);
  const [isTrailLoading, setIsTrailLoading] = useState(false);

  const liveListRef = useRef<HTMLDivElement | null>(null);
  const [recentAlertTxIds, setRecentAlertTxIds] = useState<Set<string>>(() => new Set());
  const prevAlertTxIdsRef = useRef<Set<string>>(new Set());
  const pageSize = 25;

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const toMs = (t: PoliceTx) => {
    const raw = t.created_at ?? t.timestamp;
    const ms = raw ? new Date(raw as any).getTime() : NaN;
    return Number.isFinite(ms) ? ms : Date.now();
  };
  const formatRm = (n: number) =>
    `RM ${Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}`;
  const parseAmount = (v: string) => { if (!v?.trim()) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const actionFromRisk = (risk: number) => {
    const r = clamp01(risk);
    if (r >= 0.9) return { action: 'BLOCK' as const, color: pill('rose', true) };
    if (r >= 0.6) return { action: 'REVIEW' as const, color: pill('amber', true) };
    return { action: 'APPROVE' as const, color: pill('emerald', true) };
  };

  const headers = useMemo(() => ({ 'Content-Type': 'application/json', 'X-Police-Key': policeKey }), [policeKey]);

  const refresh = async () => {
    setError(null); setIsLoading(true);
    try {
      const [txRes, blockedRes] = await Promise.all([
        fetch(apiUrl('/police/transactions/today?limit=200'), { headers }),
        fetch(apiUrl('/police/blocked-users?limit=200'), { headers }),
      ]);
      if (!txRes.ok || !blockedRes.ok) throw new Error('unauthorized');
      setTodayTx(await txRes.json());
      setBlocked(await blockedRes.json());
    } catch {
      setError('Police endpoints not reachable or invalid X-Police-Key.');
      setTodayTx([]); setBlocked([]);
    } finally { setIsLoading(false); }
  };

  const refreshTickets = async () => {
    setIsTicketsLoading(true);
    setError(null);
    try {
      const qs = ticketStatusFilter === 'ALL' ? '' : `?status=${encodeURIComponent(ticketStatusFilter)}`;
      const res = await fetch(apiUrl(`/police/tickets${qs}&limit=200`.replace('?&', '?')), { headers });
      if (!res.ok) throw new Error('tickets failed');
      setTickets((await res.json()) as PoliceTicket[]);
    } catch {
      setError('Failed to load tickets (check police key/token and backend).');
      setTickets([]);
    } finally {
      setIsTicketsLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []); // eslint-disable-line

  useEffect(() => {
    if (preset === 'HIGH_RISK') { setMinRisk(0.8); setDecisionFilter('ALL'); }
    else if (preset === 'LARGE_TX') { setAmountMin('500'); setDecisionFilter('ALL'); }
    else if (preset === 'NEW_DEVICES') { setQuery('new device'); }
  }, [preset]);

  const resetFilters = () => {
    setPreset('CUSTOM'); setQuery(''); setUserIdFilter(''); setMerchantFilter('');
    setAmountMin(''); setAmountMax(''); setDecisionFilter('ALL'); setMinRisk(0); setPage(1);
  };

  const filteredTx = useMemo(() => {
    const q = query.trim().toLowerCase();
    const userQ = userIdFilter.trim().toLowerCase();
    const merchQ = merchantFilter.trim().toLowerCase();
    const minAmt = parseAmount(amountMin);
    const maxAmt = parseAmount(amountMax);
    return todayTx.filter((t) => {
      if (decisionFilter !== 'ALL' && t.decision !== decisionFilter) return false;
      if (Number(t.risk_score ?? 0) < Number(minRisk ?? 0)) return false;
      const amt = Number(t.amount ?? 0);
      if (minAmt !== null && amt < minAmt) return false;
      if (maxAmt !== null && amt > maxAmt) return false;
      if (userQ && !String(t.user_id ?? '').toLowerCase().includes(userQ)) return false;
      if (merchQ && !String(t.merchant_id ?? '').toLowerCase().includes(merchQ)) return false;
      if (!q) return true;
      return ['user_id', 'device_id', 'location', 'merchant_id', 'tx_id', 'decision'].some(
        (k) => String((t as any)[k] ?? '').toLowerCase().includes(q)
      );
    });
  }, [todayTx, query, decisionFilter, minRisk, userIdFilter, merchantFilter, amountMin, amountMax]);

  const liveAlerts: PoliceTx[] = useMemo(() =>
    [...todayTx]
      .sort((a, b) => Number(b.risk_score ?? 0) - Number(a.risk_score ?? 0))
      .filter((t) => (t.risk_score ?? 0) >= 0.8 && !dismissedAlertIds.has(String(t.tx_id)))
      .slice(0, 10),
    [todayTx, dismissedAlertIds]
  );

  const summary = useMemo(() => ({
    total: todayTx.length,
    blockedCount: todayTx.filter((t) => t.decision === 'BLOCK').length,
    flaggedCount: todayTx.filter((t) => t.decision === 'FLAG').length,
    approvedCount: todayTx.filter((t) => t.decision === 'APPROVE').length,
    highRisk: todayTx.filter((t) => Number(t.risk_score ?? 0) >= 0.8).length,
  }), [todayTx]);

  const riskBands = useMemo(() => ({
    low: todayTx.filter((t) => Number(t.risk_score ?? 0) < 0.3).length,
    medium: todayTx.filter((t) => Number(t.risk_score ?? 0) >= 0.3 && Number(t.risk_score ?? 0) < 0.8).length,
    high: todayTx.filter((t) => Number(t.risk_score ?? 0) >= 0.8).length,
  }), [todayTx]);

  const riskBuckets = useMemo(() => {
    const counts = new Array(10).fill(0);
    for (const t of todayTx) counts[Math.min(9, Math.floor(clamp01(Number(t.risk_score ?? 0)) * 10))] += 1;
    return counts;
  }, [todayTx]);

  useEffect(() => { setPage(1); }, [query, decisionFilter, minRisk, userIdFilter, merchantFilter, amountMin, amountMax]);

  const pagedTx = useMemo(() => filteredTx.slice((page - 1) * pageSize, page * pageSize), [filteredTx, page]);
  const pageCount = useMemo(() => Math.max(1, Math.ceil(filteredTx.length / pageSize)), [filteredTx.length]);
  const selectedTx = useMemo(() => selectedTxId ? todayTx.find((t) => String(t.tx_id) === String(selectedTxId)) ?? null : null, [todayTx, selectedTxId]);

  const blockedSet = useMemo(() => new Set(blocked.map((b) => String(b.user_id))), [blocked]);

  const openBlockConfirm = (user_id: string, reason: string) => {
    const uid = user_id.trim();
    if (!uid) return;
    if (blockedSet.has(String(uid))) {
      setError(`User ${uid} is already in the blocked list.`);
      return;
    }
    setPendingBlock({ user_id: uid, reason });
    setConfirmBlockOpen(true);
  };

  const confirmBlock = async () => {
    if (!pendingBlock) return;
    setError(null);
    try {
      const res = await fetch(apiUrl('/police/block-user'), { method: 'POST', headers, body: JSON.stringify(pendingBlock) });
      if (!res.ok) throw new Error('block failed');
      const userHighRiskTx = todayTx.filter((t) => String(t.user_id) === String(pendingBlock.user_id) && Number(t.risk_score ?? 0) >= 0.8);
      const preventedTx = Math.max(1, Math.min(10, userHighRiskTx.length || 3));
      const avg = userHighRiskTx.length ? userHighRiskTx.reduce((s, t) => s + Number(t.amount ?? 0), 0) / userHighRiskTx.length : 350;
      setLastBlockImpact({ user_id: pendingBlock.user_id, preventedTx, estimatedSavings: Math.max(0, preventedTx * avg * 0.6), at: Date.now() });
      setBlockUserId(''); setBlockReason('Confirmed fraud / mule account');
      setConfirmBlockOpen(false); setPendingBlock(null);
      await refresh();
    } catch { setError('Failed to block user.'); }
  };

  const confirmUnblock = async () => {
    if (!pendingUnblockUserId) return;
    setError(null);
    try {
      const res = await fetch(apiUrl('/police/unblock-user'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ user_id: pendingUnblockUserId })
      });
      if (!res.ok) throw new Error('unblock failed');
      setConfirmUnblockOpen(false);
      setPendingUnblockUserId(null);
      await refresh();
    } catch {
      setError('Failed to unblock user.');
    }
  };

  const createTicketId = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `TG-${y}${m}${day}-${rand}`;
  };

  const submitCaseTicket = () => {
    if (!selectedTx) return;
    const key = String(selectedTx.tx_id);
    const current = caseByTxId[key] ?? { status: 'Pending' as const, assignedTo: '', notes: '', updatedAt: Date.now() };
    const assigned = (current.assignedTo ?? '').trim();
    if (!assigned) {
      setError('Assign an officer before creating a ticket.');
      return;
    }

    // Persist ticket to backend (MongoDB). If ticket already exists, backend will return existing.
    (async () => {
      try {
        const res = await fetch(apiUrl('/police/tickets'), {
          method: 'POST',
          headers,
          body: JSON.stringify({
            tx_id: key,
            assigned_to: assigned,
            notes: current.notes ?? '',
            priority: Number(selectedTx.risk_score ?? 0) >= 0.95 ? 'CRITICAL' : Number(selectedTx.risk_score ?? 0) >= 0.9 ? 'HIGH' : 'MEDIUM',
          }),
        });
        if (!res.ok) throw new Error('create ticket failed');
        const json = (await res.json()) as PoliceTicket;
        const now = Date.now();
        setCaseByTxId((p) => ({
          ...p,
          [key]: {
            ...current,
            status: 'Under Investigation',
            assignedTo: json.assigned_to,
            notes: json.notes ?? current.notes ?? '',
            ticketId: json.ticket_id,
            createdAt: current.createdAt ?? now,
            updatedAt: now,
          },
        }));
        setTicketToast({ ticketId: json.ticket_id, txId: key, assignedTo: json.assigned_to, at: now });
        await refreshTickets();
      } catch {
        setError('Failed to create ticket (backend unreachable or unauthorized).');
      }
    })();
  };

  useEffect(() => {
    if (!ticketToast) return;
    const t = window.setTimeout(() => setTicketToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [ticketToast]);

  useEffect(() => {
    if (policeView !== 'TICKETS') return;
    refreshTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policeView, ticketStatusFilter]);

  const loadRelatedTrail = async (txId: string) => {
    setIsTrailLoading(true);
    setRelatedTrail(null);
    try {
      const res = await fetch(apiUrl(`/police/transactions/related?tx_id=${encodeURIComponent(txId)}&limit=80`), { headers });
      if (!res.ok) throw new Error('trail failed');
      setRelatedTrail((await res.json()) as RelatedTransactionsResponse);
    } catch {
      setRelatedTrail(null);
    } finally {
      setIsTrailLoading(false);
    }
  };

  const insight = useMemo(() => {
    const now = Date.now(), tenMin = 600_000, oneHour = 3_600_000;
    const last10mHigh = todayTx.filter((t) => now - toMs(t) <= tenMin && Number(t.risk_score ?? 0) >= 0.8);
    const prev10mHigh = todayTx.filter((t) => { const a = now - toMs(t); return a > tenMin && a <= 2 * tenMin && Number(t.risk_score ?? 0) >= 0.8; });
    const last1hHigh = todayTx.filter((t) => now - toMs(t) <= oneHour && Number(t.risk_score ?? 0) >= 0.8).length;
    const prev1hHigh = todayTx.filter((t) => { const a = now - toMs(t); return a > oneHour && a <= 2 * oneHour && Number(t.risk_score ?? 0) >= 0.8; }).length;
    const highTrendPct = prev1hHigh > 0 ? ((last1hHigh - prev1hHigh) / prev1hHigh) * 100 : last1hHigh > 0 ? 100 : 0;
    const spike = prev10mHigh.length > 0 ? last10mHigh.length >= Math.ceil(prev10mHigh.length * 2) : last10mHigh.length >= 3;
    const userCounts = new Map<string, number>();
    for (const t of last10mHigh) userCounts.set(String(t.user_id), (userCounts.get(String(t.user_id)) ?? 0) + 1);
    return {
      last10mHighCount: last10mHigh.length,
      potentialLossPrevented: last10mHigh.reduce((s, t) => s + Number(t.amount ?? 0), 0),
      repeatSuspiciousUsers: [...userCounts.values()].filter((c) => c >= 2).length,
      highTrendPct, spike,
    };
  }, [todayTx]);

  const intelligence = useMemo(() => {
    const high = todayTx.filter((t) => Number(t.risk_score ?? 0) >= 0.8);
    const deviceToUsers = new Map<string, Set<string>>();
    for (const t of high) {
      const d = String(t.device_id ?? ''), u = String(t.user_id ?? '');
      if (!d || !u) continue;
      if (!deviceToUsers.has(d)) deviceToUsers.set(d, new Set());
      deviceToUsers.get(d)!.add(u);
    }
    const linked = [...deviceToUsers.entries()].filter(([, u]) => u.size >= 2).slice(0, 3)
      .map(([device_id, users]) => ({ device_id, users: [...users].slice(0, 6) }));
    const patterns: Array<{ label: string; users: string[] }> = [];
    const byUser = new Map<string, PoliceTx[]>();
    for (const t of todayTx) { const u = String(t.user_id ?? ''); if (!u) continue; if (!byUser.has(u)) byUser.set(u, []); byUser.get(u)!.push(t); }
    for (const [u, txs] of byUser.entries()) {
      const sorted = [...txs].sort((a, b) => toMs(a) - toMs(b)).slice(-12);
      if (sorted.length < 6) continue;
      const amounts = sorted.map((t) => Number(t.amount ?? 0));
      if (amounts.slice(0, -1).filter((a) => a > 0 && a <= 50).length >= 4 && amounts[amounts.length - 1] >= 300)
        patterns.push({ label: 'Multiple small transactions → large withdrawal', users: [u] });
    }
    return { linked, patterns: patterns.slice(0, 2) };
  }, [todayTx]);

  useEffect(() => {
    const current = new Set(liveAlerts.map((t) => String(t.tx_id)));
    const fresh = new Set<string>([...current].filter((id) => !prevAlertTxIdsRef.current.has(id)));
    prevAlertTxIdsRef.current = current;
    if (fresh.size) {
      setRecentAlertTxIds(fresh);
      if (liveListRef.current) liveListRef.current.scrollTop = 0;
      const timer = window.setTimeout(() => setRecentAlertTxIds(new Set()), 3500);
      return () => window.clearTimeout(timer);
    }
    return;
  }, [liveAlerts]);

  const xaiForTx = useMemo(() => {
    if (!selectedTx) return null;
    const userTx = todayTx.filter((t) => String(t.user_id) === String(selectedTx.user_id));
    const sorted = [...userTx].sort((a, b) => toMs(a) - toMs(b));
    const idx = sorted.findIndex((t) => String(t.tx_id) === String(selectedTx.tx_id));
    const prev = idx > 0 ? sorted[idx - 1] : null;
    const userAvg = userTx.length ? userTx.reduce((s, t) => s + Number(t.amount ?? 0), 0) / userTx.length : 0;
    const amount = Number(selectedTx.amount ?? 0);
    const hasSeenDevice = userTx.some((t) => String(t.device_id) === String(selectedTx.device_id) && String(t.tx_id) !== String(selectedTx.tx_id));
    const reasons: string[] = [];
    if (String(selectedTx.device_id ?? '').trim() && !hasSeenDevice) reasons.push('New device not seen before for this user');
    if (userAvg > 0 ? amount >= userAvg * 3 : amount >= 500) reasons.push(userAvg > 0 ? `Amount is ~${Math.round(amount / userAvg)}× higher than user's average` : 'Large transaction for this profile');
    if (prev && String(prev.location ?? '') && String(selectedTx.location ?? '') && String(prev.location) !== String(selectedTx.location) && Math.abs(toMs(selectedTx) - toMs(prev)) <= 600_000)
      reasons.push(`Location changed: ${prev.location} → ${selectedTx.location} within 10 min`);
    const fallback = (selectedTx.reason || '').split(';').map((s) => s.trim()).filter(Boolean).slice(0, 6);
    const merged = [...reasons, ...fallback.filter((s) => !reasons.some((r) => r.toLowerCase() === s.toLowerCase()))].slice(0, 7);
    const rec = actionFromRisk(Number(selectedTx.risk_score ?? 0));
    return {
      reasons: merged.length ? merged : ['No explanation available.'],
      recommended: rec,
      suggested: rec.action === 'BLOCK' ? 'Block (high confidence fraud)' : rec.action === 'REVIEW' ? 'Flag for manual review' : 'Approve (low risk)',
    };
  }, [selectedTx, todayTx]);

  /* ═══════════════════════════ RENDER ═══════════════════════════ */
  return (
    <section className="min-h-screen bg-[#080c14] text-slate-100 font-mono text-xs">

      {ticketToast && (
        <div className="fixed top-4 right-4 z-[60] w-[360px] max-w-[92vw]">
          <div className="rounded-2xl border border-emerald-800/40 bg-[#0d1320] shadow-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold text-emerald-300">Ticket created successfully</p>
                <p className="mt-1 text-[10px] text-slate-500">
                  Case saved to queue · Assigned to <span className="text-slate-300">{ticketToast.assignedTo}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTicketToast(null)}
                className="h-7 w-7 rounded-lg border border-slate-800 text-slate-500 hover:text-slate-300 hover:bg-slate-900/60 transition"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
            <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-[10px]">
              <div className="flex justify-between gap-2">
                <span className="text-slate-600">Ticket ID</span>
                <span className="font-mono text-slate-200">{ticketToast.ticketId}</span>
              </div>
              <div className="flex justify-between gap-2 mt-1">
                <span className="text-slate-600">Tx</span>
                <span className="font-mono text-slate-400">{ticketToast.txId.slice(0, 12)}…</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {confirmBlockOpen && pendingBlock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#0d1320] shadow-2xl">
            <div className="p-5 border-b border-slate-800">
              <p className="text-sm font-semibold text-slate-100">Confirm Block User</p>
              <p className="mt-1 text-[11px] text-slate-500">Future transactions will be blocked immediately.</p>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2 text-[11px]">
                <div className="flex justify-between"><span className="text-slate-500">User ID</span><span className="font-mono text-slate-100">{pendingBlock.user_id}</span></div>
                <div><span className="text-slate-500">Reason</span><p className="mt-1 text-slate-300">{pendingBlock.reason}</p></div>
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => { setConfirmBlockOpen(false); setPendingBlock(null); }} className="h-9 rounded-lg border border-slate-700 bg-slate-900 px-4 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition">Cancel</button>
                <button type="button" onClick={confirmBlock} className="h-9 rounded-lg bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-500 transition">Confirm Block</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmUnblockOpen && pendingUnblockUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#0d1320] shadow-2xl">
            <div className="p-5 border-b border-slate-800">
              <p className="text-sm font-semibold text-slate-100">Confirm Unblock User</p>
              <p className="mt-1 text-[11px] text-slate-500">User will be able to transact again.</p>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">User ID</span>
                  <span className="font-mono text-slate-100">{pendingUnblockUserId}</span>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => { setConfirmUnblockOpen(false); setPendingUnblockUserId(null); }}
                  className="h-9 rounded-lg border border-slate-700 bg-slate-900 px-4 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmUnblock}
                  className="h-9 rounded-lg bg-emerald-700 px-4 text-xs font-semibold text-white hover:bg-emerald-600 transition"
                >
                  Confirm Unblock
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          ROW 1 — Header bar
      ════════════════════════════════════════════════════════ */}
      <div className="border-b border-slate-800/80 bg-[#0a0f1a]/90 backdrop-blur-md sticky top-0 z-30">
        <div className="px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="h-2 w-2 rounded-full bg-rose-400 animate-pulse" />
            <span className="text-sm font-semibold text-slate-100">Police Console</span>
            <span className="text-slate-700 hidden sm:block">·</span>
            <span className="text-[11px] text-slate-600 hidden sm:block">Privacy-first</span>
            {insight.spike && <span className={`${pill('rose')} ml-1`}>🚨 Spike</span>}
          </div>

          {/* KPI pills — center */}
          <div className="hidden lg:flex items-center gap-1 flex-1 justify-center">
            {[
              { label: 'Total', value: summary.total, c: 'text-slate-300', fn: () => setDecisionFilter('ALL') },
              { label: 'Approved', value: summary.approvedCount, c: 'text-emerald-300', fn: () => setDecisionFilter('APPROVE') },
              { label: 'Flagged', value: summary.flaggedCount, c: 'text-amber-300', fn: () => setDecisionFilter('FLAG') },
              { label: 'Blocked', value: summary.blockedCount, c: 'text-rose-300', fn: () => setDecisionFilter('BLOCK') },
              { label: 'High Risk', value: summary.highRisk, c: 'text-rose-400', fn: () => { setMinRisk(0.8); setDecisionFilter('ALL'); } },
            ].map((k) => (
              <button key={k.label} type="button" onClick={k.fn} className="flex items-center gap-1.5 h-7 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 hover:bg-slate-800 transition">
                <span className="text-[10px] text-slate-600">{k.label}</span>
                <span className={`font-bold text-sm ${k.c}`}>{k.value}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto shrink-0">
            <div className="hidden sm:flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900/50 p-1">
              <button
                type="button"
                onClick={() => setPoliceView('CONSOLE')}
                className={`h-7 rounded-lg px-3 text-[11px] font-semibold transition ${
                  policeView === 'CONSOLE' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                Console
              </button>
              <button
                type="button"
                onClick={() => setPoliceView('TICKETS')}
                className={`h-7 rounded-lg px-3 text-[11px] font-semibold transition ${
                  policeView === 'TICKETS' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                Tickets
              </button>
            </div>
            <input className="h-8 w-36 rounded-lg border border-slate-700/80 bg-slate-950/70 px-2.5 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-sky-500/60 hidden sm:block" value={policeKey} onChange={(e) => setPoliceKey(e.target.value)} placeholder="X-Police-Key" />
            <button type="button" onClick={refresh} disabled={isLoading} className="h-8 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50 transition">{isLoading ? '↻…' : '↻ Refresh'}</button>
            <button type="button" onClick={resetFilters} className="h-8 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-400 hover:bg-slate-800 transition">Reset</button>
          </div>
        </div>
        {error && <p className="px-6 pb-2 text-[11px] text-amber-400">{error}</p>}
      </div>

      <div className="px-6 py-5 space-y-5">

        {policeView === 'TICKETS' && (
          <div className="grid grid-cols-1 lg:grid-cols-10 gap-4 items-start">
            <div className="lg:col-span-6 space-y-3">
              <div className={`${card} p-4`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-200">🎫 Ticket Queue</p>
                    <p className="text-[10px] text-slate-600">Track unresolved cases and escalate.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      className="h-8 rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 text-xs text-slate-200"
                      value={ticketStatusFilter}
                      onChange={(e) => setTicketStatusFilter(e.target.value as any)}
                    >
                      <option value="OPEN">OPEN</option>
                      <option value="IN_PROGRESS">IN_PROGRESS</option>
                      <option value="RESOLVED">RESOLVED</option>
                      <option value="ALL">ALL</option>
                    </select>
                    <button
                      type="button"
                      onClick={refreshTickets}
                      className="h-8 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-300 hover:bg-slate-800 transition"
                    >
                      {isTicketsLoading ? 'Loading…' : 'Refresh'}
                    </button>
                  </div>
                </div>
              </div>

              <div className={`${card} overflow-hidden`}>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-slate-900/80 border-b border-slate-800">
                      <tr>
                        {['Ticket', 'Status', 'Priority', 'Assigned', 'Tx', 'Updated'].map((h) => (
                          <th key={h} className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wider text-slate-600 font-semibold whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {tickets.map((t) => (
                        <tr
                          key={t.ticket_id}
                          className="cursor-pointer hover:bg-slate-900/60 transition"
                          onClick={async () => {
                            setPoliceView('CONSOLE');
                            setSelectedTxId(String(t.tx_id));
                            await loadRelatedTrail(String(t.tx_id));
                          }}
                        >
                          <td className="px-3 py-2 font-mono text-slate-200">{t.ticket_id}</td>
                          <td className="px-3 py-2">
                            <span className={pill(t.status === 'RESOLVED' ? 'emerald' : t.status === 'IN_PROGRESS' ? 'amber' : 'rose')}>{t.status}</span>
                          </td>
                          <td className="px-3 py-2">
                            <span className={pill(t.priority === 'CRITICAL' ? 'rose' : t.priority === 'HIGH' ? 'amber' : t.priority === 'MEDIUM' ? 'sky' : 'slate')}>{t.priority}</span>
                          </td>
                          <td className="px-3 py-2 text-slate-300">{t.assigned_to}</td>
                          <td className="px-3 py-2 font-mono text-slate-500">{String(t.tx_id).slice(0, 10)}…</td>
                          <td className="px-3 py-2 text-[10px] text-slate-600 whitespace-nowrap">{new Date(t.updated_at).toLocaleString(undefined, { hour12: false })}</td>
                        </tr>
                      ))}
                      {!tickets.length && (
                        <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-700">No tickets found.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="lg:col-span-4 space-y-3">
              <div className={`${card} p-4`}>
                <p className="text-xs font-semibold text-slate-200">🔗 Blockchain-linked trail</p>
                <p className="text-[10px] text-slate-600 mt-0.5">Select a ticket to load related transactions.</p>
              </div>
              <div className={`${card} p-4`}>
                {isTrailLoading ? (
                  <p className="text-[11px] text-slate-600">Loading trail…</p>
                ) : relatedTrail ? (
                  <div className="space-y-2">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-[10px] text-slate-600">
                      <p className="font-semibold text-slate-300 mb-1">Links used</p>
                      <p>User: <span className="font-mono text-slate-400">{relatedTrail.links.user_id ?? '—'}</span></p>
                      <p>Device: <span className="font-mono text-slate-400">{relatedTrail.links.device_id ?? '—'}</span></p>
                      <p>Ledger: <span className="font-mono text-slate-500">{(relatedTrail.links.ledger_hash ?? '—').slice(0, 18)}…</span></p>
                    </div>
                    <div className="text-[10px] text-slate-600">Related transactions (today): <span className="text-slate-300 font-semibold">{relatedTrail.related.length}</span></div>
                    <div className="max-h-[420px] overflow-y-auto space-y-2">
                      {relatedTrail.related.map((rt: any) => (
                        <button
                          key={String(rt.tx_id)}
                          type="button"
                          onClick={() => setSelectedTxId(String(rt.tx_id))}
                          className="w-full text-left rounded-xl border border-slate-800 bg-slate-950/30 p-2 hover:bg-slate-900/60 transition"
                        >
                          <div className="flex justify-between text-[10px]">
                            <span className="font-mono text-slate-300">{String(rt.user_id ?? '—')}</span>
                            <span className="font-mono text-slate-500">{new Date(rt.created_at ?? new Date()).toLocaleTimeString(undefined, { hour12: false })}</span>
                          </div>
                          <div className="flex justify-between mt-1 text-[10px] text-slate-600">
                            <span>{formatRm(Number(rt.amount ?? 0))} · {String(rt.location ?? '—')}</span>
                            <span className={pill(rt.decision === 'BLOCK' ? 'rose' : rt.decision === 'FLAG' ? 'amber' : 'emerald')}>{rt.decision}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-700">No trail loaded yet.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {policeView === 'CONSOLE' && (
        <>
        {/* ════════════════════════════════════════════════════════
            ROW 2 — Insight strip
        ════════════════════════════════════════════════════════ */}
        <div className={`${card} px-5 py-3 flex items-center gap-2 flex-wrap`}>
          <span className="text-[10px] uppercase tracking-widest text-slate-600 pr-3 border-r border-slate-800">Last 10 min</span>

          <div className="flex items-center gap-2 px-4 border-r border-slate-800">
            <span className="text-[11px] text-slate-500">High-risk attempts</span>
            <span className={`font-bold text-base tabular-nums ${insight.last10mHighCount ? 'text-rose-300' : 'text-slate-400'}`}>{insight.last10mHighCount}</span>
          </div>

          <div className="flex items-center gap-2 px-4 border-r border-slate-800">
            <span className="text-[11px] text-slate-500">Potential loss</span>
            <span className="font-bold text-base text-amber-300 tabular-nums">{formatRm(insight.potentialLossPrevented)}</span>
          </div>

          <div className="flex items-center gap-2 px-4 border-r border-slate-800">
            <span className="text-[11px] text-slate-500">Repeat suspects</span>
            <span className={`font-bold text-base tabular-nums ${insight.repeatSuspiciousUsers ? 'text-rose-300' : 'text-slate-400'}`}>{insight.repeatSuspiciousUsers}</span>
          </div>

          <div className="flex items-center gap-2 px-4">
            <span className="text-[11px] text-slate-500">vs prev hour</span>
            <span className={`font-bold text-base tabular-nums ${insight.highTrendPct >= 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
              {insight.highTrendPct >= 0 ? '↑' : '↓'}{Math.abs(insight.highTrendPct).toFixed(0)}%
            </span>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════
            ROW 3 — 3 equal cards: Alerts | Block | Blocked
        ════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* Alerts */}
          <div className={`${card} flex flex-col`} style={{ maxHeight: 380 }}>
            <div className="px-4 py-3 border-b border-rose-900/40 bg-rose-950/20 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
                <span className="text-xs font-semibold text-rose-200">Live Alerts</span>
                {liveAlerts.length > 0 && <span className={pill('rose')}>{liveAlerts.length}</span>}
              </div>
              <span className="text-[10px] text-rose-400/60">risk ≥ 0.80</span>
            </div>
            <div ref={liveListRef} className="divide-y divide-slate-800/50 overflow-y-auto flex-1">
              {liveAlerts.length === 0 && (
                <div className="px-4 py-10 text-center text-[11px] text-slate-700">No high-risk alerts right now.</div>
              )}
              {liveAlerts.map((t) => (
                <div key={t.tx_id} className={`p-3 transition-colors ${String(selectedTxId) === String(t.tx_id) ? 'bg-rose-950/40' : recentAlertTxIds.has(String(t.tx_id)) ? 'bg-rose-900/20' : 'hover:bg-slate-900/60'}`}>
                  <button type="button" onClick={() => { setSelectedTxId(String(t.tx_id)); setBlockUserId(String(t.user_id)); setBlockReason(t.reason ?? 'High risk activity'); }} className="w-full text-left">
                    <div className="flex justify-between gap-2">
                      <span className="font-mono text-slate-200">{t.user_id}</span>
                      <span className="font-mono text-rose-300">{Number(t.risk_score ?? 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between gap-2 mt-0.5">
                      <span className="text-slate-500">{formatRm(Number(t.amount ?? 0))}</span>
                      <span className={actionFromRisk(Number(t.risk_score ?? 0)).color}>{actionFromRisk(Number(t.risk_score ?? 0)).action}</span>
                    </div>
                    <div className="mt-0.5 flex justify-between gap-2 text-[10px]">
                      <span className="text-slate-700 truncate" title={t.location ?? ''}>{t.location || '—'}</span>
                      {blockedSet.has(String(t.user_id)) && <span className="text-emerald-300">Blocked user attempt</span>}
                    </div>
                    {t.reason && <p className="mt-1 text-[10px] text-slate-600 line-clamp-2">{t.reason}</p>}
                  </button>
                  <div className="mt-2 flex gap-1.5">
                    {!blockedSet.has(String(t.user_id)) && (
                      <button type="button" onClick={() => openBlockConfirm(String(t.user_id), t.reason ?? 'High risk')} className="flex-1 h-6 rounded-lg bg-rose-700/60 text-[10px] font-semibold text-rose-100 hover:bg-rose-600 transition">Block</button>
                    )}
                    <button type="button" onClick={() => setSelectedTxId(String(t.tx_id))} className="flex-1 h-6 rounded-lg border border-slate-700 bg-slate-900/50 text-[10px] text-slate-300 hover:bg-slate-800 transition">Review</button>
                    <button type="button" onClick={() => setDismissedAlertIds((p) => { const n = new Set(p); n.add(String(t.tx_id)); return n; })} className="h-6 w-7 rounded-lg border border-slate-800 text-slate-600 hover:text-slate-400 hover:bg-slate-800 transition text-center leading-none">✕</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Block user */}
          <div className={`${card} p-4 flex flex-col gap-3`}>
            <div>
              <p className="text-xs font-semibold text-slate-200">⛔ Block User</p>
              <p className="text-[10px] text-slate-600 mt-0.5">Takes effect immediately on all future transactions.</p>
            </div>
            {lastBlockImpact && Date.now() - lastBlockImpact.at <= 60_000 && (
              <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-3 space-y-0.5">
                <p className="font-semibold text-emerald-300 text-[11px]">✔ Blocked {lastBlockImpact.user_id}</p>
                <p className="text-[10px] text-slate-500">~{lastBlockImpact.preventedTx} tx prevented · Savings: {formatRm(lastBlockImpact.estimatedSavings)}</p>
              </div>
            )}
            <div className="space-y-2 flex-1">
              <div>
                <label className={labelCls}>User ID</label>
                <input className={inputCls} value={blockUserId} onChange={(e) => setBlockUserId(e.target.value)} placeholder="e.g. user_001" />
              </div>
              <div>
                <label className={labelCls}>Reason</label>
                <input className={inputCls} value={blockReason} onChange={(e) => setBlockReason(e.target.value)} />
              </div>
            </div>
            <button type="button" onClick={() => openBlockConfirm(blockUserId.trim(), blockReason)} disabled={!blockUserId.trim()} className="w-full h-9 rounded-xl bg-rose-600 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-40 transition">
              Block User
            </button>
          </div>

          {/* Blocked list */}
          <div className={`${card} flex flex-col`} style={{ maxHeight: 380 }}>
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between shrink-0">
              <span className="text-xs font-semibold text-slate-200">🔒 Blocked Users</span>
              <span className={pill('rose')}>{blocked.length}</span>
            </div>
            <div className="divide-y divide-slate-800/50 overflow-y-auto flex-1">
              {blocked.length === 0 && <div className="px-4 py-10 text-center text-[11px] text-slate-700">No blocked users yet.</div>}
              {blocked.map((b) => (
                <div key={b.user_id} className="px-4 py-3">
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-mono text-slate-200">{b.user_id}</span>
                    <span className="text-[10px] text-slate-600 shrink-0 whitespace-nowrap">
                      {new Date(b.blocked_at).toLocaleString(undefined, { hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-slate-500 line-clamp-2">{b.reason}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setBlockUserId(String(b.user_id)); setBlockReason(b.reason); setError(`User ${b.user_id} is already blocked.`); }}
                      className="h-6 flex-1 rounded-lg border border-slate-800 bg-slate-950/30 text-[10px] text-slate-400 hover:bg-slate-900/50 transition"
                      title="Already blocked"
                    >
                      Already blocked
                    </button>
                    <button
                      type="button"
                      onClick={() => { setPendingUnblockUserId(String(b.user_id)); setConfirmUnblockOpen(true); }}
                      className="h-6 rounded-lg bg-emerald-700/70 px-2.5 text-[10px] font-semibold text-white hover:bg-emerald-600 transition"
                    >
                      Unblock
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* ════════════════════════════════════════════════════════
            ROW 4 — 70 / 30 split: Filters+Table  |  Investigation
        ════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-10 gap-4 items-start">

          {/* LEFT 70% */}
          <div className="lg:col-span-7 space-y-4">

            {/* Filters */}
            <div className={`${card} p-4 space-y-3`}>
              <div className="flex gap-2">
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search user / device / merchant / tx…" className={`${inputCls} flex-1`} />
                <button type="button" onClick={() => setShowFilters((v) => !v)} className={`h-8 shrink-0 rounded-lg border px-3 text-xs font-medium transition ${showFilters ? 'border-sky-600 bg-sky-950/40 text-sky-300' : 'border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800'}`}>
                  {showFilters ? '▲ Less' : '▼ Filters'}
                </button>
              </div>

              {showFilters && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
                  <div><label className={labelCls}>Preset</label>
                    <select value={preset} onChange={(e) => setPreset(e.target.value as any)} className={inputCls}>
                      <option value="CUSTOM">Custom</option><option value="HIGH_RISK">High risk ≥ 0.80</option>
                      <option value="LARGE_TX">Large tx ≥ 500</option><option value="NEW_DEVICES">New devices</option>
                    </select>
                  </div>
                  <div><label className={labelCls}>Decision</label>
                    <select value={decisionFilter} onChange={(e) => setDecisionFilter(e.target.value as any)} className={inputCls}>
                      <option value="ALL">All</option><option value="APPROVE">Approve</option><option value="FLAG">Flag</option><option value="BLOCK">Block</option>
                    </select>
                  </div>
                  <div><label className={labelCls}>User ID</label><input value={userIdFilter} onChange={(e) => setUserIdFilter(e.target.value)} placeholder="user_001" className={inputCls} /></div>
                  <div><label className={labelCls}>Merchant</label><input value={merchantFilter} onChange={(e) => setMerchantFilter(e.target.value)} placeholder="Merchant123" className={inputCls} /></div>
                  <div><label className={labelCls}>Amount min</label><input value={amountMin} onChange={(e) => setAmountMin(e.target.value)} placeholder="50" className={inputCls} /></div>
                  <div><label className={labelCls}>Amount max</label><input value={amountMax} onChange={(e) => setAmountMax(e.target.value)} placeholder="2000" className={inputCls} /></div>
                  <div className="col-span-2">
                    <label className={labelCls}>Min risk: <span className="text-sky-400 normal-case">{minRisk.toFixed(2)}</span></label>
                    <input type="range" min={0} max={1} step={0.01} value={clamp01(minRisk)} onChange={(e) => setMinRisk(clamp01(Number(e.target.value)))} className="w-full accent-sky-500 mt-1" />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-slate-700 mr-1">Quick</span>
                {[
                  { label: 'All', fn: resetFilters },
                  { label: 'Blocked', fn: () => setDecisionFilter('BLOCK') },
                  { label: 'Flagged', fn: () => setDecisionFilter('FLAG') },
                  { label: 'High risk ≥ 0.80', fn: () => { setMinRisk(0.8); setDecisionFilter('ALL'); } },
                ].map((b) => (
                  <button key={b.label} type="button" onClick={b.fn} className="h-6 rounded-lg border border-slate-700 bg-slate-900/50 px-2.5 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition">{b.label}</button>
                ))}
                <span className="ml-auto text-[10px] text-slate-600">{filteredTx.length} matches</span>
              </div>
            </div>

            {/* Table */}
            <div className={`${card} overflow-hidden`}>
              <div className="px-4 py-3 border-b border-slate-800 flex justify-between items-center">
                <div>
                  <p className="text-xs font-semibold text-slate-200">Today's Transactions</p>
                  <p className="text-[10px] text-slate-600">Click row → investigate in panel</p>
                </div>
                <p className="text-[10px] text-slate-600">{pagedTx.length}/{filteredTx.length} · pg {page}/{pageCount}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-slate-900/80 border-b border-slate-800">
                    <tr>
                      {['Time', 'User', 'Amount', 'Merchant', 'Decision', 'Risk', 'Reason'].map((h) => (
                        <th key={h} className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wider text-slate-600 font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {pagedTx.map((t) => {
                      const sel = String(selectedTxId) === String(t.tx_id);
                      return (
                        <tr key={String(t.tx_id)} onClick={() => setSelectedTxId(String(t.tx_id))}
                          className={`cursor-pointer transition-colors ${sel ? 'bg-sky-950/30 ring-1 ring-inset ring-sky-700/40' : t.decision === 'BLOCK' ? 'bg-rose-950/10 hover:bg-rose-950/20' : t.decision === 'FLAG' ? 'bg-amber-950/8 hover:bg-amber-950/15' : 'hover:bg-slate-800/30'}`}>
                          <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{new Date(t.created_at ?? t.timestamp ?? new Date()).toLocaleTimeString(undefined, { hour12: false })}</td>
                          <td className="px-3 py-2 font-mono text-slate-200 whitespace-nowrap">{t.user_id}</td>
                          <td className="px-3 py-2 font-semibold text-slate-100 whitespace-nowrap">{formatRm(Number(t.amount ?? 0))}</td>
                          <td className="px-3 py-2 text-slate-400 max-w-[130px] truncate" title={t.merchant_id}>{t.merchant_id}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={pill(t.decision === 'BLOCK' ? 'rose' : t.decision === 'FLAG' ? 'amber' : 'emerald')}>{t.decision}</span>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <div className="w-10 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                                <div className={`h-full rounded-full ${Number(t.risk_score ?? 0) >= 0.8 ? 'bg-rose-500' : Number(t.risk_score ?? 0) >= 0.6 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                  style={{ width: `${Number(t.risk_score ?? 0) * 100}%` }} />
                              </div>
                              <span className="font-mono text-slate-300">{Number(t.risk_score ?? 0).toFixed(2)}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 max-w-[180px] truncate text-[10px] text-slate-500" title={t.reason ?? ''}>{t.reason || <span className="text-slate-700">—</span>}</td>
                        </tr>
                      );
                    })}
                    {filteredTx.length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-12 text-center text-slate-700">No transactions match filters.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 border-t border-slate-800 flex justify-between items-center">
                <p className="text-[10px] text-slate-700">Tip: <span className="text-slate-500">min risk = 0.80</span> to triage faster</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="h-7 rounded-lg border border-slate-700 bg-slate-900 px-3 text-[10px] text-slate-400 hover:bg-slate-800 disabled:opacity-30 transition">← Prev</button>
                  <button type="button" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount} className="h-7 rounded-lg border border-slate-700 bg-slate-900 px-3 text-[10px] text-slate-400 hover:bg-slate-800 disabled:opacity-30 transition">Next →</button>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT 30% — Investigation panel */}
          <div className="lg:col-span-3 lg:sticky lg:top-[57px]">
            <div className={`${card} overflow-hidden`}>
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-200">Investigation</p>
                  <p className="text-[10px] text-slate-600">{selectedTx ? `Case #${String(selectedTx.tx_id).slice(0, 12)}…` : 'Select a row'}</p>
                </div>
                {selectedTx && (
                  <button type="button" onClick={() => openBlockConfirm(String(selectedTx.user_id), selectedTx.reason || 'High risk')}
                    className="h-7 rounded-lg bg-rose-700 px-2.5 text-[10px] font-semibold text-white hover:bg-rose-600 transition">⛔ Block</button>
                )}
              </div>

              {!selectedTx ? (
                <div className="px-4 py-16 text-center">
                  <p className="text-2xl mb-2">🔍</p>
                  <p className="text-[11px] text-slate-700">Click any transaction<br />to view details</p>
                </div>
              ) : (
                <div className="p-4 space-y-3 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 180px)' }}>

                  {/* Identity */}
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-[10px] uppercase tracking-widest text-slate-600 mb-2">Identity</p>
                    <div className="space-y-1.5">
                      {[{ l: 'User', v: selectedTx.user_id }, { l: 'Device', v: selectedTx.device_id }, { l: 'Location', v: selectedTx.location }].map((r) => (
                        <div key={r.l} className="flex justify-between gap-2 text-[11px]">
                          <span className="text-slate-500 shrink-0">{r.l}</span>
                          <span className="font-mono text-slate-300 truncate text-right" title={r.v}>{r.v}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Decision */}
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-[10px] uppercase tracking-widest text-slate-600 mb-2">Transaction</p>
                    <div className="space-y-1.5 text-[11px]">
                      <div className="flex justify-between"><span className="text-slate-500">Amount</span><span className="font-mono text-slate-100 font-bold">{formatRm(Number(selectedTx.amount ?? 0))}</span></div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Risk</span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-slate-200">{Number(selectedTx.risk_score ?? 0).toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Decision</span>
                        <span className={pill(selectedTx.decision === 'BLOCK' ? 'rose' : selectedTx.decision === 'FLAG' ? 'amber' : 'emerald')}>{selectedTx.decision}</span>
                      </div>
                      <div className="flex justify-between"><span className="text-slate-500">Merchant</span><span className="font-mono text-slate-300 truncate max-w-[140px]" title={selectedTx.merchant_id}>{selectedTx.merchant_id}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Latency</span><span className="font-mono text-slate-400">{Number(selectedTx.latency_ms ?? 0).toFixed(1)} ms</span></div>
                    </div>
                  </div>

                  {/* Blockchain proof */}
                  {(selectedTx.ledger_hash || selectedTx.registry_tx_hash) && (
                    <div className="rounded-xl border border-emerald-900/20 bg-emerald-950/10 p-3 space-y-1.5">
                      <p className="text-[10px] uppercase tracking-widest text-emerald-500/80">Blockchain proof</p>
                      {(typeof selectedTx.ledger_index === 'number' || selectedTx.ledger_prev_hash) && (
                        <p className="text-[10px] text-slate-600">
                          {typeof selectedTx.ledger_index === 'number' ? (
                            <>Block <span className="font-mono text-slate-400">#{selectedTx.ledger_index}</span></>
                          ) : (
                            <>Ledger block</>
                          )}
                        </p>
                      )}
                      {selectedTx.ledger_hash && (
                        <div className="flex items-center justify-between gap-2 text-[10px]">
                          <span className="text-slate-600">Ledger hash</span>
                          <span className="font-mono text-slate-300 truncate max-w-[220px]" title={selectedTx.ledger_hash}>
                            {selectedTx.ledger_hash}
                          </span>
                        </div>
                      )}
                      {selectedTx.registry_tx_hash && (
                        <div className="flex items-center justify-between gap-2 text-[10px]">
                          <span className="text-slate-600">Registry tx hash</span>
                          <span
                            className="font-mono text-slate-300 truncate max-w-[220px]"
                            title={selectedTx.registry_tx_hash}
                          >
                            {selectedTx.registry_tx_hash}
                          </span>
                        </div>
                      )}
                      <p className="text-[10px] text-slate-700">Stored even for blocked attempts (audit trail).</p>
                    </div>
                  )}

                  {/* AI Explanation */}
                  <div className="rounded-xl border border-sky-900/30 bg-sky-950/10 p-3 space-y-2">
                    <p className="text-[10px] uppercase tracking-widest text-sky-600">AI Explanation</p>
                    {xaiForTx && <p className="text-[10px] text-slate-500">→ <span className="text-slate-300">{xaiForTx.suggested}</span></p>}
                    <ul className="space-y-1.5">
                      {(xaiForTx?.reasons ?? ['—']).map((r, i) => (
                        <li key={i} className="flex gap-2 text-[11px] text-slate-300">
                          <span className="mt-1 h-1.5 w-1.5 rounded-full bg-sky-500 shrink-0" />
                          {r}
                        </li>
                      ))}
                    </ul>
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-600 mb-1"><span>Confidence</span><span className="font-mono">{Number(selectedTx.risk_score ?? 0).toFixed(2)}</span></div>
                      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div className="h-full bg-sky-500 rounded-full transition-all" style={{ width: `${Number(selectedTx.risk_score ?? 0) * 100}%` }} />
                      </div>
                    </div>
                  </div>

                  {/* Case Workflow */}
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 space-y-2">
                    <p className="text-[10px] uppercase tracking-widest text-slate-600">Case Workflow</p>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-2 text-[10px] text-slate-600">
                      <div className="flex justify-between gap-2">
                        <span>Case</span>
                        <span className="font-mono text-slate-400">#{String(selectedTx.tx_id).slice(0, 10)}…</span>
                      </div>
                      {caseByTxId[String(selectedTx.tx_id)]?.ticketId ? (
                        <div className="flex justify-between gap-2 mt-1">
                          <span>Ticket</span>
                          <span className="font-mono text-emerald-300">{caseByTxId[String(selectedTx.tx_id)]?.ticketId}</span>
                        </div>
                      ) : (
                        <div className="mt-1">No ticket yet — assign + submit to create.</div>
                      )}
                    </div>
                    <div>
                      <label className={labelCls}>Status</label>
                      <select className={inputCls} value={caseByTxId[String(selectedTx.tx_id)]?.status ?? 'Pending'}
                        onChange={(e) => setCaseByTxId((p) => ({ ...p, [String(selectedTx.tx_id)]: { ...p[String(selectedTx.tx_id)], status: e.target.value as any, updatedAt: Date.now() } }))}>
                        <option>Pending</option><option>Under Investigation</option><option>Resolved</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Assigned to</label>
                      <input className={inputCls} placeholder="Officer A" value={caseByTxId[String(selectedTx.tx_id)]?.assignedTo ?? ''}
                        onChange={(e) => setCaseByTxId((p) => ({ ...p, [String(selectedTx.tx_id)]: { ...p[String(selectedTx.tx_id)], assignedTo: e.target.value, updatedAt: Date.now() } }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Notes</label>
                      <input className={inputCls} placeholder="Evidence / actions taken…" value={caseByTxId[String(selectedTx.tx_id)]?.notes ?? ''}
                        onChange={(e) => setCaseByTxId((p) => ({ ...p, [String(selectedTx.tx_id)]: { ...p[String(selectedTx.tx_id)], notes: e.target.value, updatedAt: Date.now() } }))} />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={submitCaseTicket}
                        className="flex-1 h-8 rounded-lg bg-sky-600 text-xs font-semibold text-white hover:bg-sky-500 transition"
                        title="Create an investigation ticket"
                      >
                        {caseByTxId[String(selectedTx.tx_id)]?.ticketId ? 'View ticket toast' : 'Submit → Create Ticket'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setCaseByTxId((p) => {
                            const key = String(selectedTx.tx_id);
                            const next = { ...p };
                            delete next[key];
                            return next;
                          })
                        }
                        className="h-8 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-400 hover:bg-slate-800 transition"
                        title="Clear local case fields"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {/* Intelligence */}
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 space-y-2">
                    <p className="text-[10px] uppercase tracking-widest text-slate-600">Fraud Intelligence</p>
                    <div>
                      <p className="text-[10px] text-slate-500 mb-1">Detected Patterns</p>
                      {intelligence.patterns.length ? intelligence.patterns.map((p, i) => (
                        <div key={i} className="rounded-lg border border-amber-900/30 bg-amber-950/10 p-2 mb-1 text-[10px]">
                          <p className="text-amber-300">{p.label}</p>
                          <p className="text-slate-500 mt-0.5">Users: <span className="font-mono text-slate-400">{p.users.join(', ')}</span></p>
                        </div>
                      )) : <p className="text-[10px] text-slate-700">No pattern detected today.</p>}
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 mb-1">Shared Device Clusters</p>
                      {intelligence.linked.length ? intelligence.linked.map((l) => (
                        <div key={l.device_id} className="rounded-lg border border-rose-900/30 bg-rose-950/10 p-2 mb-1 text-[10px]">
                          <p className="text-slate-500">Device: <span className="font-mono text-rose-300">{l.device_id}</span></p>
                          <p className="text-slate-400 mt-0.5">Users: <span className="font-mono">{l.users.join(', ')}</span></p>
                        </div>
                      )) : <p className="text-[10px] text-slate-700">No shared-device clusters.</p>}
                    </div>
                  </div>

                </div>
              )}
            </div>
          </div>

        </div>

        {/* ════════════════════════════════════════════════════════
            ROW 5 — Graph (full width)
        ════════════════════════════════════════════════════════ */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-semibold text-slate-200">Risk Score Distribution</p>
              <p className="text-[10px] text-slate-600 mt-0.5">0.0 (low) → 1.0 (high) · threshold at 0.80</p>
            </div>
            <div className="flex gap-4">
              <span className="flex items-center gap-1.5 text-[11px]"><span className="h-2 w-2 rounded-full bg-rose-500" />High <strong className="text-rose-300">{riskBands.high}</strong></span>
              <span className="flex items-center gap-1.5 text-[11px]"><span className="h-2 w-2 rounded-full bg-amber-500" />Med <strong className="text-amber-300">{riskBands.medium}</strong></span>
              <span className="flex items-center gap-1.5 text-[11px]"><span className="h-2 w-2 rounded-full bg-emerald-500" />Low <strong className="text-emerald-300">{riskBands.low}</strong></span>
            </div>
          </div>
          {/* Zone bar */}
          <div className="h-1.5 rounded-full overflow-hidden flex mb-4">
            <div className="bg-emerald-600/40" style={{ width: '30%' }} />
            <div className="bg-amber-500/40" style={{ width: '50%' }} />
            <div className="bg-rose-600/50" style={{ width: '20%' }} />
          </div>
          <div className="relative">
            <RiskCharts riskBuckets={riskBuckets} />
            <div className="pointer-events-none absolute top-0 bottom-5 w-px bg-rose-500/60" style={{ left: '80%' }} />
            <p className="absolute top-0 text-[10px] text-rose-400/70 -translate-x-1/2 px-1 bg-slate-900/80" style={{ left: '80%' }}>0.80</p>
          </div>
        </div>

        </>
        )}
      </div>
    </section>
  );
};