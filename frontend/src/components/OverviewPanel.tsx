import type { OverviewStats } from '../types';

interface Props {
  stats: OverviewStats | null;
}

export const OverviewPanel: React.FC<Props> = ({ stats }) => {
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
      <MetricCard label="Total Transactions" value={stats.total_transactions.toLocaleString()} />
      <MetricCard label="Approved" value={stats.approved.toLocaleString()} accent="approve" />
      <MetricCard label="Flagged" value={stats.flagged.toLocaleString()} accent="flag" />
      <MetricCard label="Blocked" value={stats.blocked.toLocaleString()} accent="block" />
      <MetricCard
        label="Fraud Rate"
        value={`${(stats.fraud_rate * 100).toFixed(2)}%`}
        accent={stats.fraud_rate > 0.01 ? 'block' : 'approve'}
      />
    </div>
  );
};

const MetricCard: React.FC<{ label: string; value: string; accent?: 'approve' | 'flag' | 'block' }> = ({
  label,
  value,
  accent
}) => {
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
    <div className={`rounded-xl border ${border} bg-slate-900/60 px-4 py-3 shadow-sm`}>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
};

const SkeletonCard: React.FC = () => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 animate-pulse">
    <div className="h-3 w-20 bg-slate-700 rounded" />
    <div className="mt-3 h-6 w-16 bg-slate-600 rounded" />
  </div>
);

