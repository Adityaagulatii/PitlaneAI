"""
PitLane AI — FastAPI Backend
v2 — parallel Pegasus calls for full-video coverage on long F1 25 sessions.
Wraps the three FiftyOne plugin operators as HTTP endpoints.
No FiftyOne dependency. Uses the Twelve Labs Python SDK directly.
"""

import os
import re
import json
import time
import tempfile
import httpx
from typing import Optional
from pathlib import Path
from urllib.parse import quote

from dotenv import load_dotenv, find_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from twelvelabs.errors import TooManyRequestsError

def _check_pegasus_support(e: Exception):
    """Re-raise a clear HTTPException for known Twelve Labs plan/index errors."""
    msg = str(e)
    if "index_not_supported_for_generate" in msg:
        raise HTTPException(
            status_code=400,
            detail="This Twelve Labs index was created without Pegasus. Recreate the index with both Marengo + Pegasus engines enabled, then re-upload the video.",
        )
    if "usage_limit_exceeded" in msg:
        raise HTTPException(
            status_code=402,
            detail="Twelve Labs plan limit reached — too many indexed videos. Delete unused indexes on the Twelve Labs dashboard to free up quota.",
        )

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=_env_path, override=True)
if not os.environ.get("TWELVELABS_API_KEY") and _env_path.exists():
    for _line in _env_path.read_text(encoding="utf-8").splitlines():
        if "=" in _line and not _line.strip().startswith("#"):
            _k, _, _v = _line.partition("=")
            os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))
TWELVELABS_API_KEY = os.environ.get("TWELVELABS_API_KEY", "")
GROQ_API_KEY       = os.environ.get("GROQ_API_KEY", "")

# ---------------------------------------------------------------------------
# App + CORS
# ---------------------------------------------------------------------------

