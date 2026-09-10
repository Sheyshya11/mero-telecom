import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MERO_TELECOM_LOGO_PATH, MeroTelecomLogo } from './mero-telecom-logo';

describe('MeroTelecomLogo', () => {
  it('renders the canonical supplied asset at its intrinsic aspect ratio', () => {
    render(<MeroTelecomLogo size="header" />);

    const logo = screen.getByRole('img', { name: 'Mero Telecom' });
    expect(logo).toHaveAttribute('src', MERO_TELECOM_LOGO_PATH);
    expect(logo).toHaveAttribute('width', '824');
    expect(logo).toHaveAttribute('height', '148');
  });

  it('supports decorative use inside an already-labelled link', () => {
    render(<MeroTelecomLogo alt="" size="portal" />);

    expect(document.querySelector('img')).toHaveAttribute('alt', '');
  });
});
