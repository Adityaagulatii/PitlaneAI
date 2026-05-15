import { useState, useEffect, useRef, KeyboardEvent, DragEvent } from 'react';
import {
  ArrowLeft, Send, Upload, ChevronDown,
  AlertTriangle, Zap, BarChart2, Flag, MessageSquare,
  CheckCircle, Loader2, Minus, XCircle,
  Play, ChevronRight, TrendingUp,
} from 'lucide-react';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts';

const API = (import.meta.env.VITE_API_URL as string) ?? '';

// ── Types ─────────────────────────────────────────────────────────────────────
type Phase   = 'landing' | 'mode' | 'select' | 'analyze';
type Context = 'kart' | 'f1_sim';
type Video   = { id: string; filename: string; video_url?: string | null; thumbnail_url?: string | null };
type Clip    = { category: string; emoji: string; start: number; end: number };
type Lap     = { lap_num: number; start: number; lap_time: string; delta: string; key_issue: string; is_best: boolean };
type Scores  = { racing_line: number; braking: number; throttle: number; consistency: number };
type StyleTag    = { label: string; emoji: string; sentiment: 'positive' | 'negative' | 'neutral' };
type DriverStyle = { archetype: string; tags: StyleTag[] };
type Status  = 'loading' | 'done' | 'error' | 'skip';
type AnalysisState = {
  status: Status; result: string;
  clips?: Clip[]; error_clips?: { start: number; end: number }[];
  pegasus_text?: string; laps?: Lap[]; scores?: Scores;
  driver_style?: DriverStyle; cached?: boolean;
};
type Marker  = { secs: number; type: 'error' | 'moment' };
type PanelKey = 'errors' | 'moments' | 'laps' | 'report';

// ── Panel Definitions ─────────────────────────────────────────────────────────
const KART_PANELS = [
  { key: 'errors'  as PanelKey, Icon: AlertTriangle, label: 'Errors',   badge: 'Error Detection',  spinner: 'Scanning every corner…'      },
  { key: 'moments' as PanelKey, Icon: Zap,           label: 'Moments',  badge: 'Highlight Search', spinner: 'Finding your best moments…'  },
  { key: 'report'  as PanelKey, Icon: BarChart2,     label: 'Coaching', badge: 'AI Coaching',      spinner: 'Running full analysis…'      },
] as const;

const F1_PANELS = [
  { key: 'errors'  as PanelKey, Icon: AlertTriangle, label: 'Errors',   badge: 'Error Detection',  spinner: 'Scanning every corner…'      },
  { key: 'moments' as PanelKey, Icon: Zap,           label: 'Moments',  badge: 'Highlight Search', spinner: 'Finding your best moments…'  },
  { key: 'laps'    as PanelKey, Icon: Flag,          label: 'Laps',     badge: 'Lap Analysis',     spinner: 'Detecting laps from video…'  },
  { key: 'report'  as PanelKey, Icon: BarChart2,     label: 'Coaching', badge: 'AI Coaching',      spinner: 'Running full analysis…'      },
] as const;

const BAND_COLORS = ['#4D9EFF', '#FFD426', '#A855F7', '#FF6B9D', '#06B6D4', '#00FF87', '#F97316'];

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function parseTs(text: string, onSeek: (t: number) => void): React.ReactNode[] {
  return text.split(/\b(\d{1,2}:\d{2})\b/).map((part, i) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(part);
    if (m) {
      const secs = +m[1] * 60 + +m[2];
      return (
        <button key={i} onClick={() => onSeek(secs)}
          className="font-mono font-semibold hover:underline transition-opacity hover:opacity-80"
          style={{ color: 'var(--accent-green)' }}>
          ▶ {part}
        </button>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function extractMarkers(errClips: { start: number }[], clips: Clip[], pegText = ''): Marker[] {
  const out: Marker[] = []; const seen = new Set<string>();
  [...errClips.map(c => c.start), ...(pegText ? [...pegText.matchAll(/\b(\d{1,2}):(\d{2})\b/g)].map(m => +m[1] * 60 + +m[2]) : [])]
    .forEach(s => { const k = `e:${Math.floor(s)}`; if (!seen.has(k)) { seen.add(k); out.push({ secs: s, type: 'error' }); } });
  clips.forEach(c => { const k = `g:${Math.floor(c.start)}`; if (!seen.has(k)) { seen.add(k); out.push({ secs: c.start, type: 'moment' }); } });
  return out;
}

// ── Design Tokens ─────────────────────────────────────────────────────────────
const surface  = 'var(--bg-surface)';
const card     = 'var(--bg-card)';
const elevated = 'var(--bg-elevated)';
const border   = 'var(--border-subtle)';
const green    = 'var(--accent-green)';
const red      = 'var(--accent-red)';
const textSec  = 'var(--text-secondary)';
const textMut  = 'var(--text-muted)';

// ── Primitives ────────────────────────────────────────────────────────────────
function Chip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={{ backgroundColor: 'rgba(0,255,135,0.07)', color: green, border: '1px solid rgba(0,255,135,0.13)' }}>
      {label}
    </span>
  );
}

function TabStatus({ status }: { status: Status | undefined }) {
  if (!status || status === 'loading') return <Loader2 size={10} className="animate-spin" style={{ color: '#FFD426' }} />;
  if (status === 'done')  return <CheckCircle size={10} style={{ color: green }} />;
  if (status === 'skip')  return <Minus size={10} style={{ color: textMut }} />;
  return <XCircle size={10} style={{ color: red }} />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: textMut }}>{children}</p>;
}