app = FastAPI(title="PitLane AI Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_kart_clips_dir = Path(__file__).parent.parent / "kart_clips"
_f1_clips_dir   = Path(__file__).parent.parent / "f1 25"

# ---------------------------------------------------------------------------
# Twelve Labs client + index cache
# ---------------------------------------------------------------------------

_KART_INDEX_ID = os.environ.get("KART_INDEX_ID", "69cee50121ee25d048439f9e")

_DEFAULT_TIMEOUT = httpx.Timeout(connect=30.0, read=120.0, write=30.0, pool=30.0)
_LONG_TIMEOUT    = httpx.Timeout(connect=30.0, read=600.0, write=30.0, pool=30.0)

def _get_client(long: bool = False):
    from twelvelabs import TwelveLabs
    if not TWELVELABS_API_KEY:
        raise HTTPException(status_code=500, detail="TWELVELABS_API_KEY not set.")
    return TwelveLabs(api_key=TWELVELABS_API_KEY, timeout=_LONG_TIMEOUT if long else _DEFAULT_TIMEOUT)


# ---------------------------------------------------------------------------
# Demo mode — skip all live API calls, serve cache only
# ---------------------------------------------------------------------------
DEMO_MODE = True

# ---------------------------------------------------------------------------
# Analysis cache (file-backed, keyed by video_id + analysis type + context)
# ---------------------------------------------------------------------------

_CACHE_FILE = Path(__file__).parent / "analysis_cache.json"
_cache: dict = {}

def _load_cache():
    global _cache
    if _CACHE_FILE.exists():
        try:
            _cache = json.loads(_CACHE_FILE.read_text(encoding="utf-8"))
        except Exception:
            _cache = {}

def _save_cache():
    _CACHE_FILE.write_text(json.dumps(_cache, ensure_ascii=False, indent=2), encoding="utf-8")

def _cache_get(key: str):
    if not _cache:
        _load_cache()
    return _cache.get(key)

def _cache_set(key: str, value):
    if not _cache:
        _load_cache()
    _cache[key] = value
    _save_cache()

_load_cache()


# ---------------------------------------------------------------------------
# Shared constants (verbatim from __init__.py)
# ---------------------------------------------------------------------------

BEST_MOMENT_QUERIES = [
    ("kart hitting apex smoothly on corner entry",  "🎯", "Smooth Apex"),
    ("smooth throttle acceleration out of corner",  "🚀", "Clean Acceleration"),
    ("kart at full speed on straight",              "⚡", "Fast Straight"),
    ("optimal racing line through corner",          "📐", "Perfect Racing Line"),
    ("controlled progressive braking before turn",  "🛑", "Smooth Braking"),
    ("impressive fast exciting driving moment",     "🏆", "Impressive Moment"),
]

ERROR_MOMENT_QUERIES = [
    ("kart braking too late overrunning corner",          "Late Braking"),
    ("kart running wide at corner exit off racing line",  "Wide Exit"),
    ("kart wheel spin or sudden loss of traction",        "Wheel Spin"),
    ("driver missing apex cutting inside incorrectly",    "Missed Apex"),
    ("kart understeer or oversteer losing control",       "Car Control Error"),
]

F1_ERROR_QUERIES = [
    ("Formula 1 car braking too late overrunning corner",  "Late Braking"),
    ("F1 car running wide at corner exit",                 "Wide Exit"),
    ("Formula 1 car wheel spin exit traction loss",        "Traction Loss"),
    ("F1 car understeering missing apex",                  "Understeer"),
    ("F1 car locking up wheels under braking",             "Lock-up"),
    ("F1 car failed overtake attempt divebomb or collision", "Failed Overtake"),
]

F1_MOMENT_QUERIES = [
    ("Formula 1 car perfect apex and clean corner exit",   "🎯", "Perfect Corner"),
    ("F1 car smooth overtake move on another car",         "⚡", "Clean Overtake"),
    ("Formula 1 car smooth late braking into corner",      "🛑", "Smooth Braking"),
    ("F1 car at maximum speed on straight",                "🚀", "Top Speed"),
    ("Formula 1 car impressive fast exciting moment",      "🏆", "Highlight Moment"),
]


def _parse_lap_secs(t: str) -> Optional[float]:
    """Parse 'M:SS.s' or 'M:SS' lap time string into float seconds."""
    try:
        parts = t.strip().split(':')
        return int(parts[0]) * 60 + float(parts[1])
    except Exception:
        return None


def _parse_lap_table(md: str, total_secs=None) -> list:
    laps = []
    for line in md.splitlines():
        if not line.startswith('|'):
            continue
        stripped = line.replace('-', '').replace('|', '').strip()
        if not stripped:
            continue
        cells = [c.strip() for c in line.split('|') if c.strip()]
        if len(cells) < 2:
            continue
        if not re.search(r'\d', cells[0]):
            continue
        try:
            lap_num = int(re.sub(r'[^\d]', '', cells[0]))
            start_match = re.search(r'(\d+):(\d+(?:\.\d+)?)', cells[1])
            if not start_match:
                continue
            start_secs = int(start_match.group(1)) * 60 + float(start_match.group(2))
            if total_secs is not None and start_secs >= total_secs:
                continue
            key_issue  = cells[2] if len(cells) > 2 else "—"
            laps.append({
                "lap_num":   lap_num,
                "start":     round(start_secs, 1),
                "lap_time":  "—",
                "key_issue": key_issue,
                "delta":     "—",
                "is_best":   False,
            })
        except Exception:
            continue
    # compute lap durations from consecutive start times
    for i, lap in enumerate(laps):
        next_start = laps[i + 1]["start"] if i + 1 < len(laps) else total_secs
        if next_start is not None:
            dur = next_start - lap["start"]
            m, s = divmod(dur, 60)
            lap["lap_time"] = f"{int(m)}:{s:04.1f}"
    # compute deltas vs best
    times = [_parse_lap_secs(l["lap_time"]) for l in laps]
    best  = min((t for t in times if t is not None), default=None)
    for i, lap in enumerate(laps):
        t = times[i]
        if t is not None and best is not None:
            lap["delta"]   = "BEST" if t == best else f"+{t - best:.1f}s"
            lap["is_best"] = t == best
    return laps


def _fmt_time(seconds: float) -> str:
    m = int(seconds) // 60
    s = int(seconds) % 60
    return f"{m:02d}:{s:02d}"


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class ErrorsRequest(BaseModel):
    video_id: str
    error_types: Optional[str] = "all driving errors"
    context: str = "kart"

class BestMomentsRequest(BaseModel):
    video_id: str
    context: str = "kart"

class AskRequest(BaseModel):
    video_id: str
    question: str
    context: str = "kart"

class CoachingReportRequest(BaseModel):
    video_id: str
    focus: Optional[str] = "Full Analysis"
    context: str = "kart"

class LapsRequest(BaseModel):
    video_id: str
    context: str = "f1_sim"
    duration_secs: Optional[int] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok"}

def _is_f1_video(filename: str) -> bool:
    """Videos present in the f1_25 local folder are treated as F1 Sim."""
    return (_f1_clips_dir / filename).exists()





@app.get("/videos")
def list_videos(context: str = ""):
    """List videos from kart index, filtered by filename convention.
    'f1_sim' → filenames containing 'f1'; 'kart' → all others; '' → all."""
    try:
        client = _get_client()
        videos = []
        try:
            raw = list(client.indexes.videos.list(_KART_INDEX_ID))
        except Exception:
            raw = []
        for v in raw:
            try:
                video = client.indexes.videos.retrieve(_KART_INDEX_ID, v.id)
                sm = getattr(video, "system_metadata", None)
                filename = (getattr(sm, "filename", None) if sm else None) or f"{v.id}.mp4"
                is_f1 = _is_f1_video(filename)
                if context == "f1_sim" and not is_f1:
                    continue
                if context == "kart" and is_f1:
                    continue
                hls = getattr(video, "hls", None)
                if (_kart_clips_dir / filename).exists():
                    video_url = f"/kart_clips/{quote(filename)}"
                elif (_f1_clips_dir / filename).exists():
                    video_url = f"/f1_25/{quote(filename)}"
                else:
                    video_url = getattr(hls, "video_url", None)
                thumb_list = getattr(hls, "thumbnail_urls", None) if hls else None
                videos.append({"id": v.id, "filename": filename, "video_url": video_url, "thumbnail_url": thumb_list[0] if thumb_list else None})
            except Exception:
                continue
        return {"videos": videos}
    except HTTPException:
        raise
    except TooManyRequestsError as e:
        raise HTTPException(status_code=429, detail="Twelve Labs rate limit reached (50 req/day). Try again tomorrow.")
    except Exception as e:
        _check_pegasus_support(e)
        raise HTTPException(status_code=500, detail=str(e))


def _errors_prompt(role: str, start_label: str, end_label: str, is_f1: bool = False) -> str:
    categories = (
        "Racing Line, Braking, Throttle & Traction, Car Control, Overtaking"
        if is_f1 else
        "Racing Line, Braking, Throttle & Traction, Car Control"
    )
    extra_section = (
        "\n### 🟣 Overtaking\n"
        "| Time | Error | Impact |\n"
        "|------|-------|--------|\n"
        "| MM:SS | error name | one-line impact |\n"
    ) if is_f1 else ""
    return (
        f"You are an {role}. "
        f"Watch ONLY the segment from {start_label} to {end_label} and find every driving mistake you can identify in that segment. "
        f"Assign each mistake to exactly ONE category ({categories}). "
        "Report timestamps as MM:SS. Do NOT invent timestamps outside the segment range.\n\n"
        "Output ONLY this markdown:\n\n"
        "### 🔴 Racing Line\n"
        "| Time | Error | Impact |\n"
        "|------|-------|--------|\n"
        "| MM:SS | error name | one-line impact |\n\n"
        "### 🟡 Braking\n"
        "| Time | Error | Impact |\n"
        "|------|-------|--------|\n"
        "| MM:SS | error name | one-line impact |\n\n"
        "### 🟠 Throttle & Traction\n"
        "| Time | Error | Impact |\n"
        "|------|-------|--------|\n"
        "| MM:SS | error name | one-line impact |\n\n"
        "### 🔵 Car Control\n"
        "| Time | Error | Impact |\n"
        "|------|-------|--------|\n"
        "| MM:SS | error name | one-line impact |\n"
        + extra_section +
        "\nOnly include categories that have errors."
    )


@app.post("/analyze/errors")
def analyze_errors(body: ErrorsRequest):
    """Find driving errors using Pegasus."""
    cache_key = f"errors:{body.video_id}:{body.context}"
    if cache_key:
        cached = _cache_get(cache_key)
        if cached:
            return {**cached, "cached": True}
    if DEMO_MODE:
        return {"result": "", "error_clips": [], "pegasus_text": "", "demo_skip": True}
    try:
        from concurrent.futures import ThreadPoolExecutor, as_completed
        client = _get_client(long=True)
        is_f1 = body.context == "f1_sim"
        role  = "Formula 1 race engineer reviewing F1 25 simulator onboard footage" if is_f1 else "expert go-kart race engineer reviewing onboard lap footage"

        # Always use 2 parallel calls to guarantee full-video coverage
        segments = [("0:00", "7:00"), ("7:00", "14:00"), ("14:00", "21:00")] if is_f1 else [("0:00", "2:30"), ("2:30", "end")]

        def _call(seg):
            return client.analyze(
                video_id=body.video_id,
                prompt=_errors_prompt(role, seg[0], seg[1], is_f1=is_f1),
            )
        parts = []
        first_error = None
        with ThreadPoolExecutor(max_workers=len(segments)) as pool:
            futures = {pool.submit(_call, seg): seg for seg in segments}
            for fut in as_completed(futures):
                try:
                    parts.append(fut.result().data)
                except Exception as seg_err:
                    if first_error is None:
                        first_error = seg_err
        if not parts:
            if first_error:
                _check_pegasus_support(first_error)
                raise first_error
            raise HTTPException(status_code=500, detail="All Pegasus segments failed.")
        combined = "\n\n".join(parts)
        index_id    = _KART_INDEX_ID
        error_clips = []
        queries     = F1_ERROR_QUERIES if is_f1 else ERROR_MOMENT_QUERIES
        for query, label in queries:
            try:
                results = client.search.query(
                    index_id=index_id,
                    query_text=query,
                    search_options=["visual"],
                    page_limit=20,
                )
                for clip in (results.data if hasattr(results, 'data') else results):
                    if clip.video_id == body.video_id:
                        error_clips.append({
                            "start": round(float(clip.start), 1),
                            "end":   round(float(clip.end),   1),
                        })
                        break
            except Exception:
                continue

        payload = {
            "result":       f"## 🏁 Driving Error Analysis\n\n{combined}",
            "error_clips":  error_clips,
            "pegasus_text": combined,
        }
        if cache_key:
            _cache_set(cache_key, payload)
        return {**payload, "cached": False}
    except HTTPException:
        raise
    except TooManyRequestsError:
        raise HTTPException(status_code=429, detail="Twelve Labs rate limit reached (50 req/day). Try again tomorrow.")
    except Exception as e:
        _check_pegasus_support(e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze/best-moments")
def analyze_best_moments(body: BestMomentsRequest):
    """Find best driving moments using Marengo (clips) + Pegasus (description)."""
    cache_key = f"moments:{body.video_id}:{body.context}"
    if cache_key:
        cached = _cache_get(cache_key)
        if cached:
            return {**cached, "cached": True}
    if DEMO_MODE:
        return {"result": "", "clips": [], "demo_skip": True}
    try:
        client   = _get_client()
        index_id = _KART_INDEX_ID
        queries  = F1_MOMENT_QUERIES if body.context == "f1_sim" else BEST_MOMENT_QUERIES
        role     = "Formula 1 race engineer" if body.context == "f1_sim" else "expert go-kart race engineer"

        # Marengo: find precise clip timestamps — take up to 3 per query to spread across full video
        clips = []
        seen_starts: set = set()
        for query, emoji, label in queries:
            try:
                results = client.search.query(
                    index_id=index_id,
                    query_text=query,
                    search_options=["visual"],
                    page_limit=50,
                )
                found = 0
                for clip in (results.data if hasattr(results, 'data') else results):
                    if clip.video_id != body.video_id:
                        continue
                    s = round(float(clip.start), 1)
                    # skip if within 30s of an already-added clip
                    if any(abs(s - seen) < 30 for seen in seen_starts):
                        continue
                    seen_starts.add(s)
                    clips.append({
                        "category": label,
                        "emoji": emoji,
                        "start": s,
                        "end": round(float(clip.end), 1),
                    })
                    found += 1
                    if found >= 3:
                        break
            except Exception:
                continue
        clips.sort(key=lambda c: c["start"])

        # Pegasus: describe what makes these moments special
        # For F1 (long video): 3 separate calls per segment so output cap doesn't truncate early
        try:
            if body.context == "f1_sim":
                from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed
                def _moments_call(seg_start, seg_end):
                    return client.analyze(
                        video_id=body.video_id,
                        prompt=(
                            f"You are an {role}. Watch ONLY from {seg_start} to {seg_end}. "
                            "Identify the 2–3 best driving moments in that segment. "
                            "For each give the exact timestamp (MM:SS) and one sentence why it is impressive. "
                            "Output ONLY a markdown table:\n\n"
                            "| Time | Why It's Great |\n|------|----------------|\n"
                            "| MM:SS | reason |"
                        ),
                    )
                rows = []
                with ThreadPoolExecutor(max_workers=3) as pool:
                    futs = [pool.submit(_moments_call, s, e) for s, e in [("0:00","7:00"),("7:00","14:00"),("14:00","21:00")]]
                    for fut in _as_completed(futs):
                        try:
                            rows.append(fut.result().data)
                        except Exception:
                            pass
                # Merge all rows under a single table header
                merged_rows = []
                for chunk in rows:
                    for line in chunk.splitlines():
                        if line.startswith("| ") and not line.startswith("| Time") and "---" not in line:
                            merged_rows.append(line)
                pegasus_md = "| Time | Why It's Great |\n|------|----------------|\n" + "\n".join(merged_rows)
            else:
                pegasus_result = client.analyze(
                    video_id=body.video_id,
                    prompt=(
                        f"You are an {role}. Identify the 3–5 best driving moments in this video. "
                        "For each give the timestamp (MM:SS) and one sentence explaining why it is impressive. "
                        "Output ONLY a markdown table:\n\n"
                        "| Time | Why It's Great |\n|------|----------------|\n"
                        "| MM:SS | reason |"
                    ),
                )
                pegasus_md = pegasus_result.data
        except Exception:
            pegasus_md = ""

        payload = {"result": pegasus_md or "", "clips": clips}
        if cache_key:
            _cache_set(cache_key, payload)
        return {**payload, "cached": False}
    except HTTPException:
        raise
    except TooManyRequestsError:
        raise HTTPException(status_code=429, detail="Twelve Labs rate limit reached. Try again tomorrow.")
    except Exception as e:
        _check_pegasus_support(e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze/ask")
def analyze_ask(body: AskRequest):
    """Ask anything about the video using Pegasus."""
    try:
        client = _get_client()
        role   = "Formula 1 race engineer" if body.context == "f1_sim" else "expert go-kart race engineer"
        result = client.analyze(
            video_id=body.video_id,
            prompt=(
                f"You are an {role}. Answer this question: {body.question}\n\n"
                "Format your response in markdown using EXACTLY this structure:\n\n"
                "### ✅ Verdict\n"
                "One bold sentence direct answer (yes/no + why).\n\n"
                "### 📍 Key Moments\n"
                "| Time | Observation |\n"
                "|------|-------------|\n"
                "| MM:SS | what is happening at this timestamp |\n\n"
                "### 💡 Recommendation\n"
                "One or two sentences on what to do differently or keep doing.\n\n"
                "Be concise, specific, and use racing terminology."
            ),
        )
        return {"result": f"## 💬 {body.question}\n\n{result.data}"}
    except HTTPException:
        raise
    except TooManyRequestsError as e:
        raise HTTPException(status_code=429, detail="Twelve Labs rate limit reached (50 req/day). Try again tomorrow.")
    except Exception as e:
        _check_pegasus_support(e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze/coaching-report")
def analyze_coaching_report(body: CoachingReportRequest):
    """Generate a full coaching report using Pegasus + Groq LLaMA (two-step pipeline)."""
    cache_key = f"coaching:{body.video_id}:{body.context}:{body.focus or 'Full Analysis'}"
    cached = _cache_get(cache_key)
    if cached:
        return {**cached, "cached": True}
    if DEMO_MODE:
        return {"result": "", "segments": [], "overall": {}, "driver_style": {}, "demo_skip": True}
    try:
        from groq import Groq

        if not GROQ_API_KEY:
            raise HTTPException(status_code=500, detail="GROQ_API_KEY not set.")

        tl_client   = _get_client(long=True)
        groq_client = Groq(api_key=GROQ_API_KEY)

        focus_instruction = {
            "Full Analysis":        "Cover racing line, braking, throttle, and car control.",
            "Racing Line Only":     "Focus only on racing line and corner entry/exit.",
            "Braking Only":         "Focus only on braking points, trail braking, and stopping distances.",
            "Throttle & Exit Only": "Focus only on throttle application, wheelspin, and corner exits.",
        }.get(body.focus or "Full Analysis", "Cover racing line, braking, throttle, and car control.")

        subject = "Formula 1 simulator session (F1 25 game)" if body.context == "f1_sim" else "go-kart onboard lap"
        is_long = body.context == "f1_sim"
        # Step 1: Pegasus watches the full video
        # For long videos (21 min), use milestone timestamps to force full coverage instead of "every 30s"
        if is_long:
            coverage = (
                "Observe the driver at these 8 milestone timestamps spread across the full session: "
                "0:00, 3:00, 6:00, 9:00, 12:00, 15:00, 18:00, 21:00. "
                "For each timestamp give 2–3 factual sentences on what the driver is doing."
            )
        else:
            coverage = "Describe in detail everything you observe every 30 seconds with timestamps (MM:SS)."
        pegasus_result = tl_client.analyze(
            video_id=body.video_id,
            prompt=(
                f"Watch this entire {subject} carefully. "
                f"{focus_instruction} "
                f"{coverage} "
                "Be raw, factual, and detailed — this will be reviewed by a race engineer."
            ),
        )
        raw_observations = pegasus_result.data

        # Step 2: Groq extracts structured scores
        scores_response = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": "You are a data analyst. Extract numerical scores from lap observations. Respond with valid JSON only.",
                },
                {
                    "role": "user",
                    "content": (
                        f"From these {subject} observations, extract performance scores.\n\n"
                        f"{raw_observations}\n\n"
                        "Return JSON in exactly this format:\n"
                        '{"segments":[{"time":"0:00","racing_line":7,"braking":6,"throttle":8}],'
                        '"overall":{"racing_line":7,"braking":6,"throttle":8,"consistency":7}}'
                        "\nScore each metric 1-10. JSON only, no extra text."
                    ),
                },
            ],
            temperature=0.1,
            max_tokens=800,
        )

        try:
            scores_text = scores_response.choices[0].message.content.strip()
            if "```" in scores_text:
                scores_text = scores_text.split("```")[1].lstrip("json").strip()
            scores_data = json.loads(scores_text)
            segments = scores_data.get("segments", [])
            overall  = scores_data.get("overall", {})
        except Exception:
            segments = []
            overall  = {"racing_line": 6, "braking": 6, "throttle": 6, "consistency": 6}

        rl = overall.get("racing_line", "?")
        br = overall.get("braking", "?")
        th = overall.get("throttle", "?")

        # Step 3: Groq writes the coaching report
        report_response = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a professional karting race engineer with 20 years experience. "
                        "Write precise, actionable coaching reports — data-driven, specific, no fluff."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Raw lap observations:\n{raw_observations}\n\n"
                        f"Performance scores by segment: {json.dumps(segments)}\n"
                        f"Overall scores: {json.dumps(overall)}\n\n"
                        f"Write a professional coaching report:\n\n"
                        f"## PERFORMANCE SUMMARY\n"
                        f"2-3 sentences overall assessment.\n\n"
                        f"## RACING LINE  (score: {rl}/10)\n"
                        f"- Specific observations with timestamps\n\n"
                        f"## BRAKING POINTS  (score: {br}/10)\n"
                        f"- Specific observations with timestamps\n\n"
                        f"## THROTTLE & EXIT SPEED  (score: {th}/10)\n"
                        f"- Specific observations with timestamps\n\n"
                        f"## LAP TIME LOSSES\n"
                        f"Estimate time lost per sector in tenths of seconds.\n\n"
                        f"## TOP 3 PRIORITY IMPROVEMENTS\n"
                        f"1. [Specific corner + timestamp + what to do differently]\n"
                        f"2.\n"
                        f"3.\n\n"
                        f"## OVERALL RATING: X/10\n"
                        f"Biggest strength: ...\n"
                        f"Biggest weakness: ..."
                    ),
                },
            ],
            temperature=0.3,
            max_tokens=1200,
        )
        report = report_response.choices[0].message.content

        # Step 4: Groq generates driver style profile
        driver_style = {"archetype": "Unknown Driver", "tags": []}
        try:
            style_response = groq_client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {
                        "role": "system",
                        "content": "You are a karting analyst. Return valid JSON only, no extra text.",
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Scores — Racing Line: {rl}/10, Braking: {br}/10, Throttle: {th}/10\n"
                            f"Key observations (first 400 chars): {raw_observations[:400]}\n\n"
                            "Return JSON with exactly this shape:\n"
                            '{"archetype":"2-3 word driver archetype (e.g. Raw Charger, Smooth Operator)","tags":['
                            '{"label":"3-4 word style descriptor","emoji":"one relevant emoji","sentiment":"positive|negative|neutral"}'
                            "]} — exactly 4 tags. JSON only."
                        ),
                    },
                ],
                temperature=0.4,
                max_tokens=200,
            )
            style_text = style_response.choices[0].message.content.strip()
            if "```" in style_text:
                style_text = style_text.split("```")[1].lstrip("json").strip()
            driver_style = json.loads(style_text)
        except Exception:
            pass

        payload = {
            "result": report,
            "segments": segments,
            "overall": overall,
            "driver_style": driver_style,
        }
        _cache_set(cache_key, payload)
        return {**payload, "cached": False}
    except HTTPException:
        raise
    except Exception as e:
        _check_pegasus_support(e)
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/cache/{video_id}")
def clear_video_cache(video_id: str):
    """Remove all cached analysis results for a specific video."""
    _load_cache()
    keys_removed = [k for k in list(_cache.keys()) if video_id in k]
    for k in keys_removed:
        del _cache[k]
    if keys_removed:
        _save_cache()
    return {"removed": keys_removed}

