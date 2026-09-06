'use client';

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';

export type FilterField = {
  key: string;
  label: string;
  type?: 'date' | 'number';
  options?: readonly (string | { value: string; label: string })[];
};
export type PageMeta = { page: number; limit: number; total: number; totalPages: number };
const defaults: Record<string, string> = {
  page: '1',
  limit: '20',
  sortBy: 'createdAt',
  sortOrder: 'desc',
};
const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  window.addEventListener('table-query-change', listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener('table-query-change', listener);
  };
};

export function useTableQueryParams(keys: readonly string[], prefix = '') {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => '',
  );
  const params = new URLSearchParams(snapshot);
  const allKeys = ['page', 'limit', 'search', 'sortBy', 'sortOrder', ...keys];
  const values: Record<string, string> = {};
  for (const key of allKeys) values[key] = params.get(prefix + key) ?? defaults[key] ?? '';
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) query.set(key, value);
  const keySignature = allKeys.join(',');
  const update = useCallback(
    (changes: Record<string, string>, resetPage = true) => {
      const next = new URLSearchParams(window.location.search);
      const updates = resetPage ? { ...changes, page: '1' } : changes;
      for (const [key, value] of Object.entries(updates)) {
        if (!value || value === defaults[key]) next.delete(prefix + key);
        else next.set(prefix + key, value);
      }
      const suffix = next.toString();
      const url = window.location.pathname + (suffix ? `?${suffix}` : '') + window.location.hash;
      if (url !== window.location.pathname + window.location.search + window.location.hash) {
        window.history.pushState(null, '', url);
        window.dispatchEvent(new Event('table-query-change'));
      }
    },
    [prefix],
  );
  const clear = useCallback(
    () => update(Object.fromEntries(keySignature.split(',').map((key) => [key, '']))),
    [keySignature, update],
  );
  return {
    values,
    query: query.toString(),
    update,
    clear,
    page: Number(values.page),
    limit: Number(values.limit),
  };
}
export type TableState = ReturnType<typeof useTableQueryParams>;

function DebouncedSearch({
  value,
  onChange,
  placeholder,
  resetKey,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  resetKey: string;
}) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setDraft(value);
    if (timer.current) clearTimeout(timer.current);
  }, [value, resetKey]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <input
      className="field min-w-0 flex-1"
      aria-label="Search"
      placeholder={placeholder}
      value={draft}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => onChange(next.trim()), 400);
      }}
    />
  );
}

