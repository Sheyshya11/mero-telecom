import type { ReactNode } from 'react';

export type LandingIconName =
  | 'activity'
  | 'arrow'
  | 'arrow-left'
  | 'check'
  | 'chevron'
  | 'credit-card'
  | 'cursor'
  | 'eye'
  | 'eye-off'
  | 'gauge'
  | 'headphones'
  | 'layers'
  | 'login'
  | 'menu'
  | 'pin'
  | 'rocket'
  | 'search'
  | 'settings'
  | 'shield'
  | 'star'
  | 'user'
  | 'users'
  | 'wifi'
  | 'x'
  | 'zap';

const paths: Record<LandingIconName, ReactNode> = {
  activity: <path d="M3 12h4l2-7 4 14 2-7h6" />,
  arrow: (
    <>
      <path d="M5 12h14" />
      <path d="m14 7 5 5-5 5" />
    </>
  ),
  'arrow-left': (
    <>
      <path d="M19 12H5" />
      <path d="m10 17-5-5 5-5" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  'credit-card': (
    <>
      <rect height="14" rx="2" width="20" x="2" y="5" />
      <path d="M2 10h20" />
    </>
  ),
  cursor: (
    <>
      <path d="m8 3 10 10-5 1-2 5L8 3Z" />
      <path d="m15 15 4 4" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  'eye-off': (
    <>
      <path d="m3 3 18 18" />
      <path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a16.6 16.6 0 0 1-2.2 2.9M6.6 6.6C3.6 8.4 2 12 2 12s3.5 6 10 6a10.7 10.7 0 0 0 4-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  gauge: (
    <>
      <path d="M3 18a9 9 0 1 1 18 0" />
      <path d="m12 14 4-4" />
    </>
  ),
  headphones: (
    <>
      <path d="M3 14v-2a9 9 0 0 1 18 0v2" />
      <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm18 0h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-5Z" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 4-9 4-9-4 9-4Z" />
      <path d="m3 12 9 4 9-4M3 17l9 4 9-4" />
    </>
  ),
  login: (
    <>
      <path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 17l5-5-5-5M15 12H3" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  pin: (
    <>
      <path d="M20 10c0 5-5.5 10.2-8 12-2.5-1.8-8-7-8-12a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  rocket: (
    <>
      <path d="M13 14c5-2.5 7.5-6.5 8-11-4.5.5-8.5 3-11 8l3 3Z" />
      <path d="M10 11 6 9l-3 3 5 2M13 14l2 4-3 3-2-5" />
      <circle cx="15.5" cy="8.5" r="1.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3A1.7 1.7 0 0 0 14 21v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14v-4a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3h4a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1v4a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  shield: (
    <>
      <path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V6c3.2 0 5.7-1.2 8-3 2.3 1.8 4.8 3 8 3v7Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  star: <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  wifi: (
    <>
      <path d="M12 20h.01" />
      <path d="M2 8.8a15 15 0 0 1 20 0" />
      <path d="M5 12.9a10 10 0 0 1 14 0" />
      <path d="M8.5 16.4a5 5 0 0 1 7 0" />
    </>
  ),
  x: <path d="M18 6 6 18M6 6l12 12" />,
  zap: <path d="m13 2-9 12h8l-1 8 9-12h-8l1-8Z" />,
};

export function LandingIcon({
  name,
  size = 20,
}: Readonly<{ name: LandingIconName; size?: number }>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  );
}
