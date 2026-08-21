'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Square,
  Clock,
  Image as ImageIcon,
  Mic,
  Bot,
  User,
  Send,
  Loader2,
  MessageCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

// Backend URL
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function LiveSession() {
  const [isListening, setIsListening] = useState(false);
  const [timer, setTimer] = useState(0);
  const [targetDuration, setTargetDuration] = useState<number | null>(null);
  const [inputMinutes, setInputMinutes] = useState<string>('5');

  const [messages, setMessages] = useState<
    {
      id: string;
      type: 'topic' | 'explanation' | 'scanned';
      text: string;
      imageUrl?: string;
    }[]
  >([]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [isScreenShared, setIsScreenShared] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);

  // Chat State
  const [chatMessages, setChatMessages] = useState<
    { role: 'user' | 'assistant'; content: string }[]
  >([]);

  const [inputMessage, setInputMessage] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const transcriptBufferRef = useRef<string>('');
  const fullTranscriptRef = useRef<string>('');
  const interimTranscriptRef = useRef<string>('');
  const recognitionRef = useRef<any>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionActiveRef = useRef<boolean>(false);
  const lastFrameDataRef = useRef<Uint8ClampedArray | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const sessionContextRef = useRef<
    { type: string; content: string; time: number }[]
  >([]);

  const startTimeRef = useRef<number>(0);
  const lastCaptureTimeRef = useRef<number>(0);

  // 1-second session timer
  useEffect(() => {
    let timerInterval: any;

    if (isListening && targetDuration !== null) {
      timerInterval = setInterval(() => {
        setTimer((prev) => {
          if (prev + 1 >= targetDuration) {
            clearInterval(timerInterval);
            endSession(true);
            return targetDuration;
          }

          return prev + 1;
        });
      }, 1000);
    }

    return () => clearInterval(timerInterval);
  }, [isListening, targetDuration]);

  // Multimodal background capture interval
  useEffect(() => {
    let captureInterval: any;

    if (isListening) {
      captureInterval = setInterval(() => {
        if (sessionActiveRef.current) {
          const newFinalChunk = transcriptBufferRef.current.trim();

          transcriptBufferRef.current = '';

          let structuredTranscript: string | undefined = undefined;

          if (newFinalChunk.length > 0) {
            const currentFull = fullTranscriptRef.current.trim();
            let previousSpeechOnly = '';

            if (currentFull.endsWith(newFinalChunk)) {
              previousSpeechOnly = currentFull
                .substring(0, currentFull.length - newFinalChunk.length)
                .trim();
            } else {
              previousSpeechOnly = currentFull;
            }

            if (previousSpeechOnly.length > 0) {
              const recentPrev = previousSpeechOnly.slice(-600);

              structuredTranscript = `[Previous Context]: ${recentPrev}\n[New Audio]: ${newFinalChunk}`;
            } else {
              structuredTranscript = `[New Audio]: ${newFinalChunk}`;
            }

            sessionContextRef.current.push({
              type: 'voice',
              content: newFinalChunk,
              time: Date.now(),
            });
          }

          let shouldProcess = newFinalChunk.length > 0;

          const timeSinceLastCapture =
            Date.now() - lastCaptureTimeRef.current;

          const hasNoExplanationsYet =
            !sessionContextRef.current.some(
              (e) => e.type === 'ai_explanation'
            );

          if (videoRef.current) {
            const { diff, data } = getPixelDiff(
              videoRef.current,
              lastFrameDataRef.current
            );

            if (
              newFinalChunk.length > 0 ||
              diff > 1.0 ||
              !lastFrameDataRef.current ||
              timeSinceLastCapture > 10000 ||
              hasNoExplanationsYet
            ) {
              lastFrameDataRef.current = data;
              shouldProcess = true;
            }
          }

          if (shouldProcess) {
            lastCaptureTimeRef.current = Date.now();

            captureAndProcessMultimodal(
              structuredTranscript || undefined
            );
          }
        }
      }, 8000);
    }

    return () => clearInterval(captureInterval);
  }, [isListening]);

  const getPixelDiff = (
    video: HTMLVideoElement,
    lastData: Uint8ClampedArray | null
  ) => {
    if (
      video.readyState < 2 ||
      video.videoWidth === 0
    ) {
      return { diff: 0, data: null };
    }

    const canvas = document.createElement('canvas');

    canvas.width = 64;
    canvas.height = 64;

    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return { diff: 0, data: null };
    }

    ctx.drawImage(video, 0, 0, 64, 64);

    const data = ctx.getImageData(0, 0, 64, 64).data;

    if (!lastData) {
      return { diff: 100, data };
    }

    let diff = 0;

    for (let i = 0; i < data.length; i += 4) {
      diff += Math.abs(data[i] - lastData[i]);
      diff += Math.abs(data[i + 1] - lastData[i + 1]);
      diff += Math.abs(data[i + 2] - lastData[i + 2]);
    }

    const diffPercent =
      (diff / (64 * 64 * 3 * 255)) * 100;

    return {
      diff: diffPercent,
      data,
    };
  };

  const captureAndProcessMultimodal = (
    transcript?: string
  ) => {
    if (!videoRef.current || !isScreenShared) {
      if (transcript) {
        processMultimodalChunk(null, transcript);
      }

      return;
    }

    const video = videoRef.current;

    if (
      video.readyState < 2 ||
      video.videoWidth === 0
    ) {
      console.log(
        'Video stream not fully ready, skipping frame extraction.'
      );

      if (transcript) {
        processMultimodalChunk(null, transcript);
      }

      return;
    }

    const fullCanvas = document.createElement('canvas');

    fullCanvas.width = video.videoWidth;
    fullCanvas.height = video.videoHeight;

    const fctx = fullCanvas.getContext('2d');

    if (!fctx) return;

    fctx.drawImage(
      video,
      0,
      0,
      fullCanvas.width,
      fullCanvas.height
    );

    const imgData = fctx.getImageData(
      0,
      0,
      fullCanvas.width,
      fullCanvas.height
    ).data;

    let blackCount = 0;
    let totalSamples = 0;

    for (let i = 0; i < imgData.length; i += 40) {
      if (
        imgData[i] < 3 &&
        imgData[i + 1] < 3 &&
        imgData[i + 2] < 3
      ) {
        blackCount++;
      }

      totalSamples++;
    }

    if (
      totalSamples > 0 &&
      blackCount / totalSamples > 0.98
    ) {
      console.log(
        'Captured frame is completely black. Skipping AI send.'
      );

      sessionContextRef.current.push({
        type: 'system',
        content: '[Screen completely blank/dark]',
        time: Date.now(),
      });

      if (transcript) {
        processMultimodalChunk(null, transcript);
      }

      return;
    }

    fullCanvas.toBlob(
      (blob) => {
        processMultimodalChunk(blob, transcript);
      },
      'image/jpeg',
      0.95
    );
  };

  const processMultimodalChunk = async (
    blob: Blob | null,
    transcript?: string
  ) => {
    setIsProcessing(true);

    const imageUrl = blob
      ? URL.createObjectURL(blob)
      : undefined;

    const msgId = crypto.randomUUID();

    let contextMsg =
      'Analyzing new screen context...';

    if (blob && transcript) {
      contextMsg = `Heard: "${transcript}" + Vision Captured`;
    } else if (transcript) {
      contextMsg = `Heard: "${transcript}"`;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: msgId,
        type: 'scanned',
        text: contextMsg,
        imageUrl,
      },
    ]);

    try {
      const formData = new FormData();

      formData.append(
        'session_id',
        sessionIdRef.current ||
          'live-session-' + Date.now()
      );

      if (blob) {
        formData.append(
          'image',
          blob,
          'frame.jpg'
        );
      }

      if (transcript) {
        formData.append(
          'transcript',
          transcript
        );
      }

      // CONNECTED TO RENDER BACKEND
      const response = await fetch(
        `${API_BASE_URL}/api/chat/process-multimodal`,
        {
          method: 'POST',
          body: formData,
        }
      );

      if (!response.ok) {
        throw new Error(
          'Failed to process multimodal API'
        );
      }

      const data = await response.json();

      if (data.explanation) {
        sessionContextRef.current.push({
          type: 'ai_explanation',
          content: data.explanation,
          time: Date.now(),
        });
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                type: 'explanation',
                text: data.explanation,
              }
            : m
        )
      );
    } catch (error) {
      console.error(error);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                type: 'explanation',
                text: 'Failed to generate visual explanation. Check backend API keys.',
              }
            : m
        )
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const [liveTranscript, setLiveTranscript] =
    useState<string>('');

  const endSession = async (
    timeUp = false
  ) => {
    if (!sessionActiveRef.current) return;

    sessionActiveRef.current = false;

    setIsListening(false);
    setTargetDuration(null);

    lastFrameDataRef.current = null;

    let finalFrameDataUrl: string | undefined =
      undefined;

    if (
      videoRef.current &&
      isScreenShared
    ) {
      try {
        const video = videoRef.current;

        if (
          video.readyState >= 2 &&
          video.videoWidth > 0
        ) {
          const canvas =
            document.createElement('canvas');

          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;

          const ctx =
            canvas.getContext('2d');

          if (ctx) {
            ctx.drawImage(
              video,
              0,
              0,
              canvas.width,
              canvas.height
            );

            finalFrameDataUrl =
              canvas.toDataURL(
                'image/jpeg',
                0.85
              );
          }
        }
      } catch (e) {
        console.error(
          'Screen snapshot capture error:',
          e
        );
      }
    }

    if (streamRef.current) {
      streamRef.current
        .getTracks()
        .forEach((track) =>
          track.stop()
        );

      streamRef.current = null;
    }

    if (recognitionRef.current) {
      recognitionRef.current.onend = null;

      recognitionRef.current.stop();

      recognitionRef.current = null;
    }

    setIsScreenShared(false);

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    if (timeUp) {
      setMessages((prev) => {
        if (
          prev.some((m) =>
            m.text.includes('Time Up!')
          )
        ) {
          return prev;
        }

        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            type: 'topic',
            text: 'Time Up! Session Finished. Generating Detailed Summary...',
          },
        ];
      });
    } else {
      setMessages((prev) => {
        if (
          prev.some((m) =>
            m.text.includes('Session Stopped')
          )
        ) {
          return prev;
        }

        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            type: 'topic',
            text: 'Session Stopped. Generating Detailed Summary...',
          },
        ];
      });
    }

    const sid = sessionIdRef.current;

    if (sid) {
      const sessionDurationSeconds =
        Math.round(
          (Date.now() -
            startTimeRef.current) /
            1000
        );

      setIsProcessing(true);

      try {
        let explanationsOnly =
          sessionContextRef.current
            .filter(
              (e) =>
                e.type === 'ai_explanation' ||
                e.type === 'vision_analysis' ||
                e.type === 'voice'
            )
            .map((e) =>
              e.type === 'voice'
                ? `[Voice Transcript]: ${e.content}`
                : e.content
            )
            .join('\n\n');

        if (!explanationsOnly.trim()) {
          explanationsOnly =
            sessionContextRef.current
              .map((e) => e.content)
              .filter(Boolean)
              .join('\n\n');
        }

        // CONNECTED TO RENDER BACKEND
        const res = await fetch(
          `${API_BASE_URL}/api/chat/session-summary`,
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify({
              session_id: sid,
              events:
                sessionContextRef.current,
              ai_explanations:
                explanationsOnly,
              full_transcript:
                fullTranscriptRef.current,
              image_data:
                finalFrameDataUrl,
              session_length_seconds:
                sessionDurationSeconds,
            }),
          }
        );

        const data = await res.json();

        if (data && data.summary) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              type: 'explanation',
              text: data.summary,
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              type: 'explanation',
              text: '### Session Summary\n\nSession completed successfully.',
            },
          ]);
        }

        setSessionEnded(true);
      } catch (e) {
        console.error(
          'Summary error:',
          e
        );

        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            type: 'explanation',
            text: '### Session Summary\n\nSession completed.',
          },
        ]);

        setSessionEnded(true);
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const startSession = async () => {
    const durationMinutes =
      parseFloat(inputMinutes);

    if (
      isNaN(durationMinutes) ||
      durationMinutes <= 0
    ) {
      alert(
        'Please enter a valid number of minutes greater than 0.'
      );

      return;
    }

    try {
      const stream =
        await navigator.mediaDevices.getDisplayMedia(
          {
            video: {
              displaySurface: 'monitor',
            },
            audio: true,
          }
        );

      streamRef.current = stream;

      setIsScreenShared(true);

      if (videoRef.current) {
        videoRef.current.srcObject =
          stream;
      }

      stream.getVideoTracks()[0].onended =
        () => {
          endSession(false);
        };
    } catch (err: any) {
      if (
        err?.name ===
        'NotAllowedError'
      ) {
        console.log(
          'Screen share cancelled by user.'
        );

        return;
      }

      console.error(
        'Screen share permission denied',
        err
      );

      alert(
        'Screen sharing permission is required to start the session.'
      );

      return;
    }

    setTargetDuration(
      durationMinutes * 60
    );

    setTimer(0);

    lastFrameDataRef.current = null;

    sessionIdRef.current =
      crypto.randomUUID();

    sessionContextRef.current = [];

    transcriptBufferRef.current = '';

    fullTranscriptRef.current = '';

    setLiveTranscript('');

    setChatMessages([]);

    setSessionEnded(false);

    startTimeRef.current =
      Date.now();

    setMessages([
      {
        id: crypto.randomUUID(),
        type: 'topic',
        text: `Multimodal Session started for ${durationMinutes} min. AI is listening and watching...`,
      },
    ]);

    sessionActiveRef.current = true;

    setIsListening(true);

    const SpeechRecognitionPlugin =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (SpeechRecognitionPlugin) {
      const recognition =
        new SpeechRecognitionPlugin();

      recognition.continuous = true;

      recognition.interimResults = true;

      recognition.lang = 'en-US';

      recognition.onresult = (
        event: any
      ) => {
        if (
          !sessionActiveRef.current
        ) {
          return;
        }

        let interimStr = '';
        let finalStr = '';

        for (
          let i = event.resultIndex;
          i < event.results.length;
          i++
        ) {
          const speechResult =
            event.results[i][0];

          if (
            event.results[i].isFinal
          ) {
            finalStr +=
              speechResult.transcript +
              ' ';
          } else {
            interimStr +=
              speechResult.transcript;
          }
        }

        if (
          finalStr.trim().length > 0
        ) {
          transcriptBufferRef.current +=
            finalStr;

          fullTranscriptRef.current +=
            finalStr;

          setLiveTranscript(
            (prev) =>
              prev +
              (prev ? ' ' : '') +
              finalStr.trim()
          );
        }

        interimTranscriptRef.current =
          interimStr;
      };

      recognition.onerror = (
        event: any
      ) => {
        if (
          event.error ===
          'no-speech'
        ) {
          return;
        }

        console.error(
          'Speech recognition error',
          event.error
        );
      };

      recognition.onend = () => {
        if (
          sessionActiveRef.current &&
          recognitionRef.current
        ) {
          try {
            recognition.start();
          } catch (e) {}
        }
      };

      recognitionRef.current =
        recognition;

      recognition.start();
    } else {
      console.warn(
        'Speech recognition not supported, falling back to screen-only.'
      );
    }

    setTimeout(() => {
      if (
        sessionActiveRef.current
      ) {
        captureAndProcessMultimodal();
      }
    }, 2000);
  };

  const formatTime = (
    seconds: number
  ) => {
    const mins = Math.floor(
      seconds / 60
    );

    const secs = seconds % 60;

    return `${mins
      .toString()
      .padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView(
      {
        behavior: 'smooth',
      }
    );
  }, [chatMessages]);

  const handleSendMessage = async (
    e?: React.FormEvent
  ) => {
    if (e) {
      e.preventDefault();
    }

    if (
      !inputMessage.trim() ||
      isChatLoading
    ) {
      return;
    }

    const newMessages = [
      ...chatMessages,
      {
        role: 'user' as const,
        content: inputMessage,
      },
    ];

    let apiMessages =
      newMessages;

    if (chatMessages.length === 0) {
      const allContext =
        sessionContextRef.current
          .map(
            (ev) =>
              `[${ev.type.toUpperCase()}] ${ev.content}`
          )
          .join('\n');

      apiMessages = [
        {
          role: 'user' as const,
          content: `Context from session:\n${allContext}\n\nUser Question: ${inputMessage}`,
        },
      ];
    } else {
      apiMessages = newMessages;
    }

    setChatMessages(
      newMessages
    );

    setInputMessage('');

    setIsChatLoading(true);

    try {
      // CONNECTED TO RENDER BACKEND
      const res = await fetch(
        `${API_BASE_URL}/api/chat/ask`,
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            session_id:
              sessionIdRef.current,
            messages: apiMessages,
          }),
        }
      );

      const result =
        await res.json();

      if (
        result.status ===
        'success'
      ) {
        setChatMessages([
          ...newMessages,
          {
            role: 'assistant',
            content:
              result.answer,
          },
        ]);
      } else {
        setChatMessages([
          ...newMessages,
          {
            role: 'assistant',
            content:
              'Error processing request.',
          },
        ]);
      }
    } catch (err) {
      console.error(err);

      setChatMessages([
        ...newMessages,
        {
          role: 'assistant',
          content:
            'Network error occurred.',
        },
      ]);
    }

    setIsChatLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center p-8">
      <div
        className={`w-full ${
          isScreenShared
            ? 'max-w-6xl'
            : 'max-w-4xl'
        } transition-all duration-300 flex justify-between items-center mb-8 glass-card p-6`}
      >
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-500">
            Vision AI Teacher
          </h1>

          <p className="text-gray-400 mt-1">
            Real-time visual context &
            coding breakdown
          </p>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-2xl font-mono text-gray-300">
            <Clock size={24} />

            {formatTime(timer)}

            {targetDuration && (
              <span className="text-sm text-gray-500 ml-1">
                /{' '}
                {formatTime(
                  targetDuration
                )}
              </span>
            )}
          </div>

          <div className="flex gap-4">
            {isListening ? (
              <button
                onClick={() =>
                  endSession(false)
                }
                className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all shadow-lg bg-red-600 hover:bg-red-500 shadow-red-500/20"
              >
                <Square size={20} />
                Stop Session
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <div className="relative flex items-center bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 focus-within:ring-2 focus-within:ring-emerald-500 transition">
                  <input
                    type="number"
                    value={inputMinutes}
                    onChange={(e) =>
                      setInputMinutes(
                        e.target.value
                      )
                    }
                    placeholder="Minutes"
                    className="bg-transparent w-16 focus:outline-none text-white appearance-none"
                    min="0.1"
                    step="0.1"
                  />

                  <span className="text-gray-500 text-sm pointer-events-none">
                    min
                  </span>
                </div>

                <button
                  onClick={
                    startSession
                  }
                  disabled={
                    isProcessing
                  }
                  className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all shadow-lg bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Mic size={20} />
                  Start Assistant
                  Session
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className={`w-full ${
          isScreenShared
            ? 'max-w-7xl'
            : 'max-w-4xl'
        } flex-1 flex flex-col md:flex-row gap-6 transition-all duration-300`}
      >
        {isScreenShared && (
          <div className="w-full md:w-1/2 glass-card p-4 flex flex-col h-full animate-in fade-in slide-in-from-left-4">
            <div className="flex items-center gap-2 mb-4 text-emerald-400">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />

              <h2 className="text-sm font-semibold uppercase tracking-widest">
                Live Screen
              </h2>
            </div>

            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full rounded-xl bg-black border border-gray-700 shadow-xl flex-1 object-contain"
            />
          </div>
        )}

        <div
          className={`glass-card p-6 overflow-y-auto space-y-6 flex flex-col ${
            isScreenShared
              ? 'w-full md:w-1/2'
              : 'w-full'
          } h-full transition-all duration-300`}
        >
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 opacity-50">
              <ImageIcon
                size={64}
                className="mb-4"
              />

              <p className="text-xl">
                Set duration and start
                session to begin
                continuous visual
                analysis...
              </p>
            </div>
          ) : (
            <AnimatePresence>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{
                    opacity: 0,
                    y: 20,
                  }}
                  animate={{
                    opacity: 1,
                    y: 0,
                  }}
                  className={`p-4 xl:p-5 rounded-xl max-w-[95%] ${
                    msg.type === 'topic'
                      ? 'bg-blue-900/40 border border-blue-700 self-center text-center max-w-[85%]'
                      : msg.type ===
                        'explanation'
                      ? 'bg-indigo-900/40 border border-indigo-700 self-start shadow-xl shadow-indigo-900/20 max-w-[85%]'
                      : 'bg-gray-800/80 border border-gray-700 self-start'
                  }`}
                >
                  {msg.type ===
                    'topic' && (
                    <span className="text-blue-400 font-bold uppercase text-xs tracking-wider block mb-2">
                      System
                    </span>
                  )}

                  {msg.type ===
                    'scanned' && (
                    <span className="text-emerald-400 font-bold uppercase text-[10px] tracking-wider block mb-2 flex items-center gap-2">
                      <ImageIcon
                        size={12}
                      />
                      Snapshot Captured
                    </span>
                  )}

                  {msg.type ===
                    'explanation' && (
                    <span className="text-indigo-400 font-bold uppercase text-[10px] tracking-wider block mb-2">
                      AI Explanation
                    </span>
                  )}

                  {msg.imageUrl && (
                    <img
                      src={msg.imageUrl}
                      alt="Frame Capture"
                      className="rounded-lg shadow-md mb-3 max-w-full h-auto border border-gray-600 max-h-48 object-contain"
                    />
                  )}

                  <div className="prose prose-invert max-w-none text-base md:text-lg leading-relaxed">
                    <ReactMarkdown>
                      {msg.text}
                    </ReactMarkdown>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          )}

          {/* Real-time Live Transcript Side Panel */}
          <div className="glass-card p-6 bg-gradient-to-br from-indigo-900/40 to-purple-900/40 border-indigo-500/30 flex flex-col mt-4">
            <h2 className="text-lg font-bold mb-3 flex items-center gap-2 text-purple-400">
              <Mic size={20} />
              Live Speech Transcript
            </h2>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar text-sm text-gray-300 space-y-2 max-h-[200px]">
              {liveTranscript ? (
                <p className="leading-relaxed whitespace-pre-wrap">
                  {liveTranscript}
                </p>
              ) : isListening ? (
                <p className="text-gray-500 italic animate-pulse">
                  Listening to voice and
                  transcribing live lecture
                  stream...
                </p>
              ) : (
                <p className="text-gray-500 italic">
                  Live transcript will
                  display here word-for-word
                  as spoken...
                </p>
              )}
            </div>
          </div>

          {isProcessing && (
            <motion.div
              initial={{
                opacity: 0,
                scale: 0.9,
              }}
              animate={{
                opacity: 1,
                scale: 1,
              }}
              className="p-4 rounded-xl bg-gray-800/50 border border-gray-700 self-center text-center flex items-center gap-3 mt-4"
            >
              <span className="text-gray-400 text-sm font-medium">
                {!sessionActiveRef.current
                  ? 'Generating detailed summary...'
                  : 'Analyzing visual context...'}
              </span>

              <div className="flex items-center gap-1">
                <div
                  className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"
                  style={{
                    animationDelay:
                      '0ms',
                  }}
                />

                <div
                  className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"
                  style={{
                    animationDelay:
                      '150ms',
                  }}
                />

                <div
                  className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"
                  style={{
                    animationDelay:
                      '300ms',
                  }}
                />
              </div>
            </motion.div>
          )}

          {sessionEnded && (
            <motion.div
              initial={{
                opacity: 0,
                y: 20,
              }}
              animate={{
                opacity: 1,
                y: 0,
              }}
              className="glass-card flex flex-col mt-4 border border-indigo-500/30 w-full"
              style={{
                minHeight: '400px',
                maxHeight: '500px',
              }}
            >
              <h2 className="text-lg font-bold p-4 border-b border-white/10 flex items-center gap-2 text-indigo-400 shrink-0">
                <MessageCircle
                  size={20}
                />
                Ask Follow-up Questions
              </h2>

              <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {chatMessages.length ===
                0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-gray-500 opacity-50 space-y-2">
                    <Bot size={40} />

                    <p className="text-sm">
                      Ask anything about the
                      completed session.
                    </p>
                  </div>
                ) : (
                  chatMessages.map(
                    (msg, idx) => (
                      <motion.div
                        key={idx}
                        initial={{
                          opacity: 0,
                          y: 10,
                        }}
                        animate={{
                          opacity: 1,
                          y: 0,
                        }}
                        className={`flex gap-3 ${
                          msg.role ===
                          'user'
                            ? 'justify-end'
                            : 'justify-start'
                        }`}
                      >
                        {msg.role ===
                          'assistant' && (
                          <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0 border border-indigo-500/30 text-indigo-400">
                            <Bot
                              size={16}
                            />
                          </div>
                        )}

                        <div
                          className={`p-3 rounded-2xl max-w-[80%] text-sm md:text-base ${
                            msg.role ===
                            'user'
                              ? 'bg-emerald-600 text-white rounded-tr-sm'
                              : 'bg-gray-800 text-gray-200 rounded-tl-sm border border-white/5 whitespace-pre-wrap'
                          }`}
                        >
                          {msg.role ===
                          'assistant' ? (
                            <div className="prose prose-invert prose-sm max-w-none">
                              <ReactMarkdown>
                                {
                                  msg.content
                                }
                              </ReactMarkdown>
                            </div>
                          ) : (
                            msg.content
                          )}
                        </div>

                        {msg.role ===
                          'user' && (
                          <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0 border border-emerald-500/30 text-emerald-400">
                            <User
                              size={16}
                            />
                          </div>
                        )}
                      </motion.div>
                    )
                  )
                )}

                {isChatLoading && (
                  <div className="flex gap-3 justify-start">
                    <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0 border border-indigo-500/30 text-indigo-400">
                      <Bot size={16} />
                    </div>

                    <div className="p-3 rounded-2xl bg-gray-800 text-gray-400 rounded-tl-sm border border-white/5 flex items-center gap-2 text-sm">
                      <Loader2
                        size={16}
                        className="animate-spin"
                      />
                      Thinking...
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>

              <form
                onSubmit={
                  handleSendMessage
                }
                className="relative p-4 border-t border-white/10 shrink-0"
              >
                <input
                  type="text"
                  value={
                    inputMessage
                  }
                  onChange={(e) =>
                    setInputMessage(
                      e.target.value
                    )
                  }
                  placeholder="Ask a question about this session..."
                  className="w-full bg-gray-900 border border-gray-700 text-white rounded-xl py-3 pl-4 pr-12 focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-gray-600 text-sm md:text-base"
                  disabled={
                    isChatLoading
                  }
                />

                <button
                  type="submit"
                  disabled={
                    !inputMessage.trim() ||
                    isChatLoading
                  }
                  className="absolute right-6 top-1/2 -translate-y-1/2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:opacity-50 text-white p-2 rounded-lg transition-colors"
                >
                  <Send size={16} />
                </button>
              </form>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
