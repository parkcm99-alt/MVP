import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Agent Office',
  description: 'Pixel-art AI agent simulation — MVP',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" style={{ height: '100%' }}>
      <body style={{ height: '100%', overflow: 'hidden' }}>{children}</body>
    </html>
  );
}
