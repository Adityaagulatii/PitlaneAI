import { useState, useEffect, useRef, KeyboardEvent, DragEvent } from 'react';
import { ArrowLeft, Send, ChevronDown, Upload } from 'lucide-react';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts';

const API = (import.meta.env.VITE_API_URL as string) ?? '';

type Phase   = 'landing' | 'mode' | 'select' | 'analyze';
type Context = 'kart' | 'f1_sim';
type Video   = { id: string; filename: string; video_url?: string | null; thumbnail_url?: string | null };
type Clip    = { category: string; emoji: string; start: number; end: number };
type Lap     = { lap_num: number; start: number; lap_time: string; delta: string; key_issue: string; is_best: boolean };
type Scores  = { racing_line: number; braking: number; throttle: number; consistency: number };
type StyleTag    = { label: string; emoji: string; sentiment: 'positive' | 'negative' | 'neutral' };
type DriverStyle = { archetype: string; tags: StyleTag[] };
type AnalysisState = { status: 'loading' | 'done' | 'error'; result: string; clips?: Clip[]; error_clips?: {start: number; end: number}[]; pegasus_text?: string; laps?: Lap[]; scores?: Scores; driver_style?: DriverStyle };
type Marker = { secs: number; type: 'error' | 'moment' };

function fmtTime(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function shortName(filename: string) {
  return filename.replace(/\.mp4$/i, '').replace(/[^\x00-\x7F]/g, '').trim().slice(0, 42) || filename.slice(0, 42);
}

function parseTimestamps(text: string, onSeek: (t: number) => void): React.ReactNode[] {
  return text.split(/\b(\d{1,2}:\d{2})\b/).map((part, i) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(part);
    if (m) {
      const secs = +m[1] * 60 + +m[2];
      return (
        <button key={i} onClick={() => onSeek(secs)}
          className="font-mono font-bold hover:underline"
          style={{ color: 'var(--accent-green)' }} title={`Jump to ${part}`}>
          ▶ {part}
        </button>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function extractMarkers(errorClips: {start: number}[], clips: Clip[], pegasusText = ''): Marker[] {
  const markers: Marker[] = [];
  const seen = new Set<string>();
  // Marengo clips first (precise), then parse Pegasus timestamps as fallback/supplement
  const errorSecs = [
    ...errorClips.map(c => c.start),
    ...(pegasusText ? [...pegasusText.matchAll(/\b(\d{1,2}):(\d{2})\b/g)].map(m => +m[1] * 60 + +m[2]) : []),
  ];
  errorSecs.forEach(secs => {
    const key = `e:${Math.floor(secs)}`;
    if (!seen.has(key)) { seen.add(key); markers.push({ secs, type: 'error' }); }
  });
  clips.forEach(c => {
    const key = `g:${Math.floor(c.start)}`;
    if (!seen.has(key)) { seen.add(key); markers.push({ secs: c.start, type: 'moment' }); }
  });
  return markers;
}

function ResultBody({ markdown, onSeek }: { markdown: string; onSeek: (t: number) => void }) {
  return (
    <div className="text-xs leading-relaxed overflow-auto" style={{ maxHeight: '28vh', color: 'var(--text-secondary)' }}>
      {markdown.split('\n').map((line, i) => {
        if (line.startsWith('## '))  return <p key={i} className="font-bold text-sm mb-2 mt-1" style={{ color: 'var(--text-primary)' }}>{parseTimestamps(line.slice(3), onSeek)}</p>;
        if (line.startsWith('### ')) return <p key={i} className="font-semibold mt-3 mb-1" style={{ color: 'var(--accent-green)' }}>{parseTimestamps(line.slice(4), onSeek)}</p>;
        if (/^\|[-\s|]+\|$/.test(line)) return null;
        if (line.startsWith('|')) {
          const cells = line.split('|').filter(c => c.trim());
          return (
            <div key={i} className="grid gap-2 py-0.5 border-b" style={{ gridTemplateColumns: `repeat(${cells.length}, 1fr)`, borderColor: 'rgba(255,255,255,0.06)' }}>
              {cells.map((c, j) => (
                <span key={j} className="px-1" style={{ color: j === 0 ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                  {parseTimestamps(c.trim(), onSeek)}
                </span>
              ))}
            </div>
          );
        }
        if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="font-semibold mt-2" style={{ color: 'var(--text-primary)' }}>{parseTimestamps(line.slice(2, -2), onSeek)}</p>;
        if (line.trim() === '') return <div key={i} className="h-1.5" />;
        return <p key={i}>{parseTimestamps(line, onSeek)}</p>;
      })}
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-4">
      <div className="w-4 h-4 rounded-full border-2 animate-spin shrink-0"
        style={{ borderColor: 'var(--accent-green)', borderTopColor: 'transparent' }} />
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-mono"
      style={{ backgroundColor: 'rgba(0,200,81,0.12)', color: 'var(--accent-green)', border: '1px solid rgba(0,200,81,0.25)' }}>
      {label}
    </span>
  );
}

function ClipRow({ clips, onSeek }: { clips: Clip[]; onSeek: (t: number) => void }) {
  return (
    <div className="flex gap-2 flex-wrap mt-3">
      {clips.map((c, i) => (
        <button key={i} onClick={() => onSeek(c.start)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all hover:brightness-110"
          style={{ backgroundColor: 'rgba(0,200,81,0.1)', border: '1px solid rgba(0,200,81,0.2)', color: 'var(--text-primary)' }}>
          <span>{c.emoji}</span>
          <span className="font-medium">{c.category}</span>
          <span className="font-mono" style={{ color: 'var(--accent-green)' }}>▶ {fmtTime(c.start)}</span>
        </button>
      ))}
    </div>
  );
}

function RadarScore({ scores }: { scores: Scores }) {
  const data = [
    { m: 'Racing Line', v: scores.racing_line },
    { m: 'Braking',     v: scores.braking },
    { m: 'Throttle',    v: scores.throttle },
    { m: 'Consistency', v: scores.consistency },
  ];
  return (
    <div className="mt-3 flex gap-4 items-center">
      <div style={{ width: 140, height: 130 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data}>
            <PolarGrid stroke="rgba(255,255,255,0.08)" />
            <PolarAngleAxis dataKey="m" tick={{ fill: '#666', fontSize: 9 }} />
            <Radar dataKey="v" fill="#00C851" fillOpacity={0.25} stroke="#00C851" strokeWidth={1.5} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {data.map(d => (
          <div key={d.m}>
            <span className="text-lg font-bold" style={{ color: 'var(--accent-green)' }}>{d.v}</span>
            <span className="text-xs ml-1" style={{ color: 'var(--text-secondary)' }}>{d.m}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SENTIMENT_STYLE = {
  positive: { bg: 'rgba(0,200,81,0.12)',  border: 'rgba(0,200,81,0.3)',  color: '#00C851' },
  negative: { bg: 'rgba(255,60,60,0.10)', border: 'rgba(255,60,60,0.3)', color: '#ff6b6b' },
  neutral:  { bg: 'rgba(255,187,51,0.10)',border: 'rgba(255,187,51,0.3)',color: '#ffbb33' },
};

function DriverStyleCard({ style }: { style: DriverStyle }) {
  return (
    <div className="mt-4 rounded-xl p-4" style={{ backgroundColor: 'rgba(0,200,81,0.05)', border: '1px solid rgba(0,200,81,0.15)' }}>
      <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-secondary)' }}>Driver Archetype</p>
      <p className="text-xl font-bold mb-3" style={{ color: 'var(--text-primary)' }}>{style.archetype}</p>
      <div className="flex flex-wrap gap-2">
        {style.tags.map((tag, i) => {
          const s = SENTIMENT_STYLE[tag.sentiment] ?? SENTIMENT_STYLE.neutral;
          return (
            <span key={i} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
              style={{ backgroundColor: s.bg, border: `1px solid ${s.border}`, color: s.color }}>
              {tag.emoji} {tag.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ─── Marker Timeline Bar ─────────────────────────────────────────────────────

const BAND_COLORS = ['#4A90D9', '#E8A838', '#9B59B6', '#E74C3C', '#1ABC9C', '#F39C12', '#3498DB', '#8E44AD'];

function MarkerBar({ duration, markers, laps, onSeek }: {
  duration: number; markers: Marker[]; laps?: Lap[]; onSeek: (t: number) => void;
}) {
  if (!duration) return null;

  const bands = laps && laps.length > 0
    ? laps.map((lap, i) => ({
        start: lap.start,
        end:   laps[i + 1]?.start ?? duration,
        label: `L${lap.lap_num}`,
        color: lap.is_best ? '#00C851' : BAND_COLORS[i % BAND_COLORS.length],
      }))
    : [
        { start: 0,             end: duration / 3,     label: 'S1', color: '#4A90D9' },
        { start: duration / 3,  end: (duration / 3)*2, label: 'S2', color: '#E8A838' },
        { start: (duration/3)*2,end: duration,          label: 'S3', color: '#9B59B6' },
      ];

  return (
    <div className="mt-2 px-1">
      {/* Colored bands with labels */}
      <div className="relative w-full rounded overflow-hidden" style={{ height: 20 }}>
        {bands.map((band, i) => {
          const left  = (band.start / duration) * 100;
          const width = ((band.end - band.start) / duration) * 100;
          return (
            <button key={i} onClick={() => onSeek(band.start)}
              title={`${band.label} — click to jump`}
              style={{
                position: 'absolute', left: `${left}%`, width: `${width}%`, height: '100%',
                backgroundColor: band.color + '22',
                borderRight: '1px solid rgba(255,255,255,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: band.color, fontFamily: 'monospace', letterSpacing: 1 }}>
                {band.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Marker dots */}
      {markers.length > 0 && (
        <div className="relative w-full mt-0.5" style={{ height: 12 }}>
          {markers.map((mk, i) => (
            <button key={i} onClick={() => onSeek(mk.secs)}
              title={`${mk.type === 'error' ? '🔴 Error' : '🌟 Moment'} at ${fmtTime(mk.secs)}`}
              style={{
                position: 'absolute',
                left: `${Math.min(99, (mk.secs / duration) * 100)}%`,
                top: '50%', transform: 'translate(-50%, -50%)',
                width: 9, height: 9, borderRadius: '50%',
                backgroundColor: mk.type === 'error' ? '#ff4444' : '#00C851',
                border: '1.5px solid rgba(0,0,0,0.6)', cursor: 'pointer', zIndex: 10,
                boxShadow: mk.type === 'error' ? '0 0 5px rgba(255,68,68,0.8)' : '0 0 5px rgba(0,200,81,0.8)',
              }}
            />
          ))}
        </div>
      )}

      <div className="flex justify-between mt-1" style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9 }}>
        <span>0:00</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#ff4444', display: 'inline-block' }} /> errors
          </span>
          <span className="flex items-center gap-1">
            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#00C851', display: 'inline-block' }} /> moments
          </span>
        </span>
        <span>{fmtTime(duration)}</span>
      </div>
    </div>
  );
}

// ─── Lap Table ────────────────────────────────────────────────────────────────

function LapTable({ laps, onSeek }: { laps: Lap[]; onSeek: (t: number) => void }) {
  return (
    <div className="mt-2 rounded-xl overflow-hidden font-mono text-xs" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="grid px-4 py-2 text-xs font-semibold uppercase tracking-wider border-b"
        style={{ gridTemplateColumns: '40px 64px 72px 1fr', borderColor: 'rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}>
        <span>Lap</span><span>Time</span><span>vs Best</span><span>Key Issue</span>
      </div>
      {laps.map(lap => (
        <button key={lap.lap_num} onClick={() => onSeek(lap.start)}
          className="w-full grid px-4 py-2.5 text-left hover:brightness-125 transition-all border-b last:border-0"
          style={{
            gridTemplateColumns: '40px 64px 72px 1fr',
            borderColor: 'rgba(255,255,255,0.05)',
            backgroundColor: lap.is_best ? 'rgba(0,200,81,0.08)' : 'transparent',
          }}>
          <span style={{ color: lap.is_best ? '#00C851' : 'var(--text-secondary)' }}>{lap.is_best ? '★' : '▶'} {lap.lap_num}</span>
          <span style={{ color: 'var(--text-primary)' }}>{lap.lap_time}</span>
          <span style={{ color: lap.delta === 'BEST' ? '#00C851' : '#ffbb33' }}>{lap.delta}</span>
          <span style={{ color: 'var(--text-secondary)' }}>{lap.key_issue}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Mode Page ────────────────────────────────────────────────────────────────

function ModePage({ onSelect, onBack }: { onSelect: (c: Context) => void; onBack: () => void }) {
  const modes: { context: Context; icon: string; title: string; desc: string }[] = [
    { context: 'kart',   icon: '🏎️', title: 'Karting',   desc: 'Real onboard kart footage' },
    { context: 'f1_sim', icon: '🔴', title: 'F1 25 Sim', desc: 'F1 25 screen recording' },
  ];
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <nav className="flex items-center justify-between px-8 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <button onClick={onBack} className="flex items-center gap-2 text-sm hover:opacity-70 transition-opacity" style={{ color: 'var(--text-secondary)' }}>
          <ArrowLeft size={15} /> Back
        </button>
        <div className="flex items-center gap-2"><span>🏎️</span><span className="font-bold">PitLane AI</span></div>
        <NavDropdown />
      </nav>
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--accent-green)' }}>Powered by Twelve Labs</p>
        <h1 className="text-4xl font-bold mb-3 text-center">What are you analysing?</h1>
        <p className="text-base mb-12 text-center" style={{ color: 'var(--text-secondary)' }}>Choose your racing context — AI prompts and analysis adapt accordingly</p>
        <div className="grid grid-cols-2 gap-6 w-full max-w-xl">
          {modes.map(m => (
            <button key={m.context} onClick={() => onSelect(m.context)}
              className="flex flex-col items-center gap-4 p-10 rounded-2xl transition-all hover:scale-[1.03] hover:ring-2"
              style={{ backgroundColor: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <span className="text-5xl">{m.icon}</span>
              <div className="text-center">
                <p className="font-bold text-lg">{m.title}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{m.desc}</p>
              </div>
              <span className="text-xs px-3 py-1 rounded-full" style={{ backgroundColor: 'rgba(0,200,81,0.12)', color: 'var(--accent-green)', border: '1px solid rgba(0,200,81,0.25)' }}>
                Select →
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const KART_PANELS = [
  { key: 'errors',  icon: '🔴', title: 'Driving Errors',   badge: 'Pegasus',        spinner: 'Pegasus is scanning every corner...' },
  { key: 'moments', icon: '🌟', title: 'Best Moments',     badge: 'Marengo Search', spinner: 'Marengo is finding your highlights...' },
  { key: 'report',  icon: '📊', title: 'Coaching Report',  badge: 'Pegasus + Groq', spinner: 'Running full AI pipeline (30–60s)...' },
] as const;

const F1_PANELS = [
  { key: 'errors',  icon: '🔴', title: 'Driving Errors',   badge: 'Pegasus',        spinner: 'Pegasus is scanning every corner...' },
  { key: 'moments', icon: '🌟', title: 'Best Moments',     badge: 'Marengo Search', spinner: 'Marengo is finding your highlights...' },
  { key: 'laps',    icon: '🏁', title: 'Lap Breakdown',    badge: 'Pegasus',        spinner: 'Detecting laps from visual context...' },
  { key: 'report',  icon: '📊', title: 'Coaching Report',  badge: 'Pegasus + Groq', spinner: 'Running full AI pipeline (30–60s)...' },
] as const;

type PanelKey = 'errors' | 'moments' | 'laps' | 'report';

// ─── Dropdown Nav ─────────────────────────────────────────────────────────────

function NavDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all hover:brightness-110"
        style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.08)' }}>
        Resources <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 rounded-xl overflow-hidden shadow-2xl z-50"
          style={{ backgroundColor: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.1)', minWidth: 180 }}>
          {[
            { label: '🏎️ How It Works', sub: 'AI pipeline overview' },
            { label: '🔍 Twelve Labs Docs', sub: 'Pegasus & Marengo API' },
            { label: '💻 GitHub', sub: 'View source code' },
            { label: '📊 FiftyOne Plugin', sub: 'Dataset visualization' },
          ].map((item, i) => (
            <button key={i} className="w-full text-left px-4 py-3 text-xs hover:bg-white/5 transition-colors border-b last:border-0"
              style={{ borderColor: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)' }}>
              <div className="font-medium">{item.label}</div>
              <div style={{ color: 'var(--text-secondary)' }}>{item.sub}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Landing Page ─────────────────────────────────────────────────────────────

function LandingPage({ onDemo, onUploaded }: { onDemo: () => void; onUploaded: (video: Video) => void }) {
  const [isDragging, setIsDragging]     = useState(false);
  const [uploadMsg, setUploadMsg]       = useState('');
  const [uploading, setUploading]       = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.mp4')) {
      setUploadMsg('⚠️ Only MP4 files are supported.');
      return;
    }
    setUploading(true);
    setUploadMsg('Uploading and indexing with Twelve Labs — this takes 2–4 minutes...');
    try {
      const form = new FormData();
      form.append('file', file);
      const res  = await fetch(`${API}/upload`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) { setUploadMsg(`⚠️ ${data.detail || 'Upload failed.'}`); setUploading(false); return; }
      setUploadMsg(`✓ Indexed! Loading your video...`);
      const vidRes  = await fetch(`${API}/videos`);
      const vidData = await vidRes.json();
      const found   = (vidData.videos as Video[]).find(v => v.id === data.video_id);
      if (found) onUploaded(found);
      else setUploadMsg('⚠️ Video indexed but not found in list. Try refreshing.');
    } catch {
      setUploadMsg('⚠️ Network error — is the backend running on port 8000?');
    }
    setUploading(false);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2">
          <span className="text-lg">🏎️</span>
          <span className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>PitLane AI</span>
          <span className="text-xs px-2 py-0.5 rounded-full ml-1 font-mono"
            style={{ backgroundColor: 'rgba(0,200,81,0.12)', color: 'var(--accent-green)', border: '1px solid rgba(0,200,81,0.25)' }}>
            beta
          </span>
        </div>
        <div className="flex items-center gap-3">
          <NavDropdown />
          <button
            onClick={onDemo}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
            style={{ backgroundColor: 'var(--accent-green)', color: '#000' }}>
            See Demo →
          </button>
        </div>
      </nav>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 max-w-2xl mx-auto w-full">
        <p className="text-xs font-semibold uppercase tracking-widest mb-4 text-center" style={{ color: 'var(--accent-green)' }}>
          Powered by Twelve Labs · Pegasus &amp; Marengo
        </p>
        <h1 className="text-5xl font-bold text-center mb-4 leading-tight">
          Your AI Racing<br />Coach
        </h1>
        <p className="text-base text-center mb-10" style={{ color: 'var(--text-secondary)', maxWidth: 420 }}>
          Upload a kart video and get instant AI analysis — errors, highlights, coaching report, and driver style.
        </p>

        {/* Upload zone */}
        <div
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
          className="w-full rounded-2xl flex flex-col items-center justify-center gap-4 transition-all cursor-pointer"
          style={{
            height: 220,
            border: `2px dashed ${isDragging ? 'var(--accent-green)' : 'rgba(255,255,255,0.15)'}`,
            backgroundColor: isDragging ? 'rgba(0,200,81,0.06)' : 'rgba(255,255,255,0.02)',
            cursor: uploading ? 'default' : 'pointer',
          }}>
          <input ref={fileInputRef} type="file" accept=".mp4,video/mp4" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); }} />
          {uploading ? (
            <>
              <div className="w-8 h-8 rounded-full border-2 animate-spin"
                style={{ borderColor: 'var(--accent-green)', borderTopColor: 'transparent' }} />
              <p className="text-sm text-center px-6" style={{ color: 'var(--text-secondary)' }}>{uploadMsg}</p>
            </>
          ) : (
            <>
              <Upload size={32} style={{ color: 'rgba(255,255,255,0.25)' }} />
              <div className="text-center">
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Drag &amp; drop your MP4 here</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>or click to browse</p>
              </div>
              {uploadMsg && (
                <p className="text-xs px-4 text-center" style={{ color: uploadMsg.startsWith('⚠️') ? '#ff6b6b' : 'var(--accent-green)' }}>{uploadMsg}</p>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-4 my-6 w-full">
          <div className="flex-1 h-px" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>or</span>
          <div className="flex-1 h-px" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
        </div>

        <button
          onClick={onDemo}
          className="w-full py-3 rounded-xl font-semibold text-sm transition-all hover:brightness-110"
          style={{ backgroundColor: 'rgba(0,200,81,0.12)', color: 'var(--accent-green)', border: '1px solid rgba(0,200,81,0.25)' }}>
          ▶ See the Demo →
        </button>

        <div className="mt-10 flex flex-wrap justify-center gap-6 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span>🔴 Driving Errors — Pegasus</span>
          <span>🌟 Best Moments — Marengo</span>
          <span>📊 Coaching Report — Groq</span>
          <span>💬 Live Q&amp;A</span>
        </div>
      </div>
    </div>
  );
}

// ─── Video Selection ──────────────────────────────────────────────────────────

function VideoCard({ video, onSelect }: { video: Video; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className="group relative rounded-2xl overflow-hidden text-left transition-all duration-200 hover:scale-[1.03] hover:ring-2"
      style={{ backgroundColor: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.08)' }}>
      {video.thumbnail_url ? (
        <img src={video.thumbnail_url} alt={video.filename} className="w-full object-cover" style={{ height: 180 }} />
      ) : (
        <div className="w-full flex items-center justify-center text-4xl"
          style={{ height: 180, backgroundColor: 'rgba(255,255,255,0.04)' }}>🏎️</div>
      )}
      <div className="p-4">
        <p className="text-sm font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>
          {shortName(video.filename)}
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--accent-green)' }}>Click to analyze →</p>
      </div>
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
        style={{ backgroundColor: 'rgba(0,200,81,0.08)' }}>
        <div className="text-sm font-bold px-4 py-2 rounded-lg" style={{ backgroundColor: 'var(--accent-green)', color: '#000' }}>
          Analyze This Video
        </div>
      </div>
    </button>
  );
}

// ─── Analysis Panel ───────────────────────────────────────────────────────────

function AnalysisPanel({
  icon, title, badge, spinner, state, onSeek,
}: {
  icon: string; title: string; badge: string; spinner: string;
  state: AnalysisState; onSeek: (t: number) => void;
}) {
  return (
    <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <span className="font-semibold text-sm">{title}</span>
        </div>
        <Badge label={badge} />
      </div>
      {state.status === 'loading' && <Spinner label={spinner} />}
      {state.status === 'error'   && <p className="text-xs py-2" style={{ color: '#ff6b6b' }}>{state.result}</p>}
      {state.status === 'done'    && (
        <>
          <ResultBody markdown={state.result} onSeek={onSeek} />
          {state.clips && state.clips.length > 0 && <ClipRow clips={state.clips} onSeek={onSeek} />}
          {state.laps  && state.laps.length  > 0 && <LapTable laps={state.laps} onSeek={onSeek} />}
          {state.scores && <RadarScore scores={state.scores} />}
          {state.driver_style && state.driver_style.tags?.length > 0 && <DriverStyleCard style={state.driver_style} />}
        </>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function DemoPage({ onBack }: { onBack: () => void }) {
  const [phase, setPhase]             = useState<Phase>('landing');
  const [context, setContext]         = useState<Context>('kart');
  const [videos, setVideos]           = useState<Video[]>([]);
  const [selected, setSelected]       = useState<Video | null>(null);
  const [fetchError, setFetchError]   = useState('');
  const [analyses, setAnalyses]       = useState<Record<string, AnalysisState>>({});
  const [askQuestion, setAskQuestion] = useState('');
  const [askState, setAskState]       = useState<AnalysisState | null>(null);
  const [askLoading, setAskLoading]   = useState(false);
  const [duration, setDuration]       = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const PANELS = context === 'f1_sim' ? F1_PANELS : KART_PANELS;

  useEffect(() => {
    fetch(`${API}/videos?context=${context}`)
      .then(r => r.json())
      .then(d => setVideos(d.videos || []))
      .catch(() => setFetchError('Cannot reach backend on port 8000.'));
  }, [context]);

  const markers: Marker[] = (() => {
    const errState   = analyses['errors'];
    const errorClips = errState?.status  === 'done' ? (errState.error_clips  ?? []) : [];
    const pegasusText = errState?.status === 'done' ? (errState.pegasus_text ?? '') : '';
    const clips      = analyses['moments']?.status === 'done' ? (analyses['moments'].clips ?? []) : [];
    return extractMarkers(errorClips, clips, pegasusText);
  })();

  function seekTo(secs: number) {
    if (videoRef.current) {
      videoRef.current.currentTime = secs;
      videoRef.current.play();
    }
  }

  async function runAnalysis(key: string, fetchFn: () => Promise<Response>) {
    try {
      const res  = await fetchFn();
      const data = await res.json();
      if (res.status === 429) {
        setAnalyses(prev => ({ ...prev, [key]: { status: 'error', result: '⚠️ Rate limit reached (50 req/day). Try again tomorrow.' } }));
      } else {
        setAnalyses(prev => ({ ...prev, [key]: { status: 'done', result: data.result || data.detail || '—', clips: data.clips, error_clips: data.error_clips, pegasus_text: data.pegasus_text, laps: data.laps, scores: data.overall, driver_style: data.driver_style } }));
      }
    } catch {
      setAnalyses(prev => ({ ...prev, [key]: { status: 'error', result: 'Network error — is the backend running?' } }));
    }
  }

  function selectVideo(video: Video) {
    setSelected(video);
    setPhase('analyze');
    setAskState(null);
    setAskQuestion('');
    setDuration(0);
    const id = video.id;
    const ctx  = context;
    const init: Record<string, AnalysisState> = {
      errors:  { status: 'loading', result: '' },
      moments: { status: 'loading', result: '' },
      report:  { status: 'loading', result: '' },
      ...(ctx === 'f1_sim' ? { laps: { status: 'loading', result: '' } } : {}),
    };
    setAnalyses(init);
    const body = (extra: object) => JSON.stringify({ video_id: id, context: ctx, ...extra });
    runAnalysis('errors',  () => fetch(`${API}/analyze/errors`,         { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body({ error_types: 'all driving errors' }) }));
    runAnalysis('moments', () => fetch(`${API}/analyze/best-moments`,    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body({}) }));
    runAnalysis('report',  () => fetch(`${API}/analyze/coaching-report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body({ focus: 'Full Analysis' }) }));
    if (ctx === 'f1_sim') {
      runAnalysis('laps', () => fetch(`${API}/analyze/laps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body({}) }));
    }
  }

  async function submitAsk() {
    if (!askQuestion.trim() || !selected || askLoading) return;
    setAskLoading(true);
    setAskState({ status: 'loading', result: '' });
    try {
      const res  = await fetch(`${API}/analyze/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ video_id: selected.id, question: askQuestion, context }) });
      const data = await res.json();
      setAskState({ status: res.status === 429 ? 'error' : 'done', result: data.result || data.detail || '—' });
    } catch {
      setAskState({ status: 'error', result: 'Network error.' });
    }
    setAskLoading(false);
  }

  // ── Landing ──
  if (phase === 'landing') {
    return (
      <LandingPage
        onDemo={() => setPhase('mode')}
        onUploaded={video => { setVideos(prev => [video, ...prev.filter(v => v.id !== video.id)]); selectVideo(video); }}
      />
    );
  }

  // ── Mode ──
  if (phase === 'mode') {
    return (
      <ModePage
        onBack={() => setPhase('landing')}
        onSelect={c => { setContext(c); setPhase('select'); }}
      />
    );
  }

  // ── Select ──
  if (phase === 'select') {
    return (
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
        {/* Nav */}
        <nav className="flex items-center justify-between px-8 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <button onClick={() => setPhase('landing')} className="flex items-center gap-2 text-sm hover:opacity-70 transition-opacity" style={{ color: 'var(--text-secondary)' }}>
            <ArrowLeft size={15} /> Back
          </button>
          <div className="flex items-center gap-2">
            <span>🏎️</span>
            <span className="font-bold">PitLane AI</span>
          </div>
          <NavDropdown />
        </nav>

        <div className="max-w-5xl mx-auto w-full px-6 py-16 flex-1 flex flex-col justify-center">
          <div className="mb-12 text-center">
            <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--accent-green)' }}>Powered by Twelve Labs</p>
            <h1 className="text-5xl font-bold mb-4">Choose a Video</h1>
            <p className="text-lg" style={{ color: 'var(--text-secondary)' }}>
              Select a video — AI analysis runs automatically
            </p>
          </div>

          {fetchError && (
            <div className="rounded-xl p-4 mb-8 text-sm text-center" style={{ backgroundColor: 'rgba(255,60,60,0.1)', color: '#ff6b6b', border: '1px solid rgba(255,60,60,0.2)' }}>
              ⚠️ {fetchError}
            </div>
          )}

          {videos.length === 0 && !fetchError && (
            <div className="text-center py-12" style={{ color: 'var(--text-secondary)' }}>
              <div className="animate-spin inline-block w-6 h-6 border-2 rounded-full mb-3"
                style={{ borderColor: 'var(--accent-green)', borderTopColor: 'transparent' }} />
              <p className="text-sm">Loading videos...</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {videos.map(v => <VideoCard key={v.id} video={v} onSelect={() => selectVideo(v)} />)}
          </div>

          <div className="mt-16 flex justify-center gap-8 text-xs flex-wrap" style={{ color: 'var(--text-secondary)' }}>
            <span>🔴 Driving Errors — Pegasus</span>
            <span>🌟 Best Moments — Marengo</span>
            <span>📊 Coaching Report — Pegasus + Groq</span>
            <span>💬 Live Q&A — Pegasus</span>
            <span>🏁 Driver Style Card — Groq</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Analyze ──
  const videoUrl = selected?.video_url ? (selected.video_url.startsWith('http') ? selected.video_url : `${API}${selected.video_url}`) : '';

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <button onClick={() => setPhase('select')} className="flex items-center gap-2 text-sm hover:opacity-70 transition-opacity" style={{ color: 'var(--text-secondary)' }}>
          <ArrowLeft size={15} /> Choose another video
        </button>
        <div className="text-center">
          <p className="text-xs font-semibold" style={{ color: 'var(--accent-green)' }}>🏎️ PitLane AI</p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{shortName(selected?.filename ?? '')}</p>
          <div className="flex gap-1.5 mt-1 justify-center flex-wrap">
            {PANELS.map(p => {
              const s = analyses[p.key];
              const done  = s?.status === 'done';
              const error = s?.status === 'error';
              return (
                <span key={p.key} className="text-xs px-1.5 py-0.5 rounded-full font-mono"
                  style={{
                    backgroundColor: done ? 'rgba(0,200,81,0.15)' : error ? 'rgba(255,60,60,0.12)' : 'rgba(255,255,255,0.06)',
                    color: done ? 'var(--accent-green)' : error ? '#ff6b6b' : '#888',
                  }}>
                  {p.icon} {done ? '✓' : error ? '✗' : '⏳'}
                </span>
              );
            })}
            <span className="text-xs px-1.5 py-0.5 rounded-full font-mono"
              style={{
                backgroundColor: askState?.status === 'done' ? 'rgba(0,200,81,0.15)' : 'rgba(255,255,255,0.06)',
                color: askState?.status === 'done' ? 'var(--accent-green)' : askState ? '#888' : '#555',
              }}>
              💬 {askState?.status === 'done' ? '✓' : askState?.status === 'loading' ? '⏳' : '—'}
            </span>
          </div>
        </div>
        <NavDropdown />
      </div>

      <div className="flex h-[calc(100vh-53px)]">

        {/* LEFT: Video player — larger */}
        <div className="w-[45%] shrink-0 flex flex-col p-5 border-r" style={{ borderColor: 'rgba(255,255,255,0.06)', overflowY: 'auto' }}>
          {videoUrl ? (
            <>
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                autoPlay
                muted
                onLoadedMetadata={e => setDuration((e.target as HTMLVideoElement).duration)}
                className="w-full rounded-xl"
                style={{ backgroundColor: '#000', objectFit: 'contain', minHeight: 260, maxHeight: '55vh' }}
              />
              <MarkerBar duration={duration} markers={markers} laps={analyses['laps']?.status === 'done' ? (analyses['laps'].laps ?? []) : []} onSeek={seekTo} />
            </>
          ) : (
            <div className="w-full rounded-xl flex items-center justify-center"
              style={{ height: 260, backgroundColor: 'var(--bg-card)' }}>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>No local file</p>
            </div>
          )}

        </div>

        {/* RIGHT: Results */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {PANELS.map(p => (
            <AnalysisPanel key={p.key} icon={p.icon} title={p.title} badge={p.badge} spinner={p.spinner}
              state={analyses[p.key] ?? { status: 'loading', result: '' }} onSeek={seekTo} />
          ))}

          {/* Live Q&A */}
          <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">💬</span>
                <span className="font-semibold text-sm">Ask the Engineer</span>
              </div>
              <Badge label="Pegasus" />
            </div>
            <div className="flex gap-2">
              <input
                value={askQuestion}
                onChange={e => setAskQuestion(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && submitAsk()}
                placeholder="e.g. Where am I losing the most time?"
                className="flex-1 px-3 py-2 rounded-lg text-xs"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.1)', outline: 'none' }}
              />
              <button onClick={submitAsk} disabled={!askQuestion.trim() || askLoading}
                className="px-3 py-2 rounded-lg disabled:opacity-40 transition-all"
                style={{ backgroundColor: 'var(--accent-green)', color: '#000' }}>
                <Send size={14} />
              </button>
            </div>
            {askState?.status === 'loading' && <Spinner label="Pegasus is studying your video..." />}
            {askState?.status === 'error'   && <p className="text-xs mt-3" style={{ color: '#ff6b6b' }}>{askState.result}</p>}
            {askState?.status === 'done'    && <div className="mt-3"><ResultBody markdown={askState.result} onSeek={seekTo} /></div>}
          </div>
        </div>
      </div>
    </div>
  );
}
