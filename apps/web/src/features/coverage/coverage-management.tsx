'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { ApiError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';
import { CoverageChecker } from './coverage-checker';
import type { AddressSuggestion, AddressSuggestionsResponse } from './coverage.types';
import type {
  AccessTechnology,
  AddressCoverageOverride,
  AddressOverrideStatus,
  CoverageAnalytics,
  InternetPlan,
  OperatingRegion,
  OperatingRegionStatus,
  PlanCoverageRule,
  PostcodeCoverage,
  PostcodeCoverageStatus,
} from './coverage-management.types';

type Tab = 'lookup' | 'regions' | 'postcodes' | 'overrides' | 'rules' | 'analytics';
type MutationInput = { path: string; method: 'POST' | 'PATCH'; body: Record<string, unknown> };

const technologies: AccessTechnology[] = [
  'FTTP',
  'FTTN',
  'FTTC',
  'HFC',
  'FIXED_WIRELESS',
  'SATELLITE',
];
const regionStatuses: OperatingRegionStatus[] = ['ACTIVE', 'COMING_SOON', 'DISABLED'];
const postcodeStatuses: PostcodeCoverageStatus[] = [
  'AVAILABLE',
  'PARTIAL',
  'COMING_SOON',
  'UNAVAILABLE',
];
const overrideStatuses: AddressOverrideStatus[] = ['AVAILABLE', 'UNAVAILABLE', 'MANUAL_REVIEW'];

const emptyRegionForm = {
  id: '',
  countryCode: 'AU',
  stateCode: 'SA',
  name: 'South Australia',
  status: 'DISABLED' as OperatingRegionStatus,
};
const emptyPostcodeForm = {
  id: '',
  operatingRegionId: '',
  postcode: '',
  status: 'AVAILABLE' as PostcodeCoverageStatus,
  technology: 'FTTP' as AccessTechnology | '',
  maximumSpeedMbps: '100',
  availabilityDate: '',
  adminNotes: '',
  isActive: true,
};
const emptyOverrideForm = {
  id: '',
  operatingRegionId: '',
  status: 'UNAVAILABLE' as AddressOverrideStatus,
  technology: '' as AccessTechnology | '',
  maximumSpeedMbps: '',
  availabilityDate: '',
  adminNotes: '',
  isActive: true,
};
const emptyRuleForm = {
  id: '',
  planId: '',
  technology: 'FTTP' as AccessTechnology,
  minimumSpeedMbps: '',
  maximumSpeedMbps: '',
  operatingRegionId: '',
  postcode: '',
  isActive: true,
};

function optionalNumber(value: string): number | null {
  return value ? Number(value) : null;
}

