import { useState, useEffect, useRef } from 'react';

const API = (import.meta.env.VITE_API_URL as string) ?? '';

const CLIP_START = 10;
const CLIP_END   = 20;
const DEMO_FILENAME = 'Lando Norris Helmet POV - LN Karts Australia.mp4';

type ErrorState = 'idle' | 'loading' | 'done' | 'error';

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function parseTimestamp(text: string): number | null {
  const m = text.match(/(\d+):(\d{2})/);
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null;
}

function ErrorTable({ markdown, onSeek }: { markdown: string; onSeek: (t: number) => void }) {
  const sections: { heading: string; rows: { time: string; error: string; impact: string }[] }[] = [];
  let current: typeof sections[0] | null = null;

  for (const line of markdown.split('\n')) {
    if (line.startsWith('### ')) {
      current = { heading: line.replace(/^###\s*/, ''), rows: [] };
      sections.push(current);
    } else if (current && line.startsWith('|') && !line.includes('---') && !line.toLowerCase().includes('time')) {
      const cells = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length >= 2) {
        current.rows.push({ time: cells[0], error: cells[1], impact: cells[2] ?? '' });
      }
    }
  }

  return (
    <div className="space-y-5">
      {sections.filter(s => s.rows.length > 0).map(s => (
        <div key={s.heading}>
          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.5)' }}>{s.heading}</p>
          <div className="space-y-1.5">
            {s.rows.map((r, i) => {
              const secs = parseTimestamp(r.time);
              return (
                <div key={i} className="flex items-start gap-3 rounded-lg px-3 py-2"
                  style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
                  <button
                    onClick={() => secs !== null && onSeek(secs)}
                    className="text-xs font-mono shrink-0 px-2 py-0.5 rounded transition-all hover:brightness-125"
                    style={{ backgroundColor: 'rgba(0,200,81,0.15)', color: 'var(--accent-green)' }}>
                    ▶ {r.time}
                  </button>
                  <div>
                    <p className="text-sm font-semibold">{r.error}</p>
                    {r.impact && <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{r.impact}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DemoShowcase() {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const [videoId, setVideoId]   = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [status, setStatus]     = useState<ErrorState>('idle');
  const [result, setResult]     = useState('');

  useEffect(() => {
    fetch(`${API}/videos?context=kart`)
      .then(r => r.json())
      .then(d => {
        const v = (d.videos ?? []).find((v: any) =>
          v.filename?.toLowerCase().includes('lando') || v.filename?.toLowerCase().includes('ln karts')
        );
        if (v) { setVideoId(v.id); setVideoUrl(v.video_url ?? null); }
      });
  }, []);

  const loopRef = useRef(true);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !videoUrl) return;
    loopRef.current = true;
    vid.currentTime = CLIP_START;
    const loop = () => { if (loopRef.current && vid.currentTime >= CLIP_END) vid.currentTime = CLIP_START; };
    vid.addEventListener('timeupdate', loop);
    vid.play().catch(() => {});
    return () => vid.removeEventListener('timeupdate', loop);
  }, [videoUrl]);

  async function runErrors() {
    if (!videoId || status === 'loading') return;
    setStatus('loading');
    setResult('');
    try {
      const res  = await fetch(`${API}/analyze/errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: videoId, context: 'kart', error_types: 'all driving errors' }),
      });
      const data = await res.json();
      if (!res.ok) { setStatus('error'); setResult(data.detail ?? 'Error'); return; }
      setStatus('done');
      setResult(data.result ?? '');
    } catch {
      setStatus('error');
      setResult('Network error — is the backend running?');
    }
  }

  function seekTo(secs: number) {
    if (videoRef.current) {
      loopRef.current = false;
      videoRef.current.currentTime = secs;
      videoRef.current.play();
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#0a0a0a', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-8 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <div className="flex items-center gap-2">
          <span>🏎️</span>
          <span className="font-bold text-sm">ApexAI</span>
          <span className="text-xs px-2 py-0.5 rounded-full ml-1" style={{ backgroundColor: 'rgba(0,200,81,0.12)', color: '#00c851', border: '1px solid rgba(0,200,81,0.25)' }}>Live Demo</span>
        </div>
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Powered by Twelve Labs Pegasus &amp; Marengo</p>
      </div>

      {/* Main: errors panel left | video center | spacer right */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: errors panel */}
        <div className="w-[340px] shrink-0 overflow-y-auto p-5 border-r" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-base">🔴</span>
            <span className="font-semibold text-sm">Driving Errors</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-mono" style={{ backgroundColor: 'rgba(255,60,60,0.12)', color: '#ff6b6b' }}>Pegasus</span>
          </div>

          {status === 'idle' && (
            <div className="flex flex-col items-center justify-center py-20 gap-2" style={{ color: 'rgba(255,255,255,0.25)' }}>
              <p className="text-3xl">🏁</p>
              <p className="text-xs text-center">Hit the button below the video to start</p>
            </div>
          )}
          {status === 'loading' && (
            <div className="flex flex-col items-center justify-center py-20 gap-2" style={{ color: 'rgba(255,255,255,0.4)' }}>
              <p className="text-2xl animate-spin">⚙️</p>
              <p className="text-xs">Pegasus is scanning every corner…</p>
            </div>
          )}
          {status === 'error' && (
            <div className="rounded-xl p-4" style={{ backgroundColor: 'rgba(255,60,60,0.1)', border: '1px solid rgba(255,60,60,0.2)' }}>
              <p className="text-sm text-red-400">{result}</p>
            </div>
          )}
          {status === 'done' && result && <ErrorTable markdown={result} onSeek={seekTo} />}
        </div>

        {/* Center: video */}
        <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8">
          <div className="w-full max-w-2xl rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
            {videoUrl ? (
              <video
                ref={videoRef}
                src={`${API}${videoUrl}`}
                muted
                playsInline
                className="w-full"
                style={{ display: 'block' }}
              />
            ) : (
              <div className="flex items-center justify-center h-64" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>Loading video…</p>
              </div>
            )}
          </div>

          <button
            onClick={runErrors}
            disabled={!videoId || status === 'loading'}
            className="px-8 py-3 rounded-xl font-semibold text-sm transition-all hover:brightness-110 disabled:opacity-40"
            style={{ backgroundColor: '#00c851', color: '#000' }}>
            {status === 'loading' ? '⏳ Analysing errors…' : '🔴 Analyse Driving Errors'}
          </button>
        </div>

      </div>
    </div>
  );
}
