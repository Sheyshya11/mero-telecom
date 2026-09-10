import Image from 'next/image';

import styles from './mero-telecom-logo.module.css';

export const MERO_TELECOM_LOGO_PATH = '/brand/mero-telecom-logo.jpg';

type LogoSize = 'auth' | 'compact' | 'footer' | 'header' | 'portal';

export interface MeroTelecomLogoProps {
  alt?: string;
  className?: string;
  preload?: boolean;
  size?: LogoSize;
}

export function MeroTelecomLogo({
  alt = 'Mero Telecom',
  className,
  preload = false,
  size = 'header',
}: Readonly<MeroTelecomLogoProps>) {
  return (
    <Image
      alt={alt}
      className={`${styles.logo} ${styles[size]}${className ? ` ${className}` : ''}`}
      height={148}
      preload={preload}
      sizes="(max-width: 480px) 192px, 240px"
      src={MERO_TELECOM_LOGO_PATH}
      unoptimized
      width={824}
    />
  );
}