@app.get("/cache/status")
def cache_status():
    """Return all cached analysis keys."""
    _load_cache()
    return {"cached_keys": list(_cache.keys())}


@app.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    """Upload a user video to Twelve Labs and wait for indexing."""
    try:
        client   = _get_client()
        index_id = _KART_INDEX_ID
        safe_name = re.sub(r'[^\x00-\x7F]', '_', file.filename or "upload.mp4")
        suffix    = Path(safe_name).suffix or ".mp4"

        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        try:
            with open(tmp_path, "rb") as f:
                task = client.tasks.create(
                    index_id=index_id,
                    video_file=(safe_name, f, "video/mp4"),
                )
            task_id = getattr(task, "id", None) or getattr(task, "task_id", None)
            if not task_id:
                raise Exception("Could not get task ID from upload response.")

            for _ in range(120):
                status_obj = client.tasks.retrieve(task_id)
                status     = getattr(status_obj, "status", "")
                if status == "ready":
                    video_id = getattr(status_obj, "video_id", None)
                    return {"video_id": video_id, "filename": safe_name, "status": "ready"}
                if status in ("failed", "error"):
                    raise Exception(f"Twelve Labs indexing failed: {status}")
                time.sleep(5)
            raise Exception("Indexing timed out after 10 minutes.")
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
    except HTTPException:
        raise
    except TooManyRequestsError:
        raise HTTPException(status_code=429, detail="Twelve Labs rate limit reached.")
    except Exception as e:
        _check_pegasus_support(e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/clear-history")
def clear_history():
    """Clear all analysis fields from every sample in the FiftyOne dataset."""
    try:
        import fiftyone as fo
        FIELDS = ["lap_errors", "best_moments", "ask_moments", "coaching_moments"]
        if not fo.dataset_exists("pitlane-ai"):
            return {"result": "Dataset not found."}
        dataset = fo.load_dataset("pitlane-ai")
        cleared = 0
        for sample in dataset:
            changed = False
            for field in FIELDS:
                try:
                    if sample.get_field(field) is not None:
                        sample[field] = None
                        changed = True
                except Exception:
                    pass
            if changed:
                sample.save()
                cleared += 1
        return {"result": f"Cleared analysis data from {cleared} video(s)."}
    except Exception as e:
        _check_pegasus_support(e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze/laps")
def analyze_laps(body: LapsRequest):
    """Detect laps and summarise each one using Pegasus (single call)."""
    cache_key = f"laps:{body.video_id}:{body.context}"
    cached = _cache_get(cache_key)
    if cached:
        return {**cached, "cached": True}
    if DEMO_MODE:
        return {"result": "", "laps": [], "demo_skip": True}
    try:
        from concurrent.futures import ThreadPoolExecutor, as_completed
        client       = _get_client(long=True)
        context_desc = (
            "Formula 1 simulator onboard footage (F1 25 game)"
            if body.context == "f1_sim"
            else "go-kart onboard footage"
        )

        dur_secs = body.duration_secs
        dur_label = f"{dur_secs // 60}:{dur_secs % 60:02d}" if dur_secs else None
        dur_note  = (
            f" The video is exactly {dur_label} long — do NOT report any timestamp beyond {dur_label}."
            if dur_label else ""
        )

        def _lap_call(seg_start: str, seg_end: str) -> str:
            r = client.analyze(
                video_id=body.video_id,
                prompt=(
                    f"You are analysing {context_desc}."
                    + dur_note
                    + " Watch the entire video and find each real LAP — a lap starts when the car crosses "
                    "the start/finish line or when the in-game lap counter increments. "
                    "Each lap in a 4-minute race is roughly 50-90 seconds; do NOT report sections shorter "
                    "than 30 seconds as separate laps. "
                    "For each lap report only (a) the timestamp it STARTS and (b) the single most significant "
                    "driving error in that lap (or 'Clean lap' if none). "
                    "Only use timestamps you directly observe — do NOT fabricate or extrapolate."
                    + dur_note
                    + "\n\nOutput ONLY this exact markdown table, no other text:\n\n"
                    "| Lap | Start | Key Issue |\n"
                    "|-----|-------|-----------|\n"
                    "| 1 | 0:00 | issue |\n"
                ),
            )
            return r.data

        combined_md = _lap_call("0:00", "end")

        laps = _parse_lap_table(combined_md, total_secs=dur_secs)
        payload = {"result": combined_md, "laps": laps}
        _cache_set(cache_key, payload)
        return {**payload, "cached": False}
    except HTTPException:
        raise
    except TooManyRequestsError:
        raise HTTPException(status_code=429, detail="Twelve Labs rate limit reached (50 req/day). Try again tomorrow.")
    except Exception as e:
        _check_pegasus_support(e)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Serve local kart clips as static video files
# ---------------------------------------------------------------------------

if _kart_clips_dir.exists():
    app.mount("/kart_clips", StaticFiles(directory=str(_kart_clips_dir)), name="kart_clips")

if _f1_clips_dir.exists():
    app.mount("/f1_25", StaticFiles(directory=str(_f1_clips_dir)), name="f1_25")

# ---------------------------------------------------------------------------
# Serve React web app (must come LAST — catches all unmatched routes)
# ---------------------------------------------------------------------------

_static_dir = Path(__file__).parent / "static"

if _static_dir.exists():
    app.mount("/assets", StaticFiles(directory=_static_dir / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        """Serve the React SPA for any non-API route."""
        return FileResponse(_static_dir / "index.html")
