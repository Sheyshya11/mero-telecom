import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataTableControls, DataTablePagination, useTableQueryParams } from './data-table';

function Fixture({ total = 45 }: { total?: number }) {
  const state = useTableQueryParams(['status']);
  return (
    <>
      <DataTableControls
        state={state}
        sorts={['createdAt', 'email']}
        fields={[{ key: 'status', label: 'Status', options: ['ACTIVE', 'SUSPENDED'] }]}
      />
      <DataTablePagination
        state={state}
        meta={{
          page: state.page,
          limit: state.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / state.limit)),
        }}
      />
      <output data-testid="query">{state.query}</output>
    </>
  );
}
describe('URL table controls', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/admin/customers');
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  it('debounces search, updates the URL and resets the page', () => {
    window.history.replaceState(null, '', '/admin/customers?page=3');
    render(<Fixture />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Smith' } });
    expect(window.location.search).toBe('?page=3');
    act(() => vi.advanceTimersByTime(399));
    expect(window.location.search).toBe('?page=3');
    act(() => vi.advanceTimersByTime(1));
    expect(window.location.search).toBe('?search=Smith');
  });
  it('restores URL filters and page size on refresh, and clears them', () => {
    window.history.replaceState(null, '', '/admin/customers?page=2&limit=10&status=ACTIVE');
    render(<Fixture />);
    expect(screen.getByLabelText('Status')).toHaveValue('ACTIVE');
    expect(screen.getByText('Page 2 of 5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all (1)' }));
    expect(window.location.search).toBe('');
  });
  it('resets page for filters and page size', () => {
    window.history.replaceState(null, '', '/admin/customers?page=2');
    render(<Fixture />);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'ACTIVE' } });
    expect(window.location.search).toBe('?status=ACTIVE');
    fireEvent.click(screen.getByText('Next'));
    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '50' } });
    expect(window.location.search).toBe('?status=ACTIVE&limit=50');
  });
  it('disables boundary buttons and permits recovery from an empty final page', () => {
    render(<Fixture total={0} />);
    expect(screen.getByText('Previous')).toBeDisabled();
    expect(screen.getByText('Next')).toBeDisabled();
  });
  it('keeps search focus after debounce and recovers out-of-range bookmarks', () => {
    window.history.replaceState(null, '', '/admin/customers?page=99');
    render(<Fixture />);
    expect(screen.getByText('Showing 0–0 of 45 records')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Last available page'));
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    const search = screen.getByRole('textbox');
    search.focus();
    fireEvent.change(search, { target: { value: 'Smith' } });
    act(() => vi.advanceTimersByTime(400));
    expect(search).toHaveFocus();
    expect(screen.getByRole('textbox')).toBe(search);
  });
  it('responds to browser history navigation without stale pending searches', () => {
    render(<Fixture />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'pending' } });
    act(() => {
      window.history.replaceState(null, '', '/admin/customers?page=2&search=restored');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole('textbox')).toHaveValue('restored');
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(window.location.search).toBe('?page=2&search=restored');
  });
  it('removes individual chips and updates sorting', () => {
    window.history.replaceState(null, '', '/admin/customers?status=ACTIVE');
    render(<Fixture />);
    fireEvent.click(screen.getByLabelText('Remove Status'));
    fireEvent.click(screen.getByRole('button', { name: /more filters & sorting/i }));
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'email' } });
    fireEvent.change(screen.getByLabelText('Order'), { target: { value: 'asc' } });
    expect(window.location.search).toBe('?sortBy=email&sortOrder=asc');
  });

  it('keeps advanced controls explicit and reports the active search', () => {
    window.history.replaceState(null, '', '/admin/customers?search=Taylor');
    render(<Fixture />);
    expect(screen.queryByLabelText('Sort by')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove search' })).toHaveTextContent(
      'Search: Taylor',
    );
    fireEvent.click(screen.getByRole('button', { name: /more filters & sorting/i }));
    expect(screen.getByLabelText('Sort by')).toBeVisible();
    expect(screen.getByRole('button', { name: /hide filters & sorting/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});
