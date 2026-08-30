import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Wulfram Forge — Browser Map Editor',
  description: 'Build original-format Wulfram II terrain and bases in a textured 3D browser editor.',
  openGraph: {
    title: 'Wulfram Forge — Browser Map Editor',
    description: 'Sculpt textured Wulfram II terrain, build validated bases, and export original or new-server map formats.',
    type: 'website',
    images: [{
      url: 'https://raw.githubusercontent.com/blackwatergaming/wulfram-mapeditor/main/public/og.png',
      width: 1536,
      height: 1024,
      alt: 'Wulfram Forge browser map editor over a tactical canyon landscape',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Wulfram Forge — Browser Map Editor',
    description: 'Sculpt textured Wulfram II terrain, build validated bases, and export original or new-server map formats.',
    images: ['https://raw.githubusercontent.com/blackwatergaming/wulfram-mapeditor/main/public/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html className="dark" lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
