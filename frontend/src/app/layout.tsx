import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Link from 'next/link';
import { Home, Mic, UploadCloud, History, Settings } from 'lucide-react';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Smart Lecture & Meeting Assistant',
  description: 'AI-powered real-time explainer and summarizer',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} flex h-screen overflow-hidden`}>
        {/* Sidebar */}
        <aside className="w-64 bg-gray-900/80 backdrop-blur-xl border-r border-gray-800 flex flex-col justify-between hidden md:flex">
          <div className="p-6">
            <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-600 mb-8">
              AI Assistant
            </h2>
            <nav className="space-y-4">
              <Link href="/" className="flex items-center gap-3 text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-gray-800">
                <Home size={20} /> Dashboard
              </Link>
              <Link href="/live" className="flex items-center gap-3 text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-gray-800">
                <Mic size={20} /> Live Session
              </Link>
              <Link href="/upload" className="flex items-center gap-3 text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-gray-800">
                <UploadCloud size={20} /> Upload
              </Link>
              <Link href="/history" className="flex items-center gap-3 text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-gray-800">
                <History size={20} /> History
              </Link>
            </nav>
          </div>
          <div className="p-6">
            <button className="flex items-center gap-3 text-gray-500 hover:text-gray-300 transition-colors w-full p-2">
              <Settings size={20} /> Settings
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto relative">
          {children}
        </main>
      </body>
    </html>
  );
}
