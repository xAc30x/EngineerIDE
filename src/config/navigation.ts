import type { NavTab } from '../types';

/** Display names of the sidebar destinations. */
export const NAV_TAB_LABELS: Readonly<Record<NavTab, string>> = {
  chat: 'Chat',
  projects: 'Projects',
  artifacts: 'Artifacts',
  scheduled: 'Scheduled',
  design: 'Design',
};