// ── ScoreRow ──────────────────────────────────────────────────────────────────
function ScoreRow({ scores }: { scores: Scores }) {
  const items = [
    { label: 'Racing Line', value: scores.racing_line },
    { label: 'Braking',     value: scores.braking     },
    { label: 'Throttle',    value: scores.throttle    },
    { label: 'Consistency', value: scores.consistency },
  ];
  const scoreColor = (v: number) => v >= 80 ? green : v >= 60 ? '#FFD426' : red;
  return (
    <div className="grid grid-cols-4 gap-2">
      {items.map(it => (
        <div key={it.label} className="rounded-xl px-3 py-3.5" style={{ backgroundColor: card, border: `1px solid ${border}` }}>
          <div className="tabular-nums leading-none font-extrabold" style={{ fontSize: 28, color: scoreColor(it.value), letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
            {it.value}
          </div>
          <div className="mt-1.5 font-semibold uppercase" style={{ fontSize: 9, color: textMut, letterSpacing: '0.07em' }}>{it.label}</div>
        </div>
      ))}
    </div>
  );
}

// ── ResultBody ────────────────────────────────────────────────────────────────
function ResultBody({ markdown, onSeek }: { markdown: string; onSeek: (t: number) => void }) {
  return (
    <div className="space-y-0.5 text-sm leading-relaxed" style={{ color: textSec }}>
      {markdown.split('\n').map((line, i) => {
        if (line.startsWith('## '))  return <p key={i} className="font-semibold text-sm mb-1 mt-4 first:mt-0" style={{ color: 'var(--text-primary)' }}>{parseTs(line.slice(3), onSeek)}</p>;
        if (line.startsWith('### ')) return <p key={i} className="font-semibold text-xs uppercase tracking-wider mt-4 mb-2" style={{ color: green }}>{parseTs(line.slice(4), onSeek)}</p>;
        if (/^\|[-\s|]+\|$/.test(line)) return null;
        if (line.startsWith('|')) {
          const cells = line.split('|').filter(c => c.trim());
          return (
            <div key={i} className="grid gap-3 py-2 border-b" style={{ gridTemplateColumns: `repeat(${cells.length}, 1fr)`, borderColor: border }}>
              {cells.map((c, j) => (
                <span key={j} className="text-xs" style={{ color: j === 0 ? green : textSec }}>{parseTs(c.trim(), onSeek)}</span>
              ))}
            </div>
          );
        }
        if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="font-medium mt-3 text-sm" style={{ color: 'var(--text-primary)' }}>{parseTs(line.slice(2, -2), onSeek)}</p>;
        if (line.trim() === '') return <div key={i} className="h-1" />;
        return <p key={i} className="text-xs">{parseTs(line, onSeek)}</p>;
      })}
    </div>
  );
}

// ── ClipRow ───────────────────────────────────────────────────────────────────
function ClipRow({ clips, onSeek }: { clips: Clip[]; onSeek: (t: number) => void }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {clips.map((c, i) => (
        <button key={i} onClick={() => onSeek(c.start)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:brightness-110"
          style={{ backgroundColor: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.12)', color: 'var(--text-primary)' }}>
          <Play size={10} style={{ color: green }} />
          <span>{c.category}</span>
          <span className="font-mono" style={{ color: green }}>{fmt(c.start)}</span>
        </button>
      ))}
    </div>
  );
}

// ── RadarScore ────────────────────────────────────────────────────────────────
function RadarScore({ scores }: { scores: Scores }) {
  const data = [
    { m: 'Racing Line', v: scores.racing_line },
    { m: 'Braking',     v: scores.braking     },
    { m: 'Throttle',    v: scores.throttle    },
    { m: 'Consistency', v: scores.consistency },
  ];
  return (
    <div style={{ width: '100%', height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius={70} margin={{ top: 16, right: 48, bottom: 16, left: 48 }}>
          <PolarGrid stroke={border} />
          <PolarAngleAxis dataKey="m" tick={{ fill: textMut, fontSize: 11 }} />
          <Radar dataKey="v" fill="#00FF87" fillOpacity={0.1} stroke="#00FF87" strokeWidth={1.5} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── DriverStyleCard ───────────────────────────────────────────────────────────
const TAG = {
  positive: { bg: 'rgba(0,255,135,0.08)',  border: 'rgba(0,255,135,0.18)',  color: green },
  negative: { bg: 'rgba(255,59,59,0.08)',  border: 'rgba(255,59,59,0.18)',  color: red   },
  neutral:  { bg: 'rgba(255,212,38,0.08)', border: 'rgba(255,212,38,0.18)', color: '#FFD426' },
};

function DriverStyleCard({ style }: { style: DriverStyle }) {
  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: 'rgba(0,255,135,0.03)', border: `1px solid rgba(0,255,135,0.1)` }}>
      <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: textMut }}>Driver Archetype</p>
      <p className="text-lg font-bold mb-3">{style.archetype}</p>
      <div className="flex flex-wrap gap-1.5">
        {style.tags.map((tag, i) => {
          const s = TAG[tag.sentiment] ?? TAG.neutral;
          return (
            <span key={i} className="px-2.5 py-1 rounded-md text-xs font-medium"
              style={{ backgroundColor: s.bg, border: `1px solid ${s.border}`, color: s.color }}>
              {tag.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── MarkerBar ─────────────────────────────────────────────────────────────────
function MarkerBar({ duration, markers, laps, onSeek }: { duration: number; markers: Marker[]; laps?: Lap[]; onSeek: (t: number) => void }) {
  if (!duration) return null;
  const bands = laps && laps.length > 0
    ? laps.map((lap, i) => ({ start: lap.start, end: laps[i+1]?.start ?? duration, label: `L${lap.lap_num}`, color: lap.is_best ? '#00FF87' : BAND_COLORS[i % BAND_COLORS.length] }))
    : [
        { start: 0,              end: duration / 3,       label: 'S1', color: '#4D9EFF' },
        { start: duration / 3,   end: (duration / 3) * 2, label: 'S2', color: '#FFD426' },
        { start: (duration/3)*2, end: duration,            label: 'S3', color: '#A855F7' },
      ];

  return (
    <div className="select-none">
      <div className="relative w-full rounded overflow-hidden" style={{ height: 22, backgroundColor: surface }}>
        {bands.map((b, i) => (
          <button key={i} onClick={() => onSeek(b.start)} title={b.label}
            className="absolute h-full flex items-center justify-center hover:brightness-125 transition-all"
            style={{ left: `${(b.start/duration)*100}%`, width: `${((b.end-b.start)/duration)*100}%`, backgroundColor: b.color+'1A', borderRight: i < bands.length-1 ? `1px solid ${border}` : 'none' }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: b.color, fontFamily: 'monospace', letterSpacing: '0.08em' }}>{b.label}</span>
          </button>
        ))}
      </div>
      {markers.length > 0 && (
        <div className="relative w-full mt-1" style={{ height: 10 }}>
          {markers.map((mk, i) => (
            <button key={i} onClick={() => onSeek(mk.secs)} title={`${mk.type === 'error' ? 'Error' : 'Moment'} at ${fmt(mk.secs)}`}
              className="absolute hover:scale-125 transition-transform"
              style={{
                left: `${Math.min(99, (mk.secs/duration)*100)}%`, top: '50%',
                transform: 'translate(-50%,-50%)', width: 7, height: 7,
                borderRadius: '50%', zIndex: 10, cursor: 'pointer',
                backgroundColor: mk.type === 'error' ? red : green,
                boxShadow: mk.type === 'error' ? `0 0 5px ${red}` : `0 0 5px ${green}`,
              }} />
          ))}
        </div>
      )}
      <div className="flex items-center justify-between mt-1.5" style={{ fontSize: 10, color: textMut }}>
        <span className="font-mono">0:00</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: red, display: 'inline-block' }} />errors
          </span>
          <span className="flex items-center gap-1.5">
            <span style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: green, display: 'inline-block' }} />moments
          </span>
        </span>
        <span className="font-mono">{fmt(duration)}</span>
      </div>
    </div>
  );
}

// ── LapTable ──────────────────────────────────────────────────────────────────
function LapTable({ laps, onSeek }: { laps: Lap[]; onSeek: (t: number) => void }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${border}` }}>
      <div className="grid px-4 py-2.5 border-b"
        style={{ gridTemplateColumns: '32px 60px auto', borderColor: border, color: textMut, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        <span>Lap</span><span>Time</span><span>Key Issue</span>
      </div>
      {laps.map(lap => (
        <button key={lap.lap_num} onClick={() => onSeek(lap.start)}
          className="w-full grid px-4 py-2.5 text-left border-b last:border-0 transition-colors hover:bg-white/[0.025]"
          style={{ gridTemplateColumns: '32px 60px auto', borderColor: border, backgroundColor: lap.is_best ? 'rgba(0,255,135,0.04)' : 'transparent' }}>
          <span className="font-mono text-xs font-bold" style={{ color: lap.is_best ? green : textMut }}>{lap.is_best ? '★' : lap.lap_num}</span>
          <span className="font-mono text-xs">{lap.lap_time}</span>
          <span className="text-xs truncate" style={{ color: textSec }}>{lap.key_issue || lap.delta}</span>
        </button>
      ))}
    </div>
  );
}

// ── NavDropdown ───────────────────────────────────────────────────────────────
function NavDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const items = [
    { label: 'How It Works',    sub: 'AI pipeline overview' },
    { label: 'Twelve Labs Docs', sub: 'Video AI platform'   },
    { label: 'GitHub',          sub: 'View source'          },
    { label: 'FiftyOne Plugin', sub: 'Dataset tools'        },
  ];
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all hover:bg-white/[0.04]"
        style={{ color: textSec, border: `1px solid ${border}` }}>
        Resources
        <ChevronDown size={11} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1.5 rounded-xl overflow-hidden z-50 shadow-2xl"
          style={{ backgroundColor: elevated, border: `1px solid ${border}`, minWidth: 200 }}>
          {items.map((item, i) => (
            <button key={i} className="w-full text-left px-4 py-3 hover:bg-white/[0.04] transition-colors border-b last:border-0"
              style={{ borderColor: border }}>
              <div className="text-sm font-medium">{item.label}</div>
              <div className="text-xs mt-0.5" style={{ color: textSec }}>{item.sub}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Landing Page ──────────────────────────────────────────────────────────────
function LandingPage({ onDemo, onUploaded }: { onDemo: () => void; onUploaded: (v: Video) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadMsg,  setUploadMsg]  = useState('');
  const [uploading,  setUploading]  = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.mp4')) { setUploadMsg('Only MP4 files are supported.'); return; }
    setUploading(true);
    setUploadMsg('Uploading and indexing — this takes 2–4 minutes…');
    try {
      const form = new FormData();
      form.append('file', file);
      const res  = await fetch(`${API}/upload`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) { setUploadMsg(data.detail || 'Upload failed.'); setUploading(false); return; }
      setUploadMsg('Indexed — loading your video…');
      const vd = await (await fetch(`${API}/videos`)).json();
      const found = (vd.videos as Video[]).find(v => v.id === data.video_id);
      if (found) onUploaded(found);
      else setUploadMsg('Indexed but not found in list. Try refreshing.');
    } catch { setUploadMsg('Network error — is the backend running?'); }
    setUploading(false);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files[0]; if (f) uploadFile(f);
  }

  const features = [
    { Icon: AlertTriangle, label: 'Driving Errors',   desc: 'Every corner, every lap. AI flags where you brake too late, miss the apex, or run wide.',        color: red      },
    { Icon: Zap,           label: 'Best Moments',     desc: 'Your fastest sectors and most impressive moments, automatically surfaced from the video.',         color: '#FFD426' },
    { Icon: BarChart2,     label: 'Coaching Report',  desc: 'Scores for racing line, braking, throttle and consistency with sector-by-sector tips.',           color: green    },
    { Icon: MessageSquare, label: 'Ask the Engineer', desc: 'Natural language questions about your video. No telemetry equipment or data logging required.',   color: '#A855F7' },
  ];

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <nav className="flex items-center justify-between px-8 h-14 border-b shrink-0" style={{ borderColor: border }}>
        <div className="flex items-center gap-3">
          <span className="font-bold text-base tracking-tight">PitLane AI</span>
          <span className="text-xs px-2 py-0.5 rounded font-semibold" style={{ backgroundColor: 'rgba(255,59,59,0.1)', color: red, border: '1px solid rgba(255,59,59,0.2)' }}>beta</span>
        </div>
        <div className="flex items-center gap-3">
          <NavDropdown />
          <button onClick={onDemo} className="px-4 py-1.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110" style={{ backgroundColor: red, color: '#fff' }}>
            Live Demo
          </button>
        </div>
      </nav>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 relative overflow-hidden">
        {/* Radial glow */}
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 70% 50% at 50% 55%, rgba(255,59,59,0.07) 0%, transparent 70%)', pointerEvents: 'none' }} />

        <div className="text-center max-w-2xl mx-auto relative">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium mb-8"
            style={{ backgroundColor: 'rgba(0,255,135,0.08)', color: green, border: '1px solid rgba(0,255,135,0.15)' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
            Powered by Twelve Labs
          </div>

          <h1 className="font-extrabold mb-5 leading-[1.05]" style={{ fontSize: 'clamp(44px, 6vw, 72px)', letterSpacing: '-0.03em' }}>
            Your AI<br />
            <span style={{ color: red }}>Race Engineer.</span>
          </h1>

          <p className="text-base mb-10 mx-auto" style={{ color: textSec, maxWidth: 420, lineHeight: 1.7 }}>
            Upload a karting or F1 25 video and get a complete coaching breakdown — errors, highlights, lap analysis, and driver style profile.
          </p>

          {/* Upload zone */}
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => !uploading && fileRef.current?.click()}
            className="w-full rounded-2xl flex flex-col items-center justify-center gap-4 transition-all mb-4"
            style={{
              height: 176,
              border: `1.5px dashed ${isDragging ? green : border}`,
              backgroundColor: isDragging ? 'rgba(0,255,135,0.04)' : surface,
              cursor: uploading ? 'default' : 'pointer',
            }}>
            <input ref={fileRef} type="file" accept=".mp4,video/mp4" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); }} />
            {uploading ? (
              <>
                <Loader2 size={22} className="animate-spin" style={{ color: green }} />
                <p className="text-sm text-center px-8" style={{ color: textSec }}>{uploadMsg}</p>
              </>
            ) : (
              <>
                <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <Upload size={20} style={{ color: textSec }} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold">Drop your MP4 here</p>
                  <p className="text-xs mt-1" style={{ color: textSec }}>or click to browse · karting + F1 25 footage</p>
                </div>
                {uploadMsg && <p className="text-xs px-6 text-center" style={{ color: uploadMsg.startsWith('Only') ? red : green }}>{uploadMsg}</p>}
              </>
            )}
          </div>

          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px" style={{ backgroundColor: border }} />
            <span className="text-xs" style={{ color: textMut }}>or</span>
            <div className="flex-1 h-px" style={{ backgroundColor: border }} />
          </div>

          <button onClick={onDemo}
            className="w-full py-3 rounded-xl font-semibold text-sm transition-all hover:brightness-110"
            style={{ backgroundColor: 'rgba(255,59,59,0.08)', color: red, border: `1px solid rgba(255,59,59,0.18)` }}>
            Watch the Live Demo →
          </button>
        </div>

        {/* Feature grid */}
        <div className="mt-20 grid grid-cols-2 gap-4 w-full max-w-2xl mx-auto">
          {features.map(f => (
            <div key={f.label} className="rounded-xl p-5" style={{ backgroundColor: card, border: `1px solid ${border}` }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="rounded-lg p-2 shrink-0" style={{ backgroundColor: `${f.color}14` }}>
                  <f.Icon size={15} style={{ color: f.color }} />
                </div>
                <p className="text-sm font-semibold">{f.label}</p>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: textSec }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Mode Page ─────────────────────────────────────────────────────────────────
function ModePage({ onSelect, onBack }: { onSelect: (c: Context) => void; onBack: () => void }) {
  const modes = [
    { context: 'kart'   as Context, label: 'Karting',   sub: 'Real onboard GoPro footage',  tags: ['Errors', 'Moments', 'Coaching', 'Driver Style'] },
    { context: 'f1_sim' as Context, label: 'F1 25 Sim', sub: 'F1 25 gameplay recording',    tags: ['Errors', 'Moments', 'Lap Breakdown', 'Coaching'] },
  ];
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <nav className="flex items-center justify-between px-8 h-14 border-b" style={{ borderColor: border }}>
        <button onClick={onBack} className="flex items-center gap-2 text-sm font-medium hover:opacity-70 transition-opacity" style={{ color: textSec }}>
          <ArrowLeft size={15} /> Back
        </button>
        <span className="font-bold text-sm tracking-tight">PitLane AI</span>
        <NavDropdown />
      </nav>
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: textMut }}>Select Mode</p>
        <h1 className="font-extrabold mb-2 text-center" style={{ fontSize: 36, letterSpacing: '-0.025em' }}>What are you analysing?</h1>
        <p className="text-sm mb-12 text-center" style={{ color: textSec }}>AI prompts and analysis adapt to your racing context</p>
        <div className="grid grid-cols-2 gap-5 w-full max-w-2xl">
          {modes.map(m => (
            <button key={m.context} onClick={() => onSelect(m.context)}
              className="flex flex-col items-start gap-5 p-7 rounded-2xl text-left transition-all hover:brightness-110"
              style={{ backgroundColor: card, border: `1px solid ${border}` }}>
              <div>
                <p className="font-bold text-xl mb-1.5">{m.label}</p>
                <p className="text-sm" style={{ color: textSec }}>{m.sub}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {m.tags.map(t => (
                  <span key={t} className="text-xs px-2 py-0.5 rounded-md font-medium"
                    style={{ backgroundColor: 'rgba(255,255,255,0.04)', color: textSec, border: `1px solid ${border}` }}>
                    {t}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-1.5 text-sm font-semibold mt-auto" style={{ color: red }}>
                Select <ChevronRight size={14} />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function DemoPage({ onBack }: { onBack: () => void }) {
  const [phase,       setPhase]       = useState<Phase>('landing');
  const [context,     setContext]     = useState<Context>('kart');
  const [videos,      setVideos]      = useState<Video[]>([]);
  const [selected,    setSelected]    = useState<Video | null>(null);
  const [fetchError,  setFetchError]  = useState('');
  const [analyses,    setAnalyses]    = useState<Record<string, AnalysisState>>({});
  const [activeTab,   setActiveTab]   = useState<PanelKey>('errors');
  const [askQuestion, setAskQuestion] = useState('');
  const [askState,    setAskState]    = useState<AnalysisState | null>(null);
  const [askLoading,  setAskLoading]  = useState(false);
  const [duration,    setDuration]    = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const PANELS = context === 'f1_sim' ? F1_PANELS : KART_PANELS;

  useEffect(() => {
    fetch(`${API}/videos?context=${context}`)
      .then(r => r.json())
      .then(d => setVideos(d.videos || []))
      .catch(() => setFetchError('Cannot reach backend.'));
  }, [context]);

  const markers = (() => {
    const err = analyses['errors'];
    return extractMarkers(
      err?.status === 'done' ? (err.error_clips ?? []) : [],
      analyses['moments']?.status === 'done' ? (analyses['moments'].clips ?? []) : [],
      err?.status === 'done' ? (err.pegasus_text ?? '') : '',
    );
  })();

  function seekTo(secs: number) {
    if (videoRef.current) { videoRef.current.currentTime = secs; videoRef.current.play(); }
  }

  async function runAnalysis(key: string, fetchFn: () => Promise<Response>) {
    try {
      const res  = await fetchFn();
      const data = await res.json();
      if (res.status === 429)  setAnalyses(p => ({ ...p, [key]: { status: 'error', result: 'Rate limit reached (50 req/day).' } }));
      else if (data.demo_skip) setAnalyses(p => ({ ...p, [key]: { status: 'skip',  result: '' } }));
      else setAnalyses(p => ({ ...p, [key]: {
        status: 'done', result: data.result || data.detail || '—',
        clips: data.clips, error_clips: data.error_clips, pegasus_text: data.pegasus_text,
        laps: data.laps, scores: data.overall, driver_style: data.driver_style, cached: data.cached === true,
      }}));
    } catch {
      setAnalyses(p => ({ ...p, [key]: { status: 'error', result: 'Network error — is the backend running?' } }));
    }
  }

  function startAnalysis(videoId: string, ctx: Context) {
    const init: Record<string, AnalysisState> = {
      errors:  { status: 'loading', result: '' },
      moments: { status: 'loading', result: '' },
      report:  { status: 'loading', result: '' },
      ...(ctx === 'f1_sim' ? { laps: { status: 'loading', result: '' } } : {}),
    };
    setAnalyses(init);
    const body = (extra: object) => JSON.stringify({ video_id: videoId, context: ctx, ...extra });
    runAnalysis('errors',  () => fetch(`${API}/analyze/errors`,         { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body({ error_types: 'all driving errors' }) }));
    runAnalysis('moments', () => fetch(`${API}/analyze/best-moments`,   { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body({}) }));
    runAnalysis('report',  () => fetch(`${API}/analyze/coaching-report`,{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body({ focus: 'Full Analysis' }) }));
    if (ctx === 'f1_sim') {
      runAnalysis('laps',  () => fetch(`${API}/analyze/laps`,           { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body({}) }));
    }
  }

  function selectVideo(video: Video) {
    setSelected(video); setPhase('analyze'); setAskState(null);
    setAskQuestion(''); setDuration(0); setAnalyses({}); setActiveTab('errors');
    startAnalysis(video.id, context);
  }

  async function submitAsk() {
    if (!askQuestion.trim() || !selected || askLoading) return;
    setAskLoading(true);
    setAskState({ status: 'loading', result: '' });
    try {
      const res  = await fetch(`${API}/analyze/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ video_id: selected.id, question: askQuestion, context }) });
      const data = await res.json();
      if (res.status === 429)  setAskState({ status: 'error', result: 'Rate limit reached.' });
      else if (data.demo_skip) setAskState({ status: 'skip',  result: '' });
      else                     setAskState({ status: 'done',  result: data.result || data.detail || '—' });
    } catch { setAskState({ status: 'error', result: 'Network error.' }); }
    setAskLoading(false);
  }

  if (phase === 'landing') return (
    <LandingPage onDemo={() => setPhase('mode')} onUploaded={v => { setVideos(p => [v, ...p.filter(x => x.id !== v.id)]); selectVideo(v); }} />
  );

  if (phase === 'mode') return (
    <ModePage onBack={() => setPhase('landing')} onSelect={c => { setContext(c); setPhase('select'); }} />
  );

  // ── Video Select ──────────────────────────────────────────────────────────
  if (phase === 'select') return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <nav className="flex items-center justify-between px-8 h-14 border-b" style={{ borderColor: border }}>
        <button onClick={() => setPhase('mode')} className="flex items-center gap-2 text-sm font-medium hover:opacity-70 transition-opacity" style={{ color: textSec }}>
          <ArrowLeft size={15} /> Back
        </button>
        <div className="flex items-center gap-2.5">
          <span className="font-bold text-sm tracking-tight">PitLane AI</span>
          <span className="text-xs px-2 py-0.5 rounded-md font-semibold"
            style={{ backgroundColor: context === 'f1_sim' ? 'rgba(255,59,59,0.1)' : 'rgba(0,255,135,0.08)', color: context === 'f1_sim' ? red : green, border: `1px solid ${context === 'f1_sim' ? 'rgba(255,59,59,0.18)' : 'rgba(0,255,135,0.15)'}` }}>
            {context === 'f1_sim' ? 'F1 25 Sim' : 'Karting'}
          </span>
        </div>
        <NavDropdown />
      </nav>
      <div className="max-w-5xl mx-auto w-full px-6 py-12 flex-1 flex flex-col">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: textMut }}>Select Video</p>
          <h1 className="font-extrabold mb-1.5" style={{ fontSize: 32, letterSpacing: '-0.025em' }}>Choose your footage</h1>
          <p className="text-sm" style={{ color: textSec }}>Analysis starts automatically when you select a video</p>
        </div>
        {fetchError && (
          <div className="rounded-xl p-4 mb-6 text-sm" style={{ backgroundColor: 'rgba(255,59,59,0.07)', color: red, border: '1px solid rgba(255,59,59,0.15)' }}>{fetchError}</div>
        )}
        {videos.length === 0 && !fetchError && (
          <div className="text-center py-20" style={{ color: textSec }}>
            <Loader2 size={22} className="animate-spin inline-block mb-3" style={{ color: green }} />
            <p className="text-sm">Loading videos…</p>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {videos.map(v => (
            <button key={v.id} onClick={() => selectVideo(v)}
              className="group relative rounded-2xl overflow-hidden text-left transition-all hover:ring-1 hover:ring-white/20"
              style={{ backgroundColor: card, border: `1px solid ${border}` }}>
              {v.thumbnail_url
                ? <img src={v.thumbnail_url} alt={v.filename} className="w-full object-cover" style={{ height: 160 }} />
                : <div className="w-full flex items-center justify-center" style={{ height: 160, backgroundColor: surface, color: textMut, fontSize: 32 }}>▶</div>
              }
              <div className="px-4 py-3.5">
                <p className="text-xs font-semibold truncate">{v.filename.replace(/\.mp4$/i, '')}</p>
                <p className="text-xs mt-1 font-semibold" style={{ color: green }}>Analyze →</p>
              </div>
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
                <span className="text-sm font-bold px-5 py-2.5 rounded-xl" style={{ backgroundColor: red, color: '#fff' }}>Analyze</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Analyze View ──────────────────────────────────────────────────────────
  const videoUrl = selected?.video_url
    ? (selected.video_url.startsWith('http') ? selected.video_url : `${API}${selected.video_url}`)
    : '';
  const reportState = analyses['report'];
  const SAMPLE_QS = context === 'kart'
    ? ['Where am I losing the most time?', "How's my braking into the hairpin?"]
    : ['Which sector needs the most work?', 'How consistent are my lap times?'];

  const allDone = Object.keys(analyses).length > 0 &&
    Object.values(analyses).every(a => a.status === 'done' || a.status === 'skip' || a.status === 'error');

  function TabContent({ panelKey }: { panelKey: PanelKey }) {
    const state = analyses[panelKey];
    if (!state) return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <p className="text-sm" style={{ color: textSec }}>Analysis not started</p>
        <button onClick={() => startAnalysis(selected!.id, context)}
          className="px-5 py-2 rounded-lg font-semibold text-sm" style={{ backgroundColor: red, color: '#fff' }}>
          Run Analysis
        </button>
      </div>
    );

    if (state.status === 'loading') return (
      <div className="flex items-center gap-3 py-10">
        <Loader2 size={14} className="animate-spin shrink-0" style={{ color: green }} />
        <span className="text-sm" style={{ color: textSec }}>
          {PANELS.find(p => p.key === panelKey)?.spinner ?? 'Analysing…'}
        </span>
      </div>
    );

    if (state.status === 'skip') return (
      <div className="rounded-xl p-5 mt-1" style={{ backgroundColor: surface, border: `1px solid ${border}` }}>
        <p className="text-sm font-semibold mb-1">Not pre-loaded</p>
        <p className="text-sm" style={{ color: textSec }}>Run the analysis first to cache this result.</p>
      </div>
    );

    if (state.status === 'error') return (
      <div className="rounded-xl p-4 mt-1" style={{ backgroundColor: 'rgba(255,59,59,0.06)', border: '1px solid rgba(255,59,59,0.12)' }}>
        <p className="text-sm" style={{ color: red }}>{state.result}</p>
      </div>
    );

    if (panelKey === 'report') return (
      <div className="space-y-6">
        {state.scores && (
          <div>
            <SectionLabel>Performance Radar</SectionLabel>
            <RadarScore scores={state.scores} />
          </div>
        )}
        {state.result && (
          <div>
            <SectionLabel>Analysis</SectionLabel>
            <ResultBody markdown={state.result} onSeek={seekTo} />
          </div>
        )}
        {state.driver_style?.tags?.length > 0 && <DriverStyleCard style={state.driver_style} />}
      </div>
    );

    return (
      <div className="space-y-5">
        {panelKey === 'moments' && state.clips && state.clips.length > 0 && (
          <div>
            <SectionLabel>Highlight Clips</SectionLabel>
            <ClipRow clips={state.clips} onSeek={seekTo} />
          </div>
        )}
        {panelKey === 'laps' && state.laps && state.laps.length > 0 && (
          <LapTable laps={state.laps} onSeek={seekTo} />
        )}
        {(panelKey === 'errors' || (panelKey === 'moments' && (!state.clips || !state.clips.length))) && (
          <ResultBody markdown={state.result} onSeek={seekTo} />
        )}
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>

      {/* Header — simplified */}
      <header className="flex items-center justify-between px-5 border-b shrink-0"
        style={{ borderColor: border, height: 48 }}>

        <button onClick={() => setPhase('select')}
          className="flex items-center gap-1.5 text-xs font-medium hover:opacity-70 transition-opacity"
          style={{ color: textSec }}>
          <ArrowLeft size={13} /> Videos
        </button>

        <div className="flex items-center gap-2.5">
          <span className="font-bold text-sm tracking-tight">PitLane AI</span>
          <span className="h-3.5 w-px" style={{ backgroundColor: border }} />
          <span className="text-xs font-semibold px-2 py-0.5 rounded-md"
            style={{ backgroundColor: context === 'f1_sim' ? 'rgba(255,59,59,0.1)' : 'rgba(0,255,135,0.08)', color: context === 'f1_sim' ? red : green, border: `1px solid ${context === 'f1_sim' ? 'rgba(255,59,59,0.18)' : 'rgba(0,255,135,0.15)'}` }}>
            {context === 'f1_sim' ? 'F1 25 Sim' : 'Karting'}
          </span>
          {selected && (
            <>
              <span className="h-3.5 w-px" style={{ backgroundColor: border }} />
              <span className="text-xs truncate max-w-[200px]" style={{ color: textSec }}>
                {selected.filename.replace(/\.mp4$/i, '')}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          {allDone
            ? <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: green }}><CheckCircle size={12} />Ready</span>
            : <span className="flex items-center gap-1.5 text-xs" style={{ color: textSec }}><Loader2 size={12} className="animate-spin" />Analysing…</span>
          }
          <NavDropdown />
        </div>
      </header>

      {/* Workspace */}
      <div className="flex flex-1 min-h-0">

        {/* Left — Video + Timeline + Scores */}
        <div className="flex flex-col border-r overflow-y-auto"
          style={{ width: '54%', borderColor: border, padding: '20px 20px 20px 20px', gap: 12, display: 'flex', flexDirection: 'column' }}>

          {/* Video */}
          <div style={{ borderRadius: 12, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.5)', flexShrink: 0, backgroundColor: '#000' }}>
            {videoUrl ? (
              <video
                ref={videoRef} src={videoUrl} controls autoPlay muted
                onLoadedMetadata={e => setDuration((e.target as HTMLVideoElement).duration)}
                style={{ width: '100%', display: 'block', objectFit: 'contain', maxHeight: '44vh' }}
              />
            ) : (
              <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <p style={{ fontSize: 12, color: textMut }}>No video</p>
              </div>
            )}
          </div>

          {/* Timeline */}
          <MarkerBar duration={duration} markers={markers}
            laps={analyses['laps']?.status === 'done' ? (analyses['laps'].laps ?? []) : []}
            onSeek={seekTo} />

          {/* Score cards — appear when coaching loads */}
          {reportState?.status === 'done' && reportState.scores && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={12} style={{ color: textMut }} />
                <SectionLabel>Performance Scores</SectionLabel>
              </div>
              <ScoreRow scores={reportState.scores} />
            </div>
          )}
          {reportState?.status === 'loading' && (
            <div className="rounded-xl p-4 flex items-center gap-3" style={{ backgroundColor: surface, border: `1px solid ${border}` }}>
              <Loader2 size={13} className="animate-spin shrink-0" style={{ color: green }} />
              <span className="text-xs" style={{ color: textSec }}>Calculating performance scores…</span>
            </div>
          )}
        </div>

        {/* Right — Tabs + Ask */}
        <div className="flex flex-col flex-1 min-h-0">

          {/* Tab bar */}
          <div className="flex items-stretch border-b shrink-0" style={{ borderColor: border, height: 48, paddingLeft: 4 }}>
            {PANELS.map(p => {
              const isActive = activeTab === p.key;
              const st = analyses[p.key]?.status;
              return (
                <button key={p.key} onClick={() => setActiveTab(p.key)}
                  className="flex items-center gap-2 px-5 transition-all relative"
                  style={{
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'var(--text-primary)' : textSec,
                    borderBottom: isActive ? `2px solid ${red}` : '2px solid transparent',
                    marginBottom: -1,
                    background: 'transparent',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}>
                  <p.Icon size={13} />
                  {p.label}
                  <TabStatus status={st} />
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="flex items-center justify-between mb-5">
              <Chip label={PANELS.find(p => p.key === activeTab)?.badge ?? ''} />
              {analyses[activeTab]?.cached && (
                <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: green }}>
                  <CheckCircle size={11} />Cached
                </span>
              )}
            </div>
            <TabContent panelKey={activeTab} />
          </div>

          {/* Ask the Engineer */}
          <div className="shrink-0 border-t px-6 py-4" style={{ borderColor: border }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <MessageSquare size={13} style={{ color: textSec }} />
                <span className="text-sm font-semibold">Ask the Engineer</span>
              </div>
              <Chip label="Race Engineer AI" />
            </div>

            <div className="flex gap-2 mb-2.5 flex-wrap">
              {SAMPLE_QS.map(q => (
                <button key={q} onClick={() => setAskQuestion(q)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all hover:brightness-110"
                  style={{ backgroundColor: 'rgba(255,255,255,0.04)', color: textSec, border: `1px solid ${border}` }}>
                  {q}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                value={askQuestion}
                onChange={e => setAskQuestion(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && submitAsk()}
                placeholder="Ask anything about this video…"
                className="flex-1 px-3 py-2 rounded-lg text-xs outline-none"
                style={{ backgroundColor: surface, color: 'var(--text-primary)', border: `1px solid ${border}` }}
              />
              <button onClick={submitAsk} disabled={!askQuestion.trim() || askLoading}
                className="px-3 py-2 rounded-lg disabled:opacity-40 transition-all hover:brightness-110"
                style={{ backgroundColor: red, color: '#fff' }}>
                {askLoading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              </button>
            </div>

            {askState?.status === 'loading' && (
              <div className="flex items-center gap-2 mt-3">
                <Loader2 size={12} className="animate-spin shrink-0" style={{ color: green }} />
                <span className="text-xs" style={{ color: textSec }}>Analysing your video…</span>
              </div>
            )}
            {askState?.status === 'skip'  && <p className="text-xs mt-2" style={{ color: textMut }}>Not pre-loaded for this video.</p>}
            {askState?.status === 'error' && <p className="text-xs mt-2" style={{ color: red }}>{askState.result}</p>}
            {askState?.status === 'done'  && (
              <div className="mt-3 rounded-xl p-3.5" style={{ backgroundColor: surface, border: `1px solid ${border}`, maxHeight: '18vh', overflowY: 'auto' }}>
                <ResultBody markdown={askState.result} onSeek={seekTo} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
