import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { pathToHash } from './next-navigation';

export default function Link({ href, children, ...rest }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a href={pathToHash(href)} {...rest}>{children}</a>;
}
