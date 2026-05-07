import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
} from 'recharts';

const API = 'http://localhost:8000';

type Video = { id: string; filename: string; video_url?: string | null };
type Clip  = { category: string; emoji: string; start: number; end: number };
type Scores = { racing_line: number; braking: number; throttle: number; consistency: number };

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function parseTimestamps(text: string, onSeek: (t: number) => void) {
  const parts = text.split(/\b(\d{1,2}:\d{2})\b/);
  return parts.map((part, i) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(part);
    if (m) {
      const secs = parseInt(m[1]) * 60 + parseInt(m[2]);
      return (
        <button
          key={i}
          onClick={() => onSeek(secs)}
          className="font-mono font-bold hover:underline cursor-pointer"
          style={{ color: 'var(--accent-green)' }}
          title={`Jump to ${part}`}
        >
          ▶ {part}
        </button>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function ResultPanel({ markdown, onSeek }: { markdown: string; onSeek: (t: number) => void }) {
  const lines = markdown.split('\n');
  return (
    <div
      className="rounded-xl p-6 text-sm leading-relaxed overflow-auto"
      style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', maxHeight: '52vh' }}
    >
      {lines.map((line, i) => {
        if (line.startsWith('## '))
          return <h2 key={i} className="text-xl font-bold mb-4 mt-2">{parseTimestamps(line.slice(3), onSeek)}</h2>;
        if (line.startsWith('### '))
          return (
            <h3 key={i} className="text-base font-semibold mt-5 mb-2" style={{ color: 'var(--accent-green)' }}>
              {parseTimestamps(line.slice(4), onSeek)}
            </h3>
          );
        if (/^\|[-\s|]+\|$/.test(line)) return null;
        if (line.startsWith('|')) {
          const cells = line.split('|').filter(c => c.trim());
          return (
            <div
              key={i}
              className="grid gap-2 py-1 border-b"
              style={{ gridTemplateColumns: `repeat(${cells.length}, 1fr)`, borderColor: 'rgba(255,255,255,0.08)' }}
            >
              {cells.map((c, j) => (
                <span key={j} className="px-1 text-xs" style={{ color: j === 0 ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                  {parseTimestamps(c.trim(), onSeek)}
                </span>
              ))}
            </div>
          );
        }
        if (line.startsWith('**') && line.endsWith('**'))
          return <p key={i} className="font-semibold mt-4">{parseTimestamps(line.slice(2, -2), onSeek)}</p>;
        if (line.trim() === '') return <div key={i} className="h-2" />;
        if (line.startsWith('_') && line.endsWith('_'))
          return <p key={i} className="italic" style={{ color: 'var(--text-secondary)' }}>{parseTimestamps(line.slice(1, -1), onSeek)}</p>;
        return <p key={i} style={{ color: 'var(--text-secondary)' }}>{parseTimestamps(line, onSeek)}</p>;
      })}
    </div>
  );
}

function ClipGallery({ clips, onSeek }: { clips: Clip[]; onSeek: (t: number) => void }) {
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-secondary)' }}>
        Marengo found these moments — click to jump
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {clips.map((clip, i) => (
          <button
            key={i}
            onClick={() => onSeek(clip.start)}
            className="rounded-xl p-4 text-left transition-all hover:brightness-110"
            style={{ backgroundColor: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            <div className="text-2xl mb-2">{clip.emoji}</div>
            <div className="text-xs font-semibold mb-1">{clip.category}</div>
            <div className="text-xs font-mono" style={{ color: 'var(--accent-green)' }}>
              ▶ {fmtTime(clip.start)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ScoreRadar({ scores }: { scores: Scores }) {
  const data = [
    { metric: 'Racing Line', value: scores.racing_line },
    { metric: 'Braking',     value: scores.braking },
    { metric: 'Throttle',    value: scores.throttle },
    { metric: 'Consistency', value: scores.consistency },
  ];
  return (
    <div className="mt-4 rounded-xl p-5" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-secondary)' }}>
        Performance Radar
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <RadarChart data={data}>
          <PolarGrid stroke="rgba(255,255,255,0.1)" />
          <PolarAngleAxis dataKey="metric" tick={{ fill: '#888', fontSize: 11 }} />
          <Radar
            dataKey="value"
            fill="#00C851"
            fillOpacity={0.25}
            stroke="#00C851"
            strokeWidth={2}
          />
        </RadarChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-4 gap-2 mt-3">
        {data.map(d => (
          <div key={d.metric} className="text-center">
            <div className="text-lg font-bold" style={{ color: 'var(--accent-green)' }}>{d.value}</div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{d.metric}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const LOADING_MESSAGES: Record<string, string> = {
  errors:  'Pegasus is scanning every corner...',
  moments: 'Marengo is searching for your best moments...',
  ask:     'Pegasus is studying your lap...',
  report:  'Running Pegasus → Groq LLaMA pipeline (30–60s)...',
};

export function AnalyzePage({ onBack }: { onBack: () => void }) {
  const [videos, setVideos]           = useState<Video[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<string>('');
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState('');
  const [activeOp, setActiveOp]       = useState('');
  const [errorTypes, setErrorTypes]   = useState('all driving errors');
  const [question, setQuestion]       = useState('');
  const [focus, setFocus]             = useState('Full Analysis');
  const [fetchError, setFetchError]   = useState('');
  const [clips, setClips]             = useState<Clip[]>([]);
  const [scores, setScores]           = useState<Scores | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    fetch(`${API}/videos`)
      .then(r => r.json())
      .then(d => {
        setVideos(d.videos || []);
        if (d.videos?.length) setSelectedVideo(d.videos[0].id);
      })
      .catch(() => setFetchError('Could not reach backend. Make sure uvicorn is running on port 8000.'));
  }, []);

  function seekTo(seconds: number) {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play();
    }
  }

  const selectedVideoData = videos.find(v => v.id === selectedVideo);
  const videoUrl = selectedVideoData?.video_url ? `${API}${selectedVideoData.video_url}` : '';

  async function run(op: string) {
    if (!selectedVideo) return;
    setActiveOp(op);
    setLoading(true);
    setResult('');
    setClips([]);
    setScores(null);
    try {
      let res: Response;
      if (op === 'errors') {
        res = await fetch(`${API}/analyze/errors`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_id: selectedVideo, error_types: errorTypes }),
        });
      } else if (op === 'moments') {
        res = await fetch(`${API}/analyze/best-moments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_id: selectedVideo }),
        });
      } else if (op === 'ask') {
        res = await fetch(`${API}/analyze/ask`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_id: selectedVideo, question }),
        });
      } else {
        res = await fetch(`${API}/analyze/coaching-report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_id: selectedVideo, focus }),
        });
      }
      const data = await res.json();
      if (res.status === 429) {
        setResult('⚠️ **Rate limit reached** — Twelve Labs API is limited to 50 requests/day. Please try again tomorrow.');
      } else {
        setResult(data.result || data.detail || 'No result returned.');
        if (data.clips)   setClips(data.clips);
        if (data.overall) setScores(data.overall as Scores);
      }
    } catch {
      setResult('Error contacting backend. Is uvicorn running?');
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen px-4 py-8" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="max-w-7xl mx-auto">

        <button
          onClick={onBack}
          className="flex items-center gap-2 mb-6 text-sm hover:opacity-80 transition-opacity"
          style={{ color: 'var(--text-secondary)' }}
        >
          <ArrowLeft size={16} /> Back to home
        </button>

        <h1 className="text-3xl font-bold mb-1">🏎️ Analyze Your Lap</h1>
        <p className="mb-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Select a video, choose an operator, and get instant AI coaching.
        </p>

        {fetchError && (
          <div className="rounded-lg p-4 mb-6 text-sm" style={{ backgroundColor: 'rgba(255,60,60,0.1)', color: '#ff6b6b', border: '1px solid rgba(255,60,60,0.3)' }}>
            ⚠️ {fetchError}
          </div>
        )}

        {/* Two-column layout */}
        <div className="flex gap-6 items-start flex-col lg:flex-row">

          {/* LEFT: Video player */}
          <div className="w-full lg:w-[40%] shrink-0 lg:sticky lg:top-8">
            <label className="block text-xs font-semibold mb-2 uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>
              Select Video
            </label>
            <div className="relative mb-3">
              <select
                value={selectedVideo}
                onChange={e => setSelectedVideo(e.target.value)}
                className="w-full px-4 py-3 rounded-lg appearance-none text-sm font-medium pr-10"
                style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                {videos.map(v => (
                  <option key={v.id} value={v.id}>{v.filename}</option>
                ))}
              </select>
              <ChevronDown size={16} className="absolute right-3 top-3.5 pointer-events-none" style={{ color: 'var(--text-secondary)' }} />
            </div>

            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                className="w-full rounded-xl"
                style={{ backgroundColor: '#000', maxHeight: '300px', objectFit: 'contain' }}
              />
            ) : (
              <div
                className="w-full rounded-xl flex items-center justify-center"
                style={{ backgroundColor: 'var(--bg-card)', height: '200px', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>No local video file found</p>
              </div>
            )}

            <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
              Click any{' '}
              <span className="font-mono font-bold" style={{ color: 'var(--accent-green)' }}>▶ timestamp</span>
              {' '}in the results to jump to that moment.
            </p>
          </div>

          {/* RIGHT: Operators + results */}
          <div className="w-full lg:flex-1">
            <div className="grid grid-cols-1 gap-3 mb-4">

              {/* Op 1 — Find Lap Errors */}
              <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <h3 className="font-semibold text-base">🔴 Find Lap Errors</h3>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Pegasus detects every mistake with timestamps</p>
                  </div>
                  <button
                    onClick={() => run('errors')}
                    disabled={loading || !selectedVideo}
                    className="px-4 py-2 rounded-lg text-sm font-semibold shrink-0 disabled:opacity-50 transition-all"
                    style={{ backgroundColor: 'var(--accent-green)', color: '#000' }}
                  >
                    {loading && activeOp === 'errors' ? '...' : 'Run'}
                  </button>
                </div>
                <input
                  value={errorTypes}
                  onChange={e => setErrorTypes(e.target.value)}
                  placeholder="Error types (e.g. missed apex, late braking)"
                  className="w-full px-3 py-2 rounded-lg text-xs"
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.08)' }}
                />
              </div>

              {/* Op 2 — Find Best Moments */}
              <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-base">🌟 Find Best Moments</h3>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Marengo semantic search finds your top driving moments</p>
                  </div>
                  <button
                    onClick={() => run('moments')}
                    disabled={loading || !selectedVideo}
                    className="px-4 py-2 rounded-lg text-sm font-semibold shrink-0 disabled:opacity-50 transition-all"
                    style={{ backgroundColor: 'var(--accent-green)', color: '#000' }}
                  >
                    {loading && activeOp === 'moments' ? '...' : 'Run'}
                  </button>
                </div>
              </div>

              {/* Op 3 — Ask About Lap */}
              <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <h3 className="font-semibold text-base">💬 Ask About This Lap</h3>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Pegasus answers any question with timestamped evidence</p>
                  </div>
                  <button
                    onClick={() => run('ask')}
                    disabled={loading || !selectedVideo || !question.trim()}
                    className="px-4 py-2 rounded-lg text-sm font-semibold shrink-0 disabled:opacity-50 transition-all"
                    style={{ backgroundColor: 'var(--accent-green)', color: '#000' }}
                  >
                    {loading && activeOp === 'ask' ? '...' : 'Ask'}
                  </button>
                </div>
                <input
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  placeholder="e.g. Was my racing line through Turn 3 correct?"
                  className="w-full px-3 py-2 rounded-lg text-xs"
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.08)' }}
                  onKeyDown={e => e.key === 'Enter' && run('ask')}
                />
              </div>

              {/* Op 4 — Coaching Report */}
              <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <h3 className="font-semibold text-base">📊 Generate Coaching Report</h3>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Pegasus → Groq LLaMA pipeline — 30–60s</p>
                  </div>
                  <button
                    onClick={() => run('report')}
                    disabled={loading || !selectedVideo}
                    className="px-4 py-2 rounded-lg text-sm font-semibold shrink-0 disabled:opacity-50 transition-all"
                    style={{ backgroundColor: 'var(--accent-green)', color: '#000' }}
                  >
                    {loading && activeOp === 'report' ? '...' : 'Run'}
                  </button>
                </div>
                <div className="relative">
                  <select
                    value={focus}
                    onChange={e => setFocus(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-xs appearance-none pr-8"
                    style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    <option>Full Analysis</option>
                    <option>Racing Line Only</option>
                    <option>Braking Only</option>
                    <option>Throttle &amp; Exit Only</option>
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-2.5 pointer-events-none" style={{ color: 'var(--text-secondary)' }} />
                </div>
              </div>
            </div>

            {/* Loading state */}
            {loading && (
              <div className="rounded-xl p-6 text-center text-sm mb-4" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-secondary)' }}>
                <div
                  className="animate-spin inline-block w-5 h-5 border-2 rounded-full mb-3"
                  style={{ borderColor: 'var(--accent-green)', borderTopColor: 'transparent' }}
                />
                <p>{LOADING_MESSAGES[activeOp] ?? 'AI is analyzing your lap...'}</p>
              </div>
            )}

            {/* Results */}
            {result && !loading && <ResultPanel markdown={result} onSeek={seekTo} />}
            {clips.length > 0 && !loading && <ClipGallery clips={clips} onSeek={seekTo} />}
            {scores && !loading && <ScoreRadar scores={scores} />}
          </div>
        </div>
      </div>
    </div>
  );
}
