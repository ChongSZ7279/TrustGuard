import type { Decision, OverviewStats } from '../types';

interface Props {
  stats: OverviewStats | null;
  activeDecision: Decision | 'ALL';
  onDecisionChange: (value: Decision | 'ALL') => void;
}

export const OverviewPanel: React.FC<Props> = ({ stats, activeDecision, onDecisionChange }) => {
  if (!stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <MetricCard
        label="Total Transactions"
        value={stats.total_transactions.toLocaleString()}
        isActive={activeDecision === 'ALL'}
        onClick={() => onDecisionChange('ALL')}
      />
      <MetricCard
        label="Approved"
        value={stats.approved.toLocaleString()}
        accent="approve"
        isActive={activeDecision === 'APPROVE'}
        onClick={() => onDecisionChange('APPROVE')}
      />
      <MetricCard
        label="Flagged"
        value={stats.flagged.toLocaleString()}
        accent="flag"
        isActive={activeDecision === 'FLAG'}
        onClick={() => onDecisionChange('FLAG')}
      />
      <MetricCard
        label="Blocked"
        value={stats.blocked.toLocaleString()}
        accent="block"
        isActive={activeDecision === 'BLOCK'}
        onClick={() => onDecisionChange('BLOCK')}
      />
      <MetricCard
        label="Fraud Rate"
        value={`${(stats.fraud_rate * 100).toFixed(2)}%`}
        accent={stats.fraud_rate > 0.01 ? 'block' : 'approve'}
      />
    </div>
  );
};

const MetricCard: React.FC<{
  label: string;
  value: string;
  accent?: 'approve' | 'flag' | 'block';
  isActive?: boolean;
  onClick?: () => void;
}> = ({ label, value, accent, isActive, onClick }) => {
  const color =
    accent === 'approve' ? 'text-approve' : accent === 'flag' ? 'text-flag' : accent === 'block' ? 'text-block' : '';
  const border =
    accent === 'approve'
      ? 'border-approve/30'
      : accent === 'flag'
      ? 'border-flag/30'
      : accent === 'block'
      ? 'border-block/30'
      : 'border-slate-700';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border ${border} bg-slate-900/60 px-4 py-3 shadow-sm transition
        ${onClick ? 'hover:bg-slate-800/80 cursor-pointer' : ''}
        ${isActive ? 'border-sky-400/70 ring-1 ring-sky-500/40' : ''}
      `}
    >
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
      {onClick && (
        <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
          {isActive ? 'Filter active' : 'Click to filter'}
        </div>
      )}
    </button>
  );
};

const SkeletonCard: React.FC = () => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 animate-pulse">
    <div className="h-3 w-20 bg-slate-700 rounded" />
    <div className="mt-3 h-6 w-16 bg-slate-600 rounded" />
  </div>
);

