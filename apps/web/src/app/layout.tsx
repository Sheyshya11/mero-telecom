import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import './globals.css';
import { Providers } from './providers';

const jakarta = localFont({
  src: './plus-jakarta-sans.woff2',
  display: 'swap',
  variable: '--font-mero',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: 'Mero Telecom | NBN Internet Plans Australia',
  description:
    'Explore Mero Telecom NBN internet plans, check service availability at your address and get connected online.',
  openGraph: {
    title: 'Mero Telecom | NBN Internet Plans Australia',
    description:
      'Explore Mero Telecom NBN internet plans, check service availability at your address and get connected online.',
    locale: 'en_AU',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mero Telecom | NBN Internet Plans Australia',
    description:
      'Explore Mero Telecom NBN internet plans, check service availability at your address and get connected online.',
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-AU">
      <body className={jakarta.variable}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
