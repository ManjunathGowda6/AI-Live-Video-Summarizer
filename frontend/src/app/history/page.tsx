'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Video, Mic, ArrowRight, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function HistoryPage() {
  const router = useRouter();
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        // user_id is hardcoded to a valid UUID for MVP
        const res = await fetch(`http://localhost:8000/api/upload/history/11111111-2222-3333-4444-555555555555`);
        const result = await res.json();
        if (result.status === 'success') {
          setHistory(result.data);
        }
      } catch (e) {
        console.error("Failed to fetch history", e);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center">
        <Loader2 size={48} className="animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center p-8">
      <div className="w-full max-w-4xl text-center mb-12">
        <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-emerald-600 mb-4">
          Session History
        </h1>
        <p className="text-gray-400 text-lg">
          Review summaries, concept breakdowns, and Q&A from your past sessions.
        </p>
      </div>

      <div className="w-full max-w-4xl space-y-4">
        {history.length === 0 ? (
           <p className="text-center text-gray-500">No sessions recorded yet.</p>
        ) : history.map((session, index) => (
          <motion.div
            key={session.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            onClick={() => router.push(`/results/${session.id}`)}
            className="glass-card p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center hover:bg-gray-800/60 cursor-pointer transition-colors group"
          >
            <div className="flex items-center gap-4 mb-4 sm:mb-0">
              <div className={`p-3 rounded-xl ${session.mode === 'live' ? 'bg-red-500/20 text-red-500' : 'bg-blue-500/20 text-blue-500'}`}>
                {session.mode === 'live' ? <Mic size={24} /> : <Video size={24} />}
              </div>
              <div>
                <h3 className="text-xl font-bold capitalize">{session.mode} Session</h3>
                <div className="flex items-center gap-4 text-sm text-gray-400 mt-1">
                  <span className="flex items-center gap-1"><Calendar size={14} /> {new Date(session.created_at).toLocaleDateString()}</span>
                  <span className="flex items-center gap-1 text-gray-300 font-mono tracking-wider">{session.mode}</span>
                </div>
              </div>
            </div>
            
            <button className="flex items-center gap-2 text-teal-400 group-hover:text-teal-300 font-medium transition-colors">
              View Insights <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  );
}


