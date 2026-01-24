/**
 * JobsWindow - Terminal window wrapper for Jobs functionality
 *
 * Displays scheduled jobs, market events, and run history.
 */

import { Jobs } from '@/pages/Jobs';

export function JobsWindow() {
  return (
    <div style={{ height: '100%', overflow: 'auto', background: '#0a0a0a' }}>
      <Jobs hideLeftNav />
    </div>
  );
}
