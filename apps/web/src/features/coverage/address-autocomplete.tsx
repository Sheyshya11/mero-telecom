'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';

import { LandingIcon } from '../../components/landing/landing-icons';
import { ApiError, apiRequest } from '../../lib/api/client';
import styles from '../../styles/landing.module.css';
import type { AddressSuggestion, AddressSuggestionsResponse } from './coverage.types';

const minimumCharacters = 3;

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Address suggestions are unavailable.';
}

export function AddressAutocomplete({
  label,
  placeholder = 'Start typing an Australian street address',
  selectedMessage = 'Address selected.',
  variant = 'default',
  onInputChange,
  onSelectionChange,
}: Readonly<{
  label: string;
  placeholder?: string;
  selectedMessage?: string;
  variant?: 'default' | 'landing';
  onInputChange?: () => void;
  onSelectionChange: (selection: AddressSuggestion | null) => void;
}>) {
  const isLanding = variant === 'landing';
  const queryClient = useQueryClient();
  const inputId = useId();
  const listboxId = `${inputId}-suggestions`;
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selected, setSelected] = useState<AddressSuggestion | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isOpen, setIsOpen] = useState(false);
  const normalizedQuery = query.trim();

  useEffect(() => {
    void queryClient.cancelQueries({ queryKey: ['address-autocomplete', inputId] });
    if (normalizedQuery.length < minimumCharacters) {
      setDebouncedQuery('');
      return;
    }
    const timeout = window.setTimeout(() => setDebouncedQuery(normalizedQuery), 400);
    return () => window.clearTimeout(timeout);
  }, [inputId, normalizedQuery, queryClient]);

  const suggestionsQuery = useQuery({
    queryKey: ['address-autocomplete', inputId, debouncedQuery],
    queryFn: ({ signal }) =>
      apiRequest<AddressSuggestionsResponse>(
        `/coverage/address-suggestions?query=${encodeURIComponent(debouncedQuery)}`,
        { signal },
      ),
    enabled: debouncedQuery.length >= minimumCharacters && !selected,
    retry: false,
  });
  const suggestions = suggestionsQuery.data?.suggestions ?? [];

  useEffect(() => {
    setActiveIndex(suggestions.length ? 0 : -1);
    setIsOpen(Boolean(!selected && debouncedQuery && suggestionsQuery.isSuccess));
  }, [debouncedQuery, selected, suggestions.length, suggestionsQuery.isSuccess]);

  function selectSuggestion(suggestion: AddressSuggestion) {
    setSelected(suggestion);
    setQuery(suggestion.formattedAddress);
    setIsOpen(false);
    setActiveIndex(-1);
    onSelectionChange(suggestion);
  }

  function changeQuery(value: string) {
    setQuery(value);
    setSelected(null);
    setIsOpen(value.trim().length >= minimumCharacters);
    setActiveIndex(-1);
    onSelectionChange(null);
    onInputChange?.();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!isOpen || suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      selectSuggestion(suggestions[activeIndex]);
    }
  }

  const showMinimumHint = normalizedQuery.length > 0 && normalizedQuery.length < minimumCharacters;

  return (
    <div className={isLanding ? styles.addressAutocomplete : 'relative'}>
      <label
        className={isLanding ? styles.addressLabel : 'block text-sm font-medium text-slate-700'}
        htmlFor={inputId}
      >
        {label}
      </label>
      {isLanding ? (
        <span className={styles.addressSearchIcon}>
          <LandingIcon name="search" size={20} />
        </span>
      ) : null}
      <input
        aria-activedescendant={
          isOpen && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
        }
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={isOpen}
        autoComplete="street-address"
        className={isLanding ? styles.addressInput : 'field mt-1'}
        id={inputId}
        maxLength={150}
        onChange={(event) => changeQuery(event.target.value)}
        onFocus={() => suggestions.length && !selected && setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        role="combobox"
        value={query}
      />
      {isLanding && suggestionsQuery.isFetching ? (
        <span aria-hidden="true" className={styles.addressSpinner} />
      ) : null}
      {isOpen ? (
        <ul
          aria-label={`${label} suggestions`}
          className={
            isLanding
              ? styles.suggestionList
              : 'absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg'
          }
          id={listboxId}
          role="listbox"
        >
          {suggestions.map((suggestion, index) => (
            <li
              aria-selected={index === activeIndex}
              className={
                isLanding
                  ? `${styles.suggestionItem} ${index === activeIndex ? styles.suggestionItemActive : ''}`
                  : `cursor-pointer px-4 py-3 text-sm ${index === activeIndex ? 'bg-sky-50 text-sky-950' : 'text-slate-700'}`
              }
              id={`${listboxId}-option-${index}`}
              key={suggestion.selectionToken}
              onMouseDown={(event) => {
                event.preventDefault();
                selectSuggestion(suggestion);
              }}
              role="option"
            >
              {isLanding ? <LandingIcon name="pin" size={16} /> : null}
              <span className="font-medium">{suggestion.formattedAddress}</span>
            </li>
          ))}
          {suggestionsQuery.isSuccess && suggestions.length === 0 ? (
            <li
              aria-selected={false}
              className={isLanding ? styles.suggestionItem : 'px-4 py-3 text-sm text-slate-500'}
              role="option"
            >
              No matching Australian addresses found.
            </li>
          ) : null}
        </ul>
      ) : null}
      <div
        className={isLanding ? styles.addressMessage : 'mt-2 min-h-6 text-sm'}
        aria-live="polite"
      >
        {showMinimumHint ? (
          <p className="text-slate-500">Enter at least three characters.</p>
        ) : suggestionsQuery.isFetching ? (
          <p className="text-slate-500">Searching addresses…</p>
        ) : suggestionsQuery.isError ? (
          <p className="text-rose-700" role="alert">
            {errorMessage(suggestionsQuery.error)}
          </p>
        ) : selected ? (
          <p className="font-medium text-emerald-700">{selectedMessage}</p>
        ) : null}
      </div>
    </div>
  );
}