function dateInput(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

function messageFor(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'The coverage configuration could not be saved.';
}

export function CoverageManagement() {
  const { accessToken, isLoading, logout, user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const [tab, setTab] = useState<Tab>('lookup');
  const [search, setSearch] = useState('');
  const [regionStatus, setRegionStatus] = useState('');
  const [postcodeStatus, setPostcodeStatus] = useState('');
  const [regionForm, setRegionForm] = useState(emptyRegionForm);
  const [postcodeForm, setPostcodeForm] = useState(emptyPostcodeForm);
  const [overrideForm, setOverrideForm] = useState(emptyOverrideForm);
  const [ruleForm, setRuleForm] = useState(emptyRuleForm);
  const [overrideSelection, setOverrideSelection] = useState<AddressSuggestion | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canView = Boolean(
    accessToken &&
    (user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'STAFF'),
  );
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    return params.toString() ? `?${params.toString()}` : '';
  }, [search]);
  const regionsQueryString = useMemo(() => {
    const params = new URLSearchParams(queryString.slice(1));
    if (regionStatus) params.set('status', regionStatus);
    return params.toString() ? `?${params.toString()}` : '';
  }, [queryString, regionStatus]);
  const postcodesQueryString = useMemo(() => {
    const params = new URLSearchParams(queryString.slice(1));
    if (postcodeStatus) params.set('status', postcodeStatus);
    return params.toString() ? `?${params.toString()}` : '';
  }, [postcodeStatus, queryString]);

  const regions = useQuery({
    queryKey: ['coverage-management', 'regions', regionsQueryString],
    queryFn: () =>
      apiRequest<OperatingRegion[]>(
        `/coverage-management/regions${regionsQueryString}`,
        {},
        accessToken,
      ),
    enabled: canView,
  });
  const postcodes = useQuery({
    queryKey: ['coverage-management', 'postcodes', postcodesQueryString],
    queryFn: () =>
      apiRequest<PostcodeCoverage[]>(
        `/coverage-management/postcodes${postcodesQueryString}`,
        {},
        accessToken,
      ),
    enabled: canView,
  });
  const overrides = useQuery({
    queryKey: ['coverage-management', 'overrides', queryString],
    queryFn: () =>
      apiRequest<AddressCoverageOverride[]>(
        `/coverage-management/address-overrides${queryString}`,
        {},
        accessToken,
      ),
    enabled: Boolean(canView && isAdmin),
  });
  const rules = useQuery({
    queryKey: ['coverage-management', 'rules', queryString],
    queryFn: () =>
      apiRequest<PlanCoverageRule[]>(
        `/coverage-management/plan-rules${queryString}`,
        {},
        accessToken,
      ),
    enabled: Boolean(canView && isAdmin),
  });
  const plans = useQuery({
    queryKey: ['plans', 'coverage-management'],
    queryFn: () => apiRequest<InternetPlan[]>('/plans', {}, accessToken),
    enabled: Boolean(canView && isAdmin),
  });
  const analytics = useQuery({
    queryKey: ['coverage-management', 'analytics'],
    queryFn: () =>
      apiRequest<CoverageAnalytics>('/coverage-management/analytics?days=30', {}, accessToken),
    enabled: Boolean(canView && isAdmin),
  });

  const mutation = useMutation({
    mutationFn: ({ path, method, body }: MutationInput) =>
      apiRequest<unknown>(path, { method, body: JSON.stringify(body) }, accessToken),
    onSuccess: async () => {
      setSuccess('Coverage configuration saved.');
      await queryClient.invalidateQueries({ queryKey: ['coverage-management'] });
    },
  });

  if (isLoading) return <PageStatus message="Restoring your session…" />;
  if (!user) return <PageStatus message="Sign in to view coverage operations." />;
  if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN' && user.role !== 'STAFF') {
    return <PageStatus message="Coverage operations require staff access." />;
  }

  const tabs: Array<{ id: Tab; label: string; adminOnly?: boolean }> = [
    { id: 'lookup', label: 'Address lookup' },
    { id: 'regions', label: 'Operating regions' },
    { id: 'postcodes', label: 'Exact postcodes' },
    { id: 'overrides', label: 'Address overrides', adminOnly: true },
    { id: 'rules', label: 'Plan compatibility', adminOnly: true },
    { id: 'analytics', label: 'Analytics', adminOnly: true },
  ];

  function save(input: MutationInput, afterSave: () => void) {
    setSuccess(null);
    mutation.mutate(input, { onSuccess: afterSave });
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-10">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">
            MERO TELECOM · {isAdmin ? 'ADMIN' : 'STAFF'}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
            Coverage operations
          </h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            {isAdmin
              ? 'Control operating regions, exact qualification records, and compatible plans.'
              : 'View coverage configuration and qualify selected customer addresses.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="button-secondary"
            href={isAdmin ? '/admin/dashboard' : '/staff/customers'}
          >
            {isAdmin ? 'Dashboard' : 'Customers'}
          </Link>
          <Link className="button-secondary" href={isAdmin ? '/admin/plans' : '/staff/plans'}>
            Plans
          </Link>
          <button className="button-primary" onClick={() => void logout()} type="button">
            Sign out
          </button>
        </div>
      </header>

      <nav aria-label="Coverage management sections" className="mt-6 flex flex-wrap gap-2">
        {tabs
          .filter((item) => !item.adminOnly || isAdmin)
          .map((item) => (
            <button
              aria-current={tab === item.id ? 'page' : undefined}
              className={tab === item.id ? 'button-primary' : 'button-secondary'}
              key={item.id}
              onClick={() => setTab(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
      </nav>

      {mutation.isError ? (
        <p className="mt-5 rounded-lg bg-rose-50 p-4 text-rose-800" role="alert">
          {messageFor(mutation.error)}
        </p>
      ) : null}
      {success ? (
        <p className="mt-5 rounded-lg bg-emerald-50 p-4 text-emerald-800" role="status">
          {success}
        </p>
      ) : null}

      {tab === 'lookup' ? (
        <section className="mt-7">
          <CoverageChecker />
        </section>
      ) : null}

      {tab !== 'lookup' && tab !== 'analytics' ? (
        <div className="mt-7 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="min-w-64 flex-1 text-sm font-medium text-slate-700">
            Search records
            <input
              className="field mt-1"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by state, postcode, address, or plan"
              value={search}
            />
          </label>
          {tab === 'regions' ? (
            <StatusFilter
              label="Region status"
              onChange={setRegionStatus}
              options={regionStatuses}
              value={regionStatus}
            />
          ) : null}
          {tab === 'postcodes' ? (
            <StatusFilter
              label="Coverage status"
              onChange={setPostcodeStatus}
              options={postcodeStatuses}
              value={postcodeStatus}
            />
          ) : null}
        </div>
      ) : null}

      {tab === 'regions' ? (
        <div className="mt-7 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          {isAdmin ? (
            <Editor title={regionForm.id ? 'Edit operating region' : 'Add operating region'}>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  save(
                    {
                      path: regionForm.id
                        ? `/coverage-management/regions/${regionForm.id}`
                        : '/coverage-management/regions',
                      method: regionForm.id ? 'PATCH' : 'POST',
                      body: {
                        countryCode: regionForm.countryCode,
                        stateCode: regionForm.stateCode,
                        name: regionForm.name,
                        status: regionForm.status,
                      },
                    },
                    () => setRegionForm(emptyRegionForm),
                  );
                }}
              >
                <div className="grid grid-cols-2 gap-3">
                  <TextField
                    label="Country"
                    maxLength={2}
                    onChange={(countryCode) => setRegionForm({ ...regionForm, countryCode })}
                    required
                    value={regionForm.countryCode}
                  />
                  <TextField
                    label="State code"
                    maxLength={3}
                    onChange={(stateCode) => setRegionForm({ ...regionForm, stateCode })}
                    required
                    value={regionForm.stateCode}
                  />
                </div>
                <TextField
                  label="Region name"
                  onChange={(name) => setRegionForm({ ...regionForm, name })}
                  required
                  value={regionForm.name}
                />
                <SelectField
                  label="Status"
                  onChange={(status) =>
                    setRegionForm({ ...regionForm, status: status as OperatingRegionStatus })
                  }
                  options={regionStatuses}
                  value={regionForm.status}
                />
                <FormActions
                  editing={Boolean(regionForm.id)}
                  isSaving={mutation.isPending}
                  onCancel={() => setRegionForm(emptyRegionForm)}
                />
              </form>
            </Editor>
          ) : null}
          <RecordPanel title="Configured states">
            <QueryState query={regions} empty="No operating regions match this filter." />
            {regions.data?.map((region) => (
              <article className="border-b border-slate-100 p-5 last:border-0" key={region.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-950">
                      {region.name} ({region.stateCode})
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {region._count.postcodeCoverage} exact postcodes ·{' '}
                      {region._count.addressOverrides} overrides
                    </p>
                  </div>
                  <StatusBadge value={region.status} />
                </div>
                {isAdmin ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      className="button-secondary"
                      onClick={() =>
                        setRegionForm({
                          id: region.id,
                          countryCode: region.countryCode,
                          stateCode: region.stateCode,
                          name: region.name,
                          status: region.status,
                        })
                      }
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="button-secondary"
                      disabled={mutation.isPending}
                      onClick={() =>
                        save(
                          {
                            path: `/coverage-management/regions/${region.id}`,
                            method: 'PATCH',
                            body: {
                              status: region.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
                            },
                          },
                          () => undefined,
                        )
                      }
                      type="button"
                    >
                      {region.status === 'ACTIVE' ? 'Disable' : 'Activate'}
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </RecordPanel>
        </div>
      ) : null}

      {tab === 'postcodes' ? (
        <div className="mt-7 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          {isAdmin ? (
            <Editor title={postcodeForm.id ? 'Edit exact postcode' : 'Add exact postcode'}>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  save(
                    {
                      path: postcodeForm.id
                        ? `/coverage-management/postcodes/${postcodeForm.id}`
                        : '/coverage-management/postcodes',
                      method: postcodeForm.id ? 'PATCH' : 'POST',
                      body: {
                        operatingRegionId: postcodeForm.operatingRegionId,
                        postcode: postcodeForm.postcode,
                        status: postcodeForm.status,
                        technology: postcodeForm.technology || null,
                        maximumSpeedMbps: optionalNumber(postcodeForm.maximumSpeedMbps),
                        availabilityDate: postcodeForm.availabilityDate || null,
                        adminNotes: postcodeForm.adminNotes || null,
                        isActive: postcodeForm.isActive,
                      },
                    },
                    () => setPostcodeForm(emptyPostcodeForm),
                  );
                }}
              >
                <RegionSelect
                  onChange={(operatingRegionId) =>
                    setPostcodeForm({ ...postcodeForm, operatingRegionId })
                  }
                  regions={regions.data ?? []}
                  value={postcodeForm.operatingRegionId}
                />
                <TextField
                  label="Exact postcode"
                  maxLength={4}
                  onChange={(postcode) => setPostcodeForm({ ...postcodeForm, postcode })}
                  required
                  value={postcodeForm.postcode}
                />
                <SelectField
                  label="Coverage status"
                  onChange={(status) =>
                    setPostcodeForm({
                      ...postcodeForm,
                      status: status as PostcodeCoverageStatus,
                    })
                  }
                  options={postcodeStatuses}
                  value={postcodeForm.status}
                />
                <QualificationFields
                  maximumSpeedMbps={postcodeForm.maximumSpeedMbps}
                  onMaximumSpeedChange={(maximumSpeedMbps) =>
                    setPostcodeForm({ ...postcodeForm, maximumSpeedMbps })
                  }
                  onTechnologyChange={(technology) =>
                    setPostcodeForm({ ...postcodeForm, technology })
                  }
                  technology={postcodeForm.technology}
                />
                <TextField
                  label="Availability date"
                  onChange={(availabilityDate) =>
                    setPostcodeForm({ ...postcodeForm, availabilityDate })
                  }
                  type="date"
                  value={postcodeForm.availabilityDate}
                />
                <TextAreaField
                  label="Admin notes"
                  onChange={(adminNotes) => setPostcodeForm({ ...postcodeForm, adminNotes })}
                  value={postcodeForm.adminNotes}
                />
                <CheckboxField
                  checked={postcodeForm.isActive}
                  label="Record is active"
                  onChange={(isActive) => setPostcodeForm({ ...postcodeForm, isActive })}
                />
                <FormActions
                  editing={Boolean(postcodeForm.id)}
                  isSaving={mutation.isPending}
                  onCancel={() => setPostcodeForm(emptyPostcodeForm)}
                />
              </form>
            </Editor>
          ) : null}
          <RecordPanel title="Exact postcode records">
            <QueryState query={postcodes} empty="No exact postcode records match this filter." />
            {postcodes.data?.map((record) => (
              <article className="border-b border-slate-100 p-5 last:border-0" key={record.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-950">
                      {record.postcode} · {record.operatingRegion.stateCode}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {record.technology ?? 'No technology'} ·{' '}
                      {record.maximumSpeedMbps
                        ? `${record.maximumSpeedMbps} Mbps max`
                        : 'Speed pending'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <StatusBadge value={record.status} />
                    {!record.isActive ? <StatusBadge value="DISABLED" /> : null}
                  </div>
                </div>
                {isAdmin ? (
                  <RecordActions
                    active={record.isActive}
                    disabled={mutation.isPending}
                    onEdit={() =>
                      setPostcodeForm({
                        id: record.id,
                        operatingRegionId: record.operatingRegionId,
                        postcode: record.postcode,
                        status: record.status,
                        technology: record.technology ?? '',
                        maximumSpeedMbps: record.maximumSpeedMbps?.toString() ?? '',
                        availabilityDate: dateInput(record.availabilityDate),
                        adminNotes: record.adminNotes ?? '',
                        isActive: record.isActive,
                      })
                    }
                    onToggle={() =>
                      save(
                        {
                          path: `/coverage-management/postcodes/${record.id}`,
                          method: 'PATCH',
                          body: { isActive: !record.isActive },
                        },
                        () => undefined,
                      )
                    }
                  />
                ) : null}
              </article>
            ))}
          </RecordPanel>
        </div>
      ) : null}

      {tab === 'overrides' && isAdmin ? (
        <div className="mt-7 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <Editor title={overrideForm.id ? 'Edit address override' : 'Add address override'}>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                const body = {
                  operatingRegionId: overrideForm.operatingRegionId,
                  status: overrideForm.status,
                  technology: overrideForm.technology || null,
                  maximumSpeedMbps: optionalNumber(overrideForm.maximumSpeedMbps),
                  availabilityDate: overrideForm.availabilityDate || null,
                  adminNotes: overrideForm.adminNotes || null,
                  ...(overrideForm.id
                    ? { isActive: overrideForm.isActive }
                    : { selectionToken: overrideSelection?.selectionToken ?? '' }),
                };
                save(
                  {
                    path: overrideForm.id
                      ? `/coverage-management/address-overrides/${overrideForm.id}`
                      : '/coverage-management/address-overrides/from-selection',
                    method: overrideForm.id ? 'PATCH' : 'POST',
                    body,
                  },
                  () => {
                    setOverrideForm(emptyOverrideForm);
                    setOverrideSelection(null);
                  },
                );
              }}
            >
              {!overrideForm.id ? (
                <TrustedAddressSelector
                  onSelect={setOverrideSelection}
                  selected={overrideSelection}
                />
              ) : (
                <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                  Edit the decision for this existing exact address.
                </p>
              )}
              <RegionSelect
                onChange={(operatingRegionId) =>
                  setOverrideForm({ ...overrideForm, operatingRegionId })
                }
                regions={regions.data ?? []}
                value={overrideForm.operatingRegionId}
              />
              <SelectField
                label="Override status"
                onChange={(status) =>
                  setOverrideForm({ ...overrideForm, status: status as AddressOverrideStatus })
                }
                options={overrideStatuses}
                value={overrideForm.status}
              />
              <QualificationFields
                maximumSpeedMbps={overrideForm.maximumSpeedMbps}
                onMaximumSpeedChange={(maximumSpeedMbps) =>
                  setOverrideForm({ ...overrideForm, maximumSpeedMbps })
                }
                onTechnologyChange={(technology) =>
                  setOverrideForm({ ...overrideForm, technology })
                }
                technology={overrideForm.technology}
              />
              <TextField
                label="Availability date"
                onChange={(availabilityDate) =>
                  setOverrideForm({ ...overrideForm, availabilityDate })
                }
                type="date"
                value={overrideForm.availabilityDate}
              />
              <TextAreaField
                label="Admin notes"
                onChange={(adminNotes) => setOverrideForm({ ...overrideForm, adminNotes })}
                value={overrideForm.adminNotes}
              />
              {overrideForm.id ? (
                <CheckboxField
                  checked={overrideForm.isActive}
                  label="Override is active"
                  onChange={(isActive) => setOverrideForm({ ...overrideForm, isActive })}
                />
              ) : null}
              <FormActions
                editing={Boolean(overrideForm.id)}
                isSaving={mutation.isPending}
                onCancel={() => {
                  setOverrideForm(emptyOverrideForm);
                  setOverrideSelection(null);
                }}
              />
            </form>
          </Editor>
          <RecordPanel title="Exact-address overrides">
            <QueryState query={overrides} empty="No exact-address overrides match this filter." />
            {overrides.data?.map((record) => (
              <article className="border-b border-slate-100 p-5 last:border-0" key={record.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-950">{record.formattedAddress}</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {record.technology ?? 'No technology'} ·{' '}
                      {record.maximumSpeedMbps
                        ? `${record.maximumSpeedMbps} Mbps max`
                        : 'Speed pending'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <StatusBadge value={record.status} />
                    {!record.isActive ? <StatusBadge value="DISABLED" /> : null}
                  </div>
                </div>
                <RecordActions
                  active={record.isActive}
                  disabled={mutation.isPending}
                  onEdit={() =>
                    setOverrideForm({
                      id: record.id,
                      operatingRegionId: record.operatingRegionId,
                      status: record.status,
                      technology: record.technology ?? '',
                      maximumSpeedMbps: record.maximumSpeedMbps?.toString() ?? '',
                      availabilityDate: dateInput(record.availabilityDate),
                      adminNotes: record.adminNotes ?? '',
                      isActive: record.isActive,
                    })
                  }
                  onToggle={() =>
                    save(
                      {
                        path: `/coverage-management/address-overrides/${record.id}`,
                        method: 'PATCH',
                        body: { isActive: !record.isActive },
                      },
                      () => undefined,
                    )
                  }
                />
              </article>
            ))}
          </RecordPanel>
        </div>
      ) : null}

      {tab === 'rules' && isAdmin ? (
        <div className="mt-7 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <Editor title={ruleForm.id ? 'Edit plan compatibility' : 'Add plan compatibility'}>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                save(
                  {
                    path: ruleForm.id
                      ? `/coverage-management/plan-rules/${ruleForm.id}`
                      : '/coverage-management/plan-rules',
                    method: ruleForm.id ? 'PATCH' : 'POST',
                    body: {
                      planId: ruleForm.planId,
                      technology: ruleForm.technology,
                      minimumSpeedMbps: optionalNumber(ruleForm.minimumSpeedMbps),
                      maximumSpeedMbps: optionalNumber(ruleForm.maximumSpeedMbps),
                      operatingRegionId: ruleForm.operatingRegionId || null,
                      postcode: ruleForm.postcode || null,
                      isActive: ruleForm.isActive,
                    },
                  },
                  () => setRuleForm(emptyRuleForm),
                );
              }}
            >
              <label className="block text-sm font-medium text-slate-700">
                Internet plan
                <select
                  className="field mt-1"
                  onChange={(event) => setRuleForm({ ...ruleForm, planId: event.target.value })}
                  required
                  value={ruleForm.planId}
                >
                  <option value="">Select a plan</option>
                  {plans.data?.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} ({plan.downloadMbps} Mbps){plan.isActive ? '' : ' — inactive'}
                    </option>
                  ))}
                </select>
              </label>
              <SelectField
                label="Access technology"
                onChange={(technology) =>
                  setRuleForm({ ...ruleForm, technology: technology as AccessTechnology })
                }
                options={technologies}
                value={ruleForm.technology}
              />
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Minimum speed Mbps"
                  min="1"
                  onChange={(minimumSpeedMbps) => setRuleForm({ ...ruleForm, minimumSpeedMbps })}
                  type="number"
                  value={ruleForm.minimumSpeedMbps}
                />
                <TextField
                  label="Maximum speed Mbps"
                  min="1"
                  onChange={(maximumSpeedMbps) => setRuleForm({ ...ruleForm, maximumSpeedMbps })}
                  type="number"
                  value={ruleForm.maximumSpeedMbps}
                />
              </div>
              <RegionSelect
                allowAll
                onChange={(operatingRegionId) => setRuleForm({ ...ruleForm, operatingRegionId })}
                regions={regions.data ?? []}
                value={ruleForm.operatingRegionId}
              />
              <TextField
                label="Optional exact postcode"
                maxLength={4}
                onChange={(postcode) => setRuleForm({ ...ruleForm, postcode })}
                value={ruleForm.postcode}
              />
              <CheckboxField
                checked={ruleForm.isActive}
                label="Compatibility rule is active"
                onChange={(isActive) => setRuleForm({ ...ruleForm, isActive })}
              />
              <FormActions
                editing={Boolean(ruleForm.id)}
                isSaving={mutation.isPending}
                onCancel={() => setRuleForm(emptyRuleForm)}
              />
            </form>
          </Editor>
          <RecordPanel title="Plan compatibility rules">
            <QueryState query={rules} empty="No plan rules match this filter." />
            {rules.data?.map((rule) => (
              <article className="border-b border-slate-100 p-5 last:border-0" key={rule.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-950">
                      {rule.plan.name} · {rule.technology}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {rule.operatingRegion?.stateCode ?? 'All configured regions'}
                      {rule.postcode ? ` · ${rule.postcode}` : ''} ·{' '}
                      {rule.minimumSpeedMbps ?? 'Any'}–{rule.maximumSpeedMbps ?? 'Any'} Mbps
                    </p>
                  </div>
                  <StatusBadge value={rule.isActive ? 'ACTIVE' : 'DISABLED'} />
                </div>
                <RecordActions
                  active={rule.isActive}
                  disabled={mutation.isPending}
                  onEdit={() =>
                    setRuleForm({
                      id: rule.id,
                      planId: rule.planId,
                      technology: rule.technology,
                      minimumSpeedMbps: rule.minimumSpeedMbps?.toString() ?? '',
                      maximumSpeedMbps: rule.maximumSpeedMbps?.toString() ?? '',
                      operatingRegionId: rule.operatingRegionId ?? '',
                      postcode: rule.postcode ?? '',
                      isActive: rule.isActive,
                    })
                  }
                  onToggle={() =>
                    save(
                      {
                        path: `/coverage-management/plan-rules/${rule.id}`,
                        method: 'PATCH',
                        body: { isActive: !rule.isActive },
                      },
                      () => undefined,
                    )
                  }
                />
              </article>
            ))}
          </RecordPanel>
        </div>
      ) : null}

      {tab === 'analytics' && isAdmin ? (
        <section className="mt-7 space-y-6">
          <QueryState query={analytics} empty="No coverage checks were recorded in this period." />
          {analytics.data ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Checks (30 days)" value={analytics.data.total} />
                {analytics.data.byStatus.slice(0, 3).map((entry) => (
                  <Metric
                    key={entry.status}
                    label={entry.status.replaceAll('_', ' ')}
                    value={entry.count}
                  />
                ))}
              </div>
              <RecordPanel title="Recent privacy-safe coverage checks">
                {analytics.data.recent.map((record) => (
                  <article className="border-b border-slate-100 p-5 last:border-0" key={record.id}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-950">
                          {record.stateCode ?? 'Unknown state'} {record.postcode ?? ''}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          {record.technology ?? 'No technology'} ·{' '}
                          {new Date(record.createdAt).toLocaleString('en-AU')}
                        </p>
                      </div>
                      <StatusBadge value={record.resultStatus} />
                    </div>
                  </article>
                ))}
              </RecordPanel>
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

function TrustedAddressSelector({
  selected,
  onSelect,
}: Readonly<{
  selected: AddressSuggestion | null;
  onSelect: (suggestion: AddressSuggestion | null) => void;
}>) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    if (query.trim().length < 3) {
      setDebounced('');
      return;
    }
    const timeout = window.setTimeout(() => setDebounced(query.trim()), 400);
    return () => window.clearTimeout(timeout);
  }, [query]);
  const suggestions = useQuery({
    queryKey: ['coverage', 'override-address-suggestions', debounced],
    queryFn: ({ signal }) =>
      apiRequest<AddressSuggestionsResponse>(
        `/coverage/address-suggestions?query=${encodeURIComponent(debounced)}`,
        { signal },
      ),
    enabled: debounced.length >= 3 && !selected,
    retry: false,
  });
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">
        Exact Australian address
        <input
          className="field mt-1"
          onChange={(event) => {
            setQuery(event.target.value);
            onSelect(null);
          }}
          placeholder="Search and select an address"
          required={!selected}
          value={selected?.formattedAddress ?? query}
        />
      </label>
      {suggestions.isFetching ? <p className="mt-2 text-sm text-slate-500">Searching…</p> : null}
      {suggestions.isError ? (
        <p className="mt-2 text-sm text-rose-700" role="alert">
          Address suggestions are unavailable.
        </p>
      ) : null}
      {!selected && suggestions.data?.suggestions.length ? (
        <ul
          className="mt-2 rounded-lg border border-slate-200 bg-white py-1"
          aria-label="Override address suggestions"
        >
          {suggestions.data.suggestions.map((suggestion) => (
            <li key={suggestion.selectionToken}>
              <button
                className="w-full px-3 py-2 text-left text-sm hover:bg-sky-50"
                onClick={() => onSelect(suggestion)}
                type="button"
              >
                {suggestion.formattedAddress}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {selected ? (
        <p className="mt-2 text-sm font-medium text-emerald-700">Trusted address selected.</p>
      ) : null}
    </div>
  );
}

function Editor({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function RecordPanel({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <h2 className="border-b border-slate-200 px-5 py-4 text-lg font-semibold text-slate-950">
        {title}
      </h2>
      {children}
    </section>
  );
}

function QueryState({
  query,
  empty,
}: Readonly<{
  query: { isPending: boolean; isError: boolean; data?: unknown[] | CoverageAnalytics };
  empty: string;
}>) {
  if (query.isPending) return <p className="p-5 text-slate-500">Loading records…</p>;
  if (query.isError) return <p className="p-5 text-rose-700">Unable to load these records.</p>;
  if (Array.isArray(query.data) && query.data.length === 0) {
    return <p className="p-5 text-slate-500">{empty}</p>;
  }
  return null;
}

function PageStatus({ message }: Readonly<{ message: string }>) {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-slate-600">{message}</main>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  maxLength,
  min,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  maxLength?: number;
  min?: string;
}>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        className="field mt-1"
        maxLength={maxLength}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        type={type}
        value={value}
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
}: Readonly<{ label: string; value: string; onChange: (value: string) => void }>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <textarea
        className="field mt-1 min-h-20"
        maxLength={1000}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <select
        className="field mt-1"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option.replaceAll('_', ' ')}
          </option>
        ))}
      </select>
    </label>
  );
}

