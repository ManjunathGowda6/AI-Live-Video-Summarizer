'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { UploadCloud, File, CheckCircle } from 'lucide-react';

export default function UploadPage() {
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const [file, setFile] = useState<File | null>(null);

  const handleUpload = async () => {
    if (!file) return alert("Please select a file first");
    setIsUploading(true);
    
    // Simulating progress while we upload
    let current = 0;
    const interval = setInterval(() => {
      current += 10;
      setProgress(Math.min(current, 90)); // cap at 90 until done
    }, 500);

    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('http://localhost:8000/api/upload/', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      
      clearInterval(interval);
      
      if (data.status !== 'success') {
         alert(data.message || "Failed to upload");
         setIsUploading(false);
         setProgress(0);
         return;
      }
      
      setProgress(100);
      setTimeout(() => {
        router.push(`/results/${data.session_id}`);
      }, 800);
    } catch (e) {
      clearInterval(interval);
      alert("Failed to upload");
      setIsUploading(false);
      setProgress(0);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-8">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl glass-card p-10 flex flex-col items-center text-center"
      >
        <UploadCloud size={80} className="text-blue-500 mb-6" />
        <h1 className="text-4xl font-bold mb-4">Upload Lecture</h1>
        <p className="text-gray-400 mb-8 max-w-md">
          Upload audio or video for offline intelligence. We'll summarize core points, extract concepts, and generate Q&A.
        </p>

        {!isUploading ? (
          <div 
            className="w-full h-48 border-2 border-dashed border-gray-600 hover:border-blue-500 rounded-2xl flex flex-col items-center justify-center relative transition-colors bg-gray-900/50"
          >
            <input type="file" onChange={onFileChange} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" accept="video/*,audio/*" />
            <File size={40} className="text-gray-500 mb-4" />
            <p className="text-lg font-medium text-gray-300">
              {file ? file.name : "Drag & Drop or Click to Select File"}
            </p>
            <p className="text-sm text-gray-500 mt-2">MP4, MP3, WAV (Max 500MB)</p>
            {file && (
              <button onClick={handleUpload} className="mt-4 px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl relative z-20">
                Start Processing
              </button>
            )}
          </div>
        ) : (
          <div className="w-full space-y-4">
            <div className="flex justify-between items-center text-gray-300 font-medium">
              <span>{progress < 100 ? 'Processing...' : 'Complete!'}</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full h-4 bg-gray-800 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-blue-500"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
              />
            </div>
            {progress === 100 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center mt-6 text-green-400">
                 <CheckCircle size={48} className="mb-2" />
                 <span className="font-bold text-lg">Results Ready!</span>
              </motion.div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
