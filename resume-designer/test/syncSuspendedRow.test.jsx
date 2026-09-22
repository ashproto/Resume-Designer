import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SyncSuspendedRow } from '../src/components/settings/SyncSuspendedRow.jsx';

// The desktop's only control over a purge-suspended transport. Pure by design:
// the parent decides `suspended`, and the click is the bridge's resume.
describe('SyncSuspendedRow', () => {
  afterEach(cleanup);

  it('renders nothing while sync is not suspended', () => {
    const { container } = render(<SyncSuspendedRow suspended={false} onResume={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the paused state and resumes on the button', () => {
    const onResume = vi.fn();
    render(<SyncSuspendedRow suspended onResume={onResume} />);
    expect(screen.getByRole('status').textContent).toContain('iCloud sync is paused on this Mac');
    fireEvent.click(screen.getByRole('button', { name: 'Resume syncing' }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});