export function DataTableControls({
  state,
  fields = [],
  sorts = [],
  placeholder = 'Search records…',
  searchable = true,
  primaryFieldCount = 2,
}: {
  state: TableState;
  fields?: readonly FilterField[];
  sorts?: readonly string[];
  placeholder?: string;
  searchable?: boolean;
  primaryFieldCount?: number;
}) {
  const advancedId = useId();
  const [expanded, setExpanded] = useState(false);
  const activeFields = fields.filter((field) => state.values[field.key]);
  const primaryFields = fields.slice(0, primaryFieldCount);
  const advancedFields = fields.slice(primaryFieldCount);
  const hasAdvancedControls = advancedFields.length > 0 || sorts.length > 0;
  const activeAdvancedCount = advancedFields.filter((field) => state.values[field.key]).length;
  const activeCount = activeFields.length + (searchable && state.values.search ? 1 : 0);

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Search and filters</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Results update automatically as you refine them.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasAdvancedControls ? (
            <button
              aria-controls={advancedId}
              aria-expanded={expanded}
              className="button-secondary justify-center"
              onClick={() => setExpanded((current) => !current)}
              type="button"
            >
              {expanded ? 'Hide' : 'More'} filters &amp; sorting
              {activeAdvancedCount ? ` (${activeAdvancedCount})` : ''}
            </button>
          ) : null}
          {activeCount > 0 ? (
            <button className="button-secondary" type="button" onClick={state.clear}>
              Clear all ({activeCount})
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 xl:items-end">
        {searchable ? (
          <label className="grid min-w-0 gap-1.5 text-sm font-medium text-slate-700 xl:col-span-2">
            Search
            <DebouncedSearch
              resetKey={state.query}
              value={state.values.search}
              onChange={(search) => state.update({ search })}
              placeholder={placeholder}
            />
          </label>
        ) : null}
        {primaryFields.map((field) => (
          <FilterControl field={field} state={state} key={field.key} />
        ))}
      </div>

      {expanded && hasAdvancedControls ? (
        <div
          className="grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-4"
          id={advancedId}
        >
          {advancedFields.map((field) => (
            <FilterControl field={field} state={state} key={field.key} />
          ))}
          {sorts.length ? (
            <label className="grid gap-1 text-sm">
              Sort by
              <select
                className="field"
                value={state.values.sortBy}
                onChange={(event) => state.update({ sortBy: event.target.value })}
              >
                {sorts.map((sort) => (
                  <option key={sort} value={sort}>
                    {humanize(sort)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {sorts.length ? (
            <label className="grid gap-1 text-sm">
              Order
              <select
                className="field"
                value={state.values.sortOrder}
                onChange={(event) => state.update({ sortOrder: event.target.value })}
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      {activeCount > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Active</span>
          {searchable && state.values.search ? (
            <button
              type="button"
              className="rounded-full border border-teal-200 bg-white px-3 py-1 text-xs font-medium text-teal-900"
              onClick={() => state.update({ search: '' })}
              aria-label="Remove search"
            >
              Search: {state.values.search} ×
            </button>
          ) : null}
          {activeFields.map((field) => {
            const option = field.options?.find((option) =>
              typeof option === 'string'
                ? option === state.values[field.key]
                : option.value === state.values[field.key],
            );
            return (
              <button
                key={field.key}
                type="button"
                className="rounded-full border border-teal-200 bg-white px-3 py-1 text-xs font-medium text-teal-900"
                onClick={() => state.update({ [field.key]: '' })}
                aria-label={`Remove ${field.label}`}
              >
                {field.label}:{' '}
                {option && typeof option !== 'string' ? option.label : state.values[field.key]} ×
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function FilterControl({ field, state }: { field: FilterField; state: TableState }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium text-slate-700">
      {field.label}
      {field.options ? (
        <select
          className="field"
          value={state.values[field.key]}
          onChange={(event) => state.update({ [field.key]: event.target.value })}
        >
          <option value="">{allOptionsLabel(field.label)}</option>
          {field.options.map((option) => {
            const value = typeof option === 'string' ? option : option.value;
            return (
              <option key={value} value={value}>
                {typeof option === 'string' ? humanize(option) : option.label}
              </option>
            );
          })}
        </select>
      ) : (
        <input
          aria-label={field.label}
          className="field"
          type={field.type ?? 'text'}
          min={field.type === 'number' ? 0 : undefined}
          value={state.values[field.key]}
          onChange={(event) => state.update({ [field.key]: event.target.value })}
        />
      )}
    </label>
  );
}

function humanize(value: string) {
  const words = value
    .replaceAll('_', ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function allOptionsLabel(label: string) {
  const normalized = label.toLowerCase();
  return `All ${normalized}${normalized.endsWith('status') ? 'es' : normalized.endsWith('s') ? '' : 's'}`;
}

export function DataTablePagination({
  state,
  meta,
  busy,
  noun = 'records',
}: {
  state: TableState;
  meta?: PageMeta;
  busy?: boolean;
  noun?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-4 text-sm text-slate-600">
      <span aria-live="polite">
        {meta
          ? `Showing ${meta.total && meta.page <= meta.totalPages ? (meta.page - 1) * meta.limit + 1 : 0}–${meta.page > meta.totalPages ? 0 : Math.min(meta.page * meta.limit, meta.total)} of ${meta.total} ${noun}`
          : 'Loading results…'}
      </span>
      <label>
        Rows per page{' '}
        <select
          className="rounded-lg border p-2"
          value={state.limit}
          onChange={(event) => state.update({ limit: event.target.value })}
        >
          {[10, 20, 50, 100].map((size) => (
            <option key={size}>{size}</option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-3">
        {meta && state.page > meta.totalPages && (
          <button
            className="button-secondary"
            type="button"
            onClick={() => state.update({ page: String(meta.totalPages) }, false)}
          >
            Last available page
          </button>
        )}
        <button
          type="button"
          className="button-secondary"
          disabled={busy || state.page <= 1}
          onClick={() => state.update({ page: String(state.page - 1) }, false)}
        >
          Previous
        </button>
        <span>
          Page {state.page} of {meta?.totalPages ?? '…'}
        </span>
        <button
          type="button"
          className="button-secondary"
          disabled={busy || !meta || state.page >= meta.totalPages}
          onClick={() => state.update({ page: String(state.page + 1) }, false)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
export function TableSkeleton() {
  return (
    <div role="status" aria-label="Loading results" className="space-y-3 p-5">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className="h-12 animate-pulse rounded bg-slate-100 motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}
export function SortHeader({
  state,
  field,
  children,
}: {
  state: TableState;
  field: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() =>
        state.update({
          sortBy: field,
          sortOrder:
            state.values.sortBy === field && state.values.sortOrder === 'asc' ? 'desc' : 'asc',
        })
      }
    >
      {children}{' '}
      {state.values.sortBy === field ? (state.values.sortOrder === 'asc' ? '↑' : '↓') : '↕'}
    </button>
  );
}
