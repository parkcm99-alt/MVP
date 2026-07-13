import type { Metadata } from 'next';
import { IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600', '700'] });

export const metadata: Metadata = {
  title: 'AI Agent Office',
  description: 'Pixel-art AI agent simulation — MVP',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={plexMono.className} style={{ height: '100%' }}>
      <body style={{ height: '100%', overflow: 'hidden' }}>{children}</body>
    </html>
  );
}
