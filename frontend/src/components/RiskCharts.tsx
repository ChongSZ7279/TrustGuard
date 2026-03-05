import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend);

interface Props {
  riskBuckets: number[];
}

export const RiskCharts: React.FC<Props> = ({ riskBuckets }) => {
  const labels = riskBuckets.map((_, i) => `${(i / riskBuckets.length).toFixed(1)}–${((i + 1) / riskBuckets.length).toFixed(1)}`);

  const data = {
    labels,
    datasets: [
      {
        label: 'Transactions',
        data: riskBuckets,
        backgroundColor: '#22c55e55',
        borderColor: '#22c55e',
        borderWidth: 1,
        borderRadius: 4
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: '#e5e7eb' }
      },
      tooltip: {
        callbacks: {
          label: (ctx: any) => `${ctx.parsed.y} tx`
        }
      }
    },
    scales: {
      x: {
        ticks: { color: '#9ca3af', maxRotation: 0, minRotation: 0 },
        grid: { display: false }
      },
      y: {
        ticks: { color: '#9ca3af' },
        grid: { color: '#1f2937' }
      }
    }
  } as const;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 h-72">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-200">Risk Score Distribution</h2>
        <span className="text-xs text-slate-500">0.0 (low) → 1.0 (high)</span>
      </div>
      <Bar data={data} options={options} />
    </div>
  );
};

