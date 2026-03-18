import type { PropsWithChildren } from 'react';

export const PhoneFrame: React.FC<PropsWithChildren<{ title?: string }>> = ({ children, title }) => {
  return (
    <div className="mx-auto w-full max-w-[420px]">
      {title && <div className="mb-2 text-xs font-semibold text-slate-300">{title}</div>}
      <div className="relative rounded-[2.25rem] border border-slate-700/70 bg-slate-950 shadow-2xl">
        <div className="absolute left-1/2 top-3 -translate-x-1/2 h-6 w-28 rounded-full bg-slate-900 border border-slate-800" />
        <div className="p-3 pt-10">
          <div className="rounded-[1.7rem] bg-slate-900/60 border border-slate-800 overflow-hidden">
            <div className="min-h-[620px]">{children}</div>
          </div>
        </div>
      </div>
      <div className="mt-2 flex justify-center gap-2 text-[10px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" /> Approve
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400/70" /> Flag
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-400/70" /> Block
        </span>
      </div>
    </div>
  );
};

