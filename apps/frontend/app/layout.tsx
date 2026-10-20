import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'OES | Online Examination System', description: 'College online examination portal' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