function RegionSelect({
  regions,
  value,
  onChange,
  allowAll = false,
}: Readonly<{
  regions: OperatingRegion[];
  value: string;
  onChange: (value: string) => void;
  allowAll?: boolean;
}>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      Operating region
      <select
        className="field mt-1"
        onChange={(event) => onChange(event.target.value)}
        required={!allowAll}
        value={value}
      >
        <option value="">{allowAll ? 'All configured regions' : 'Select a region'}</option>
        {regions.map((region) => (
          <option key={region.id} value={region.id}>
            {region.name} ({region.stateCode})
          </option>
        ))}
      </select>
    </label>
  );
}

function QualificationFields({
  technology,
  maximumSpeedMbps,
  onTechnologyChange,
  onMaximumSpeedChange,
}: Readonly<{
  technology: AccessTechnology | '';
  maximumSpeedMbps: string;
  onTechnologyChange: (value: AccessTechnology | '') => void;
  onMaximumSpeedChange: (value: string) => void;
}>) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-sm font-medium text-slate-700">
        Technology
        <select
          className="field mt-1"
          onChange={(event) => onTechnologyChange(event.target.value as AccessTechnology | '')}
          value={technology}
        >
          <option value="">Needs review</option>
          {technologies.map((item) => (
            <option key={item} value={item}>
              {item.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </label>
      <TextField
        label="Maximum Mbps"
        min="1"
        onChange={onMaximumSpeedChange}
        type="number"
        value={maximumSpeedMbps}
      />
    </div>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: Readonly<{ label: string; checked: boolean; onChange: (checked: boolean) => void }>) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

function FormActions({
  editing,
  isSaving,
  onCancel,
}: Readonly<{ editing: boolean; isSaving: boolean; onCancel: () => void }>) {
  return (
    <div className="flex gap-2">
      {editing ? (
        <button className="button-secondary" onClick={onCancel} type="button">
          Cancel
        </button>
      ) : null}
      <button className="button-primary" disabled={isSaving} type="submit">
        {isSaving ? 'Saving…' : editing ? 'Save changes' : 'Create record'}
      </button>
    </div>
  );
}

function RecordActions({
  active,
  disabled,
  onEdit,
  onToggle,
}: Readonly<{
  active: boolean;
  disabled: boolean;
  onEdit: () => void;
  onToggle: () => void;
}>) {
  return (
    <div className="mt-4 flex gap-2">
      <button className="button-secondary" onClick={onEdit} type="button">
        Edit
      </button>
      <button className="button-secondary" disabled={disabled} onClick={onToggle} type="button">
        {active ? 'Disable' : 'Enable'}
      </button>
    </div>
  );
}

function StatusFilter({
  label,
  value,
  options,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}>) {
  return (
    <label className="text-sm font-medium text-slate-700">
      {label}
      <select
        className="field mt-1 min-w-48"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">All statuses</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option.replaceAll('_', ' ')}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatusBadge({ value }: Readonly<{ value: string }>) {
  return (
    <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800">
      {value.replaceAll('_', ' ')}
    </span>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-950">{value}</p>
    </article>
  );
}
