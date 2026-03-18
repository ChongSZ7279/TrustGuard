import type { Decision } from '../types';

export const decisionClasses: Record<Decision, string> = {
  APPROVE: 'bg-approve/10 text-approve border-approve/40',
  FLAG: 'bg-flag/10 text-flag border-flag/40',
  BLOCK: 'bg-block/10 text-block border-block/40'
};

