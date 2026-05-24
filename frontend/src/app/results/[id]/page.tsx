'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2, PlaySquare, AlignLeft, Sparkles, Send, MessageCircle, Bot, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export default function ResultsPage() {
  const params = useParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [transcriptLive, setTranscriptLive] = useState("");
  const [initialSummaryLive, setInitialSummaryLive] = useState("");
  const [finalSummaryLive, setFinalSummaryLive] = useState("");
  const [streamActive, setStreamActive] = useState(true);
  const [streamError, setStreamError] = useState("");
  
  // Chat State
  const [chatMessages, setChatMessages] = useState<{role: 'user'|'assistant', content: string}[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputMessage.trim() || isChatLoading) return;

    const newMessages = [...chatMessages, { role: 'user' as const, content: inputMessage }];
    setChatMessages(newMessages);
    setInputMessage('');
    setIsChatLoading(true);

    try {
      const res = await fetch(`http://localhost:8000/api/chat/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: params.id, messages: newMessages })
      });
      
      if (!res.body) throw new Error("No response body");
      
      setChatMessages([...newMessages, { role: 'assistant', content: '' }]);
      setIsChatLoading(false); // Enable scrolling/typing while streaming
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let done = false;
      let streamedResponse = '';
      
      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          streamedResponse += decoder.decode(value, { stream: true });
          setChatMessages([...newMessages, { role: 'assistant', content: streamedResponse }]);
        }
      }
    } catch (err) {
      setChatMessages([...newMessages, { role: 'assistant', content: "Network error occurred while fetching response." }]);
      setIsChatLoading(false);
    }
  };

  useEffect(() => {
    if (!params.id) return;

    // 1. Try to connect to live stream
    const eventSource = new EventSource(`http://localhost:8000/api/upload/stream/${params.id}`);
    
    eventSource.onmessage = (event) => {
        try {
            const parsed = JSON.parse(event.data);
            
            if (parsed.type === "error" && parsed.text === "File not found or already processed") {
                // Not in memory for streaming, meaning it's already done and stored in DB. Fallback to fetch.
                eventSource.close();
                setStreamActive(false);
                fetchSummaryFromDB();
                return;
            }
            
            setLoading(false); // as soon as we connect properly, drop the loading screen
            
            if (parsed.type === "transcript") {
                setTranscriptLive(prev => prev + parsed.text);
            } else if (parsed.type === "initial_summary") {
                setInitialSummaryLive(prev => prev + parsed.text);
            } else if (parsed.type === "final_summary") {
                setFinalSummaryLive(prev => prev + parsed.text);
            } else if (parsed.type === "done") {
                setStreamActive(false);
                eventSource.close();
                // Optionally load the final official data payload
                fetchSummaryFromDB();
            } else if (parsed.type === "error") {
                setStreamError(parsed.text);
            }
        } catch(e) {}
    };

    eventSource.onerror = () => {
        // SSE disconnected unexpectedly
        eventSource.close();
        setStreamActive(false);
        fetchSummaryFromDB(); // Try to fallback
    };
    
    const fetchSummaryFromDB = async () => {
      try {
        const res = await fetch(`http://localhost:8000/api/upload/summary/${params.id}`);
        const result = await res.json();
        if (result.status === 'success' && result.data) {
          setData(result.data);
          setLoading(false);
        } else {
          // If neither stream nor DB is ready, keep polling fallback
          setTimeout(fetchSummaryFromDB, 3000);
        }
      } catch (err) {
        console.error(err);
      }
    };

    return () => eventSource.close();
  }, [params.id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-8">
        <Loader2 size={64} className="text-blue-500 animate-spin mb-6" />
        <h1 className="text-3xl font-bold animate-pulse">AI is Analyzing the Lecture...</h1>
        <p className="text-gray-400 mt-4">Extracting key concepts, generating answers, and summarizing...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-4xl mx-auto space-y-8"
      >
        <div className="glass-card p-8 border-l-4 border-l-blue-500">
          <div className="flex items-center gap-3 mb-4">
            {streamActive ? (
              <>
                 <Loader2 size={32} className="text-blue-400 animate-spin" />
                 <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-400 animate-pulse">
                   Live Processing...
                 </h1>
              </>
            ) : (
              <>
                 <CheckCircle2 size={32} className="text-blue-400" />
                 <h1 className="text-3xl font-bold">Analysis Complete</h1>
              </>
            )}
          </div>
          <p className="text-gray-400 text-sm font-mono">Session ID: {params.id}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 glass-card p-8 min-h-[400px]">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-indigo-400">
              <AlignLeft size={24} /> Detailed Summary
            </h2>
            <div className="text-gray-300 leading-relaxed space-y-4">
              {data ? (
                data.summary_text.split('\n').map((para: string, i: number) => (
                  <p key={i}>{para}</p>
                ))
              ) : (
                <div className="space-y-4">
                  {initialSummaryLive && (
                     <div className="p-4 bg-indigo-900/30 border border-indigo-500/20 rounded-xl mb-6">
                       <h3 className="text-indigo-300 font-bold mb-2 uppercase text-xs tracking-wider">Initial Insight</h3>
                       <ReactMarkdown>{initialSummaryLive}</ReactMarkdown>
                     </div>
                  )}
                  {finalSummaryLive ? (
                     <ReactMarkdown>{finalSummaryLive}</ReactMarkdown>
                  ) : streamActive && !initialSummaryLive ? (
                     <p className="text-gray-500 italic flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Waiting for transcript threshold to trigger AI...</p>
                  ) : streamActive ? (
                     <p className="text-gray-500 italic flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Generating final summary pipeline...</p>
                  ) : null}
                </div>
              )}
            </div>
          </div>
          
          <div className="glass-card p-6 bg-gradient-to-br from-indigo-900/40 to-purple-900/40 border-indigo-500/30 flex flex-col min-h-[400px]">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-purple-400">
              <Sparkles size={24} /> Live Transcript
            </h2>
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar text-sm text-gray-300 space-y-2 h-[300px]">
               {transcriptLive ? (
                   <p className="leading-relaxed">{transcriptLive}</p>
               ) : streamActive ? (
                   <p className="text-gray-500 italic animate-pulse">Listening and decoding raw media chunks...</p>
               ) : data ? (
                   <p className="text-gray-500 italic">Transcript analysis finished and cached in database securely.</p>
               ) : null}
            </div>
          </div>
        </div>

        {/* Chatbot Interface */}
        <div className="glass-card p-6 mt-8 border border-white/10" style={{ height: '500px', display: 'flex', flexDirection: 'column' }}>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-green-400 border-b border-white/10 pb-4">
            <MessageCircle size={24} /> Ask Follow-up Questions
          </h2>
          
          <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2 custom-scrollbar">
            {chatMessages.length === 0 ? (
               <div className="h-full flex flex-col items-center justify-center text-gray-500 opacity-50 space-y-3">
                 <Bot size={48} />
                 <p>Ask anything about the lecture!</p>
               </div>
            ) : (
               chatMessages.map((msg, idx) => (
                 <motion.div 
                   key={idx} 
                   initial={{ opacity: 0, y: 10 }}
                   animate={{ opacity: 1, y: 0 }}
                   className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                 >
                   {msg.role === 'assistant' && (
                     <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center shrink-0 border border-green-500/30 text-green-400">
                       <Bot size={16} />
                     </div>
                   )}
                   <div className={`p-4 rounded-2xl max-w-[80%] ${
                     msg.role === 'user' 
                       ? 'bg-blue-600 text-white rounded-tr-sm' 
                       : 'bg-gray-800 text-gray-200 rounded-tl-sm border border-white/5 whitespace-pre-wrap'
                   }`}>
                     {msg.role === 'assistant' ? (
                        <div className="prose prose-invert prose-sm max-w-none">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                     ) : (
                        msg.content
                     )}
                   </div>
                   {msg.role === 'user' && (
                     <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0 border border-blue-500/30 text-blue-400">
                       <User size={16} />
                     </div>
                   )}
                 </motion.div>
               ))
            )}
            {isChatLoading && (
               <div className="flex gap-3 justify-start">
                 <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center shrink-0 border border-green-500/30 text-green-400">
                   <Bot size={16} />
                 </div>
                 <div className="p-4 rounded-2xl bg-gray-800 text-gray-400 rounded-tl-sm border border-white/5 flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" /> Thinking step-by-step...
                 </div>
               </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={handleSendMessage} className="relative mt-auto">
            <input
               type="text"
               value={inputMessage}
               onChange={(e) => setInputMessage(e.target.value)}
               placeholder="Type your question here... e.g., 'Can you explain the difference between Narrow AI and General AI?'"
               className="w-full bg-gray-900 border border-gray-700 text-white rounded-xl py-4 pl-4 pr-12 focus:outline-none focus:border-blue-500 transition-colors placeholder:text-gray-600"
               disabled={isChatLoading}
            />
            <button 
               type="submit" 
               disabled={!inputMessage.trim() || isChatLoading}
               className="absolute right-2 top-1/2 -translate-y-1/2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:opacity-50 text-white p-2 rounded-lg transition-colors"
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
