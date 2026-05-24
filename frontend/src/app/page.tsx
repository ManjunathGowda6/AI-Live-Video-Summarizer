'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-gray-950 to-gray-950"></div>
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="z-10 max-w-4xl text-center space-y-8"
      >
        <h1 className="text-5xl md:text-7xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-600">
          Smart Lecture & Meeting Assistant
        </h1>
        <p className="text-xl text-gray-400 max-w-2xl mx-auto">
          Your real-time AI teacher. Explain concepts live, summarize uploaded lectures, and unlock advanced intelligence without heavy raw data storage.
        </p>
        
        <div className="flex flex-col sm:flex-row items-center justify-center gap-6 pt-8">
            <Link href="/live">
              <div className="group relative px-8 py-4 bg-blue-600 hover:bg-blue-500 transition-all rounded-2xl cursor-pointer overflow-hidden backdrop-blur-md bg-opacity-80 border border-blue-400/30 shadow-[0_0_30px_-5px_rgba(59,130,246,0.5)]">
                <span className="relative z-10 font-semibold text-lg flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                  Start Live Session
                </span>
                <div className="absolute inset-0 h-full w-full scale-[2] rounded-full transition-all duration-300 group-hover:bg-blue-400/20 group-hover:scale-[3]"></div>
              </div>
            </Link>

            <Link href="/upload">
             <div className="group px-8 py-4 bg-gray-800 hover:bg-gray-700 transition-all rounded-2xl cursor-pointer border border-gray-700 hover:border-gray-500 shadow-xl">
               <span className="font-semibold text-lg">Upload Lecture</span>
             </div>
            </Link>
        </div>
      </motion.div>
    </main>
  );
}
