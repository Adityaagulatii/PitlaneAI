"""
PitLane AI — FastAPI Backend
Wraps the three FiftyOne plugin operators as HTTP endpoints.
No FiftyOne dependency. Uses the Twelve Labs Python SDK directly.
"""

import os
import re
import json
import time
import tempfile
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
    """Re-raise a clear HTTPException if the index lacks Pegasus support."""
    msg = str(e)
    if "index_not_supported_for_generate" in msg:
        raise HTTPException(
            status_code=400,
            detail="This Twelve Labs index was created without Pegasus. Recreate the index with both Marengo + Pegasus engines enabled, then re-upload the video.",
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

def _get_client():
    from twelvelabs import TwelveLabs
    if not TWELVELABS_API_KEY:
        raise HTTPException(status_code=500, detail="TWELVELABS_API_KEY not set.")
    return TwelveLabs(api_key=TWELVELABS_API_KEY)




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


def _parse_lap_table(md: str) -> list:
    laps = []
    for line in md.splitlines():
        if not line.startswith('|') or '---' in line or line.strip().startswith('| Lap'):
            continue
        cells = [c.strip() for c in line.split('|') if c.strip()]
        if len(cells) < 3:
            continue
        try:
            start_parts = cells[1].split(':')
            start_secs = int(start_parts[0]) * 60 + float(start_parts[1])
            laps.append({
                "lap_num":   int(cells[0]),
                "start":     round(start_secs, 1),
                "lap_time":  cells[2],
                "key_issue": cells[3] if len(cells) > 3 else "—",
                "delta":     "—",
                "is_best":   False,
            })
        except Exception:
            continue
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


@app.post("/analyze/errors")
def analyze_errors(body: ErrorsRequest):
    """Find driving errors using Pegasus."""
    try:
        client = _get_client()
        is_f1 = body.context == "f1_sim"
        role  = "Formula 1 race engineer reviewing F1 25 simulator onboard footage" if is_f1 else "expert go-kart race engineer reviewing onboard lap footage"
        result = client.analyze(
            video_id=body.video_id,
            prompt=(
                f"You are an {role}. "
                f"Identify every driving error, focusing on: {body.error_types}. "
                "Group errors into these categories: Racing Line, Braking, Throttle & Traction, Car Control.\n\n"
                "Output ONLY the following markdown, no extra text:\n\n"
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
                "| MM:SS | error name | one-line impact |\n\n"
                "Only include categories that have errors. End with: **Total errors found: N**"
            ),
        )
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

        return {
            "result":        f"## 🏁 Driving Error Analysis\n\n{result.data}",
            "error_clips":   error_clips,       # Marengo visual clips (precise if found)
            "pegasus_text":  result.data,        # Pegasus text for timestamp fallback
        }
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
    try:
        client   = _get_client()
        index_id = _KART_INDEX_ID
        queries  = F1_MOMENT_QUERIES if body.context == "f1_sim" else BEST_MOMENT_QUERIES
        role     = "Formula 1 race engineer" if body.context == "f1_sim" else "expert go-kart race engineer"

        # Marengo: find precise clip timestamps
        clips = []
        md_rows = []
        for query, emoji, label in queries:
            try:
                results = client.search.query(
                    index_id=index_id,
                    query_text=query,
                    search_options=["visual"],
                    page_limit=20,
                )
                for clip in (results.data if hasattr(results, 'data') else results):
                    if clip.video_id == body.video_id:
                        clips.append({
                            "category": label,
                            "emoji": emoji,
                            "start": round(float(clip.start), 1),
                            "end": round(float(clip.end), 1),
                        })
                        md_rows.append(f"| {_fmt_time(clip.start)} | {emoji} {label} |")
                        break
            except Exception:
                continue

        # Pegasus: describe what makes these moments special
        try:
            pegasus_result = client.analyze(
                video_id=body.video_id,
                prompt=(
                    f"You are an {role}. Identify the 3–5 best driving moments in this video. "
                    "For each one give the timestamp (MM:SS) and one sentence explaining why it is impressive. "
                    "Output ONLY a markdown table:\n\n"
                    "| Time | Why It's Great |\n|------|----------------|\n"
                    "| MM:SS | reason |"
                ),
            )
            pegasus_md = pegasus_result.data
        except Exception:
            pegasus_md = ""

        result_md = "## 🌟 Best Moments\n\n"
        if pegasus_md:
            result_md += "### Pegasus Analysis\n" + pegasus_md + "\n\n"
        result_md += "### Marengo Clips\n| Time | Moment |\n|------|--------|\n"
        if md_rows:
            result_md += "\n".join(md_rows)
            result_md += f"\n\n**Total highlights found: {len(clips)}**"
        else:
            result_md += "| — | No highlights found |"

        return {"result": result_md, "clips": clips}
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
    try:
        from groq import Groq

        if not GROQ_API_KEY:
            raise HTTPException(status_code=500, detail="GROQ_API_KEY not set.")

        tl_client   = _get_client()
        groq_client = Groq(api_key=GROQ_API_KEY)

        focus_instruction = {
            "Full Analysis":        "Cover racing line, braking, throttle, and car control.",
            "Racing Line Only":     "Focus only on racing line and corner entry/exit.",
            "Braking Only":         "Focus only on braking points, trail braking, and stopping distances.",
            "Throttle & Exit Only": "Focus only on throttle application, wheelspin, and corner exits.",
        }.get(body.focus or "Full Analysis", "Cover racing line, braking, throttle, and car control.")

        subject = "Formula 1 simulator session (F1 25 game)" if body.context == "f1_sim" else "go-kart onboard lap"
        # Step 1: Pegasus watches the full video
        pegasus_result = tl_client.analyze(
            video_id=body.video_id,
            prompt=(
                f"Watch this entire {subject} carefully. "
                f"{focus_instruction} "
                "Describe in detail everything you observe every 30 seconds with timestamps (MM:SS). "
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
                        f"From these go-kart lap observations, extract performance scores.\n\n"
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

        return {
            "result": report,
            "segments": segments,
            "overall": overall,
            "driver_style": driver_style,
        }
    except HTTPException:
        raise
    except Exception as e:
        _check_pegasus_support(e)
        raise HTTPException(status_code=500, detail=str(e))


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
    try:
        client       = _get_client()
        context_desc = (
            "Formula 1 simulator onboard footage (F1 25 game)"
            if body.context == "f1_sim"
            else "go-kart onboard footage"
        )
        result = client.analyze(
            video_id=body.video_id,
            prompt=(
                f"This is {context_desc}. Analyse every lap in the video. "
                "For each lap identify: when it starts (MM:SS), the lap duration in M:SS format, "
                "and the single most significant driving error in one short sentence (or 'Clean lap' if none). "
                "Output ONLY this markdown table, no extra text:\n\n"
                "| Lap | Start | Time | Key Issue |\n"
                "|-----|-------|------|-----------|\n"
                "| 1 | MM:SS | M:SS | issue |\n"
            ),
        )
        laps = _parse_lap_table(result.data)
        return {"result": result.data, "laps": laps}
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
