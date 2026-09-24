#!/usr/bin/env python3
"""Run repeatable local Ollama model benchmarks and export dashboard JSON."""

import argparse
import ast
import json
import math
import os
import platform
import re
import shutil
import subprocess
import sys
import threading
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from unittest.mock import patch

try:
    import psutil
except ImportError:
    psutil = None


API_ROOT = "http://127.0.0.1:11434"
SAMPLE_INTERVAL_SECONDS = 0.5
MIN_CPU_INTERVAL_SECONDS = SAMPLE_INTERVAL_SECONDS * 0.8
POST_RESPONSE_SAMPLE_TIMEOUT_SECONDS = 4.0
MODEL_KEEP_ALIVE = "10s"
UNLOAD_VERIFY_TIMEOUT_SECONDS = 5.0
GIB = 1024 ** 3
MIB = 1024 ** 2

# These are registry defaults, normally distributed by Ollama in Q4_K_M or a
# similar quantization. The estimates are deliberately rounded up for preflight.
PRESETS = {
    "llama3.2:1b": {
        "family": "Llama 3.2 1B",
        "tier": "small",
        "ram_gb": 4,
        "disk_bytes": 2 * GIB,
    },
    "gemma3:1b": {
        "family": "Gemma 3 1B",
        "tier": "small",
        "ram_gb": 4,
        "disk_bytes": 2 * GIB,
    },
    "phi3:mini": {
        "family": "Phi-3 Mini",
        "tier": "large",
        "ram_gb": 8,
        "disk_bytes": 5 * GIB,
    },
    "mistral:7b": {
        "family": "Mistral 7B",
        "tier": "large",
        "ram_gb": 12,
        "disk_bytes": 6 * GIB,
    },
}

SCENARIOS = {
    "code-fix": {
        "label": "Repository bug fix",
        "prompt": (
            "Correct the bug in this function. An adult is someone aged 18 or "
            "older. Output only the corrected Python function, with no explanation.\n\n"
            "def is_adult(age):\n"
            "    return age > 18"
        ),
    },
    "summarization": {
        "label": "Document summary",
        "prompt": (
            "Summarize the following project note in at most 70 words. Preserve "
            "concrete, verifiable facts; do not add facts.\n\n"
            "On April 14, 2023, 12 students from the Ecology Club planted 18 "
            "native maple saplings in a 20-square-meter plot in the east courtyard "
            "of Greenway University. The university expects the trees to reduce "
            "summer heat and provide habitat for native pollinators. The club will "
            "measure survival every three months for two years. After the first "
            "summer, 94% of the saplings were still alive."
        ),
    },
    "data-extraction": {
        "label": "Structured data extraction",
        "prompt": (
            "Extract the person's details from this note. Return exactly one JSON "
            "object with keys name, age, city, has_membership, and plan. Use a "
            "number for age and a boolean for has_membership; do not add prose.\n\n"
            "Jordan Lee is 21 and lives in Boulder. Jordan has an active membership "
            "and is enrolled in the student plan."
        ),
    },
}

QUANTIZATION_PATTERN = re.compile(
    r"^(?:"
    r"Q(?:2_K|3_K_[SML]|4_[01]|4_K_[SM]|5_[01]|5_K_[SM]|6_K|8_0)"
    r"|IQ(?:1_[SM]|2_(?:XXS|XS|S|M)|3_(?:XXS|XS|S|M)|4_(?:NL|XS))"
    r")$"
)
RUN_RECORD_KEYS = {
    "format", "version", "id", "timestamp", "scenarioId", "scenarioLabel",
    "model", "provider", "runtime", "durationSeconds", "qualityScore",
    "timeToFirstTokenMs", "tokensPerSecond", "peakMemoryGb",
    "averageCpuPercent", "averageGpuPercent", "estimatedCostUsd", "device",
    "resourceTrend",
}

EXPECTED_EXTRACTION = {
    "name": "Jordan Lee",
    "age": 21,
    "city": "Boulder",
    "has_membership": True,
    "plan": "student",
}

SUMMARY_CHECKS = (
    re.compile(r"\bapril\s+14\b.{0,20}\b2023\b|\b2023[-/]04[-/]14\b", re.I | re.S),
    re.compile(r"\b12\b.{0,35}\b(?:students?|volunteers?)\b|\b(?:students?|volunteers?)\b.{0,35}\b12\b", re.I | re.S),
    re.compile(r"\b18\b.{0,35}\bmaple", re.I | re.S),
    re.compile(r"\b20[- ]square[- ]meter|\b20\s*m(?:²|2)\b", re.I),
    re.compile(r"\b94\s*(?:%|percent)\b", re.I),
)


def utc_timestamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def safe_filename(value):
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-._")
    return cleaned[:100] or "model"


def ollama_url(path):
    """Keep every request pinned to the local Ollama loopback service."""
    if not path.startswith("/") or "://" in path or ".." in path:
        raise ValueError("Invalid local Ollama API path.")
    return API_ROOT + path


def is_local_redirect(url):
    parts = urlsplit(url)
    try:
        port = parts.port
    except ValueError:
        return False
    return (
        parts.scheme == "http"
        and parts.hostname == "127.0.0.1"
        and port == 11434
        and parts.username is None
        and parts.password is None
    )


class LocalRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        if not is_local_redirect(newurl):
            raise urllib.error.HTTPError(
                newurl, code, "Refusing Ollama redirect outside 127.0.0.1", headers, fp
            )
        return super().redirect_request(request, fp, code, message, headers, newurl)


LOCAL_OPENER = urllib.request.build_opener(
    urllib.request.ProxyHandler({}),
    LocalRedirectHandler(),
)


def parse_json_response(response):
    if isinstance(response, dict):
        return response
    if not isinstance(response, str):
        return None
    text = response.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.I | re.S)
    if fenced:
        text = fenced.group(1).strip()
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            value = json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            return None
    return value if isinstance(value, dict) else None


def grade_code_fix(response):
    """Safely parse, but never execute, the model's suggested Python."""
    if not isinstance(response, str):
        return 0.0
    fenced = re.search(r"```(?:python)?\s*(.*?)```", response, re.I | re.S)
    candidate = fenced.group(1) if fenced else response
    try:
        tree = ast.parse(candidate)
    except SyntaxError:
        # A few models add prose outside the code; try the first function body.
        match = re.search(r"(?ms)^def\s+is_adult\b.*?(?=^def\s|\Z)", candidate)
        if not match:
            return 0.0
        try:
            tree = ast.parse(match.group(0))
        except SyntaxError:
            return 0.0
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) or node.name != "is_adult":
            continue
        for child in ast.walk(node):
            if not isinstance(child, ast.Compare) or len(child.ops) != 1 or len(child.comparators) != 1:
                continue
            left = child.left
            right = child.comparators[0]
            if (
                isinstance(left, ast.Name) and left.id == "age"
                and isinstance(child.ops[0], ast.GtE)
                and isinstance(right, ast.Constant) and right.value == 18
            ):
                return 100.0
    return 0.0


def grade_data_extraction(response):
    extracted = parse_json_response(response)
    if extracted is None:
        return 0.0
    correct = sum(
        key in extracted and type(extracted[key]) is type(expected) and extracted[key] == expected
        for key, expected in EXPECTED_EXTRACTION.items()
    )
    return round(100.0 * correct / len(EXPECTED_EXTRACTION), 1)


def grade_summary(response):
    if not isinstance(response, str):
        return 0.0
    correct = sum(bool(pattern.search(response)) for pattern in SUMMARY_CHECKS)
    return round(100.0 * correct / len(SUMMARY_CHECKS), 1)


def grade_response(scenario, response):
    if scenario == "code-fix":
        return grade_code_fix(response)
    if scenario == "data-extraction":
        return grade_data_extraction(response)
    if scenario == "summarization":
        return grade_summary(response)
    return None


def generation_speed(response):
    count = response.get("eval_count")
    duration = response.get("eval_duration")
    if (
        isinstance(count, (int, float))
        and isinstance(duration, (int, float))
        and math.isfinite(count)
        and math.isfinite(duration)
        and count >= 0
        and duration > 0
    ):
        return round(float(count) / (float(duration) / 1_000_000_000), 3)
    return None


def ollama_request(method, path, payload=None, timeout=15):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        ollama_url(path),
        data=body,
        headers={"Content-Type": "application/json"} if body is not None else {},
        method=method,
    )
    with LOCAL_OPENER.open(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def ollama_models():
    result = ollama_request("GET", "/api/tags")
    models = result.get("models")
    if not isinstance(models, list):
        raise RuntimeError("Ollama /api/tags returned an invalid model list.")
    return {item.get("name") for item in models if isinstance(item, dict) and isinstance(item.get("name"), str)}


def parse_quantization_level(response):
    if not isinstance(response, dict):
        raise ValueError("Ollama /api/show returned an invalid response.")
    details = response.get("details")
    level = details.get("quantization_level") if isinstance(details, dict) else None
    if not isinstance(level, str) or not level.strip():
        raise ValueError("Ollama did not report details.quantization_level; refusing to assume this model is quantized.")
    level = level.strip().upper()
    if not QUANTIZATION_PATTERN.fullmatch(level):
        raise ValueError(
            "Ollama reports quantization_level " + repr(level)
            + ", which is unknown or unquantized; expected an explicit Q*/IQ* level such as Q4_K_M."
        )
    return level


def ollama_model_quantization(model):
    response = ollama_request("POST", "/api/show", {"model": model})
    return parse_quantization_level(response)


def model_is_installed(model, installed):
    return model in installed or model + ":latest" in installed


def find_ollama_executable():
    return shutil.which("ollama")


def start_ollama_server(executable):
    kwargs = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen([executable, "serve"], **kwargs)
    print("Started the local Ollama service. Waiting for its loopback API...")
    deadline = time.monotonic() + 30
    last_error = None
    while time.monotonic() < deadline:
        try:
            ollama_models()
            return
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as error:
            last_error = error
            time.sleep(1)
    raise RuntimeError("Ollama did not start within 30 seconds: " + str(last_error))


def confirm_downloads(models, auto_confirm):
    if not auto_confirm:
        if not sys.stdin.isatty():
            raise RuntimeError("Downloads need an interactive confirmation; pass --yes together with --pull to confirm explicitly.")
        choices = ", ".join(models)
        answer = input("Download missing Ollama models (" + choices + ")? This may use several GB of disk. Type 'yes' to continue: ")
        if answer.strip().lower() != "yes":
            raise RuntimeError("Model download cancelled; no files were pulled.")


def ollama_models_dir():
    custom = os.environ.get("OLLAMA_MODELS")
    if custom:
        return Path(custom).expanduser()
    return Path.home() / ".ollama" / "models"


def available_disk_bytes(path):
    target = path
    while not target.exists() and target != target.parent:
        target = target.parent
    if not target.exists():
        raise RuntimeError("Cannot find a location to check free space for Ollama models: " + str(path))
    return shutil.disk_usage(str(target)).free


def pull_model(model, expected_bytes, timeout):
    target_dir = ollama_models_dir()
    free_bytes = available_disk_bytes(target_dir)
    safety_bytes = 512 * MIB
    if free_bytes < expected_bytes + safety_bytes:
        raise RuntimeError(
            "Not enough free disk space to pull " + model + ": about "
            + format_gb(expected_bytes + safety_bytes) + " required, "
            + format_gb(free_bytes) + " available at " + str(target_dir) + "."
        )
    print("Pulling " + model + " (estimated download up to " + format_gb(expected_bytes) + ")...")
    request = urllib.request.Request(
        ollama_url("/api/pull"),
        data=json.dumps({"name": model, "stream": True}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.monotonic()
    with LOCAL_OPENER.open(request, timeout=timeout) as response:
        for raw_line in response:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError as error:
                raise RuntimeError("Ollama returned invalid pull progress JSON.") from error
            if event.get("error"):
                raise RuntimeError("Ollama could not pull " + model + ": " + str(event["error"]))
            total = event.get("total")
            completed = event.get("completed")
            if isinstance(total, (int, float)) and total > free_bytes - safety_bytes:
                raise RuntimeError(
                    "Ollama reported a download larger than the free-space safety limit. "
                    "Stopped reading pull progress; check whether Ollama continues the pull in the background."
                )
            status = event.get("status")
            if status and isinstance(total, (int, float)) and total > 0 and isinstance(completed, (int, float)):
                percent = min(100, int(completed * 100 / total))
                print("\r  " + str(status) + ": " + str(percent) + "%", end="", flush=True)
            elif status:
                print("  " + str(status))
    print()
    if time.monotonic() - started > timeout:
        print("  Pull took longer than the socket timeout setting but completed.")


WORKER_PROCESS_PATTERN = re.compile(r"\brunner\b|llama[_ -]?server|model[_ -]?runner", re.I)


def process_identity(process):
    parts = []
    info = getattr(process, "info", None)
    info = info if isinstance(info, dict) else {}
    if isinstance(info, dict):
        for key in ("name", "exe", "cmdline"):
            value = info.get(key)
            if isinstance(value, (list, tuple)):
                parts.extend(item for item in value if isinstance(item, str))
            elif isinstance(value, str):
                parts.append(value)
    for name in ("name", "exe", "cmdline"):
        if info.get(name):
            continue
        try:
            value = getattr(process, name)()
        except (AttributeError, OSError, RuntimeError, TypeError):
            continue
        if isinstance(value, (list, tuple)):
            parts.extend(item for item in value if isinstance(item, str))
        elif isinstance(value, str):
            parts.append(value)
    return " ".join(parts).casefold()


def is_ollama_worker_identity(identity):
    return "ollama" in identity.casefold() and bool(WORKER_PROCESS_PATTERN.search(identity))


def is_ollama_service_identity(identity):
    lowered = identity.casefold()
    return (
        "ollama" in lowered
        and not is_ollama_worker_identity(lowered)
        and bool(re.search(r"\bserve\b", lowered))
    )


def collect_ollama_workers():
    """Find named Ollama workers and descendants of the Ollama service, excluding the service itself."""
    found = {}
    if psutil is None:
        return found
    roots = []
    for process in psutil.process_iter(attrs=["pid", "name", "exe", "cmdline"]):
        try:
            identity = process_identity(process)
            if is_ollama_worker_identity(identity):
                found[process.pid] = process
            if is_ollama_service_identity(identity):
                roots.append(process)
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess, OSError):
            continue
    for process in roots:
        try:
            for child in process.children(recursive=True):
                if (
                    child.pid != process.pid
                    and not is_ollama_service_identity(process_identity(child))
                ):
                    found[child.pid] = child
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess, OSError):
            continue
    return found


class ProcessSampler(threading.Thread):
    def __init__(self):
        threading.Thread.__init__(self, name="ollama-process-sampler", daemon=True)
        self.stop_event = threading.Event()
        self.sample_event = threading.Event()
        self.points = []
        self.cpu_samples = []
        self.peak_memory_gb = 0.0
        self.worker_memory_observations = 0
        self.in_generation_worker_memory_observations = 0
        self.post_response_worker_observations = 0
        self.in_generation_cpu_intervals = 0
        self.post_response_cpu_intervals = 0
        self.generation_started_at = None
        self.response_completed_at = None
        self.previous_cpu = {}
        self.logical_cpus = (psutil.cpu_count(logical=True) or 1) if psutil is not None else 1

    def run(self):
        while not self.stop_event.is_set():
            self.sample()
            self.stop_event.wait(SAMPLE_INTERVAL_SECONDS)

    def sample(self):
        if psutil is None:
            self.sample_event.set()
            return
        now = time.monotonic()
        current_cpu = {}
        worker_cpu_percent = 0.0
        in_generation_cpu_interval = False
        post_response_cpu_interval = False
        memory_bytes = 0
        processes = collect_ollama_workers()
        for pid, process in processes.items():
            try:
                created = process.create_time()
                key = (pid, created)
                times = process.cpu_times()
                cpu_total = times.user + times.system
                memory_bytes += process.memory_info().rss
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
            previous = self.previous_cpu.get(key)
            if previous is not None:
                previous_cpu, previous_time = previous
                elapsed = now - previous_time
                if elapsed >= MIN_CPU_INTERVAL_SECONDS:
                    delta = max(0.0, cpu_total - previous_cpu)
                    if (
                        self.generation_started_at is not None
                        and previous_time >= self.generation_started_at
                        and (
                            self.response_completed_at is None
                            or now < self.response_completed_at
                        )
                    ):
                        worker_cpu_percent += delta / elapsed / self.logical_cpus * 100.0
                        in_generation_cpu_interval = True
                    elif (
                        self.response_completed_at is not None
                        and previous_time >= self.response_completed_at
                    ):
                        post_response_cpu_interval = True
            current_cpu[key] = (cpu_total, now)
        self.previous_cpu = current_cpu

        if memory_bytes > 0:
            self.worker_memory_observations += 1
            in_generation_sample = (
                self.generation_started_at is not None
                and now >= self.generation_started_at
                and (
                    self.response_completed_at is None
                    or now < self.response_completed_at
                )
            )
            if in_generation_sample:
                self.in_generation_worker_memory_observations += 1
                memory_gb = memory_bytes / GIB
                self.peak_memory_gb = max(self.peak_memory_gb, memory_gb)
            if self.response_completed_at is not None and now >= self.response_completed_at:
                self.post_response_worker_observations += 1
            memory_gb = memory_bytes / GIB
            if in_generation_sample and in_generation_cpu_interval:
                cpu_percent = min(100.0, max(0.0, worker_cpu_percent))
                self.cpu_samples.append(cpu_percent)
                self.in_generation_cpu_intervals += 1
                self.points.append({
                    "timestamp": utc_timestamp(),
                    "cpuPercent": round(cpu_percent, 3),
                    "memoryGb": round(memory_gb, 6),
                    "gpuPercent": None,
                })
                if len(self.points) > 1200:
                    self.points = self.points[::2]
            if post_response_cpu_interval:
                self.post_response_cpu_intervals += 1
        self.sample_event.set()

    def mark_generation_started(self, started_at=None):
        self.generation_started_at = time.monotonic() if started_at is None else started_at
        self.sample_event.set()

    def mark_generation_complete(self, completed_at=None):
        self.response_completed_at = time.monotonic() if completed_at is None else completed_at
        self.sample_event.set()

    def wait_for_post_response_measurements(self, timeout):
        deadline = time.monotonic() + timeout
        while not (
            self.post_response_worker_observations > 0
            and self.post_response_cpu_intervals > 0
        ):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            self.sample_event.wait(remaining)
            self.sample_event.clear()
        return True

    def stop(self):
        self.stop_event.set()
        self.join(timeout=5)
        if self.is_alive():
            raise RuntimeError("Ollama process sampling did not stop cleanly.")

    def result(self):
        if not self.worker_memory_observations:
            raise RuntimeError(
                "No Ollama model worker memory was observed; an API response from the persistent Ollama server "
                "alone is not a valid benchmark. Check worker visibility/permissions; no telemetry file was written."
            )
        if not self.in_generation_worker_memory_observations or self.peak_memory_gb <= 0:
            raise RuntimeError(
                "No Ollama model worker memory was observed while the generation request was in flight; "
                "increase --num-predict or use a longer generation workload; no telemetry file was written."
            )
        if not self.post_response_worker_observations:
            raise RuntimeError(
                "No Ollama model worker memory sample was observed after generation completed; "
                "no telemetry file was written."
            )
        if not self.in_generation_cpu_intervals or not self.cpu_samples or not self.points:
            raise RuntimeError(
                "No Ollama model worker CPU delta interval was collected while generation was in flight; "
                "increase --num-predict or use a longer generation workload; no telemetry file was written."
            )
        if not self.post_response_cpu_intervals:
            raise RuntimeError(
                "No Ollama model worker CPU delta interval was collected after generation completed; "
                "no telemetry file was written."
            )
        return {
            "averageCpuPercent": round(sum(self.cpu_samples) / len(self.cpu_samples), 3),
            "peakMemoryGb": round(self.peak_memory_gb, 6),
            "resourceTrend": self.points,
        }


def generate(model, prompt, num_predict, timeout):
    return ollama_request(
        "POST",
        "/api/generate",
        {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "keep_alive": MODEL_KEEP_ALIVE,
            "options": {"temperature": 0, "num_predict": num_predict},
        },
        timeout=timeout,
    )


def unload_model(model, timeout=15):
    response = ollama_request(
        "POST",
        "/api/generate",
        {"model": model, "keep_alive": 0},
        timeout=min(timeout, 15),
    )
    if not isinstance(response, dict) or response.get("error"):
        raise RuntimeError("Ollama did not confirm the unload request for " + model + ".")
    deadline = time.monotonic() + UNLOAD_VERIFY_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        result = ollama_request("GET", "/api/ps", timeout=10)
        loaded = result.get("models") if isinstance(result, dict) else None
        if not isinstance(loaded, list):
            raise RuntimeError("Ollama /api/ps returned an invalid loaded-model list; unload cannot be verified.")
        loaded_names = set()
        for item in loaded:
            if isinstance(item, dict):
                for key in ("name", "model"):
                    if isinstance(item.get(key), str):
                        loaded_names.add(item[key])
        if not model_is_installed(model, loaded_names):
            return
        time.sleep(0.25)
    raise RuntimeError(
        "Ollama still reports " + model + " as loaded after the unload request; stopping before another model runs."
    )


def device_info():
    total_ram = psutil.virtual_memory().total / GIB
    cpu = platform.processor().strip() or platform.machine() or "Unknown"
    return {
        "machineLabel": platform.node() or "This computer",
        "operatingSystem": (platform.system() + " " + platform.release()).strip(),
        "cpu": cpu,
        "gpu": "Not measured",
        "memoryGb": round(total_ram, 3),
    }


def run_one(model, scenario, repetition, args):
    spec = SCENARIOS[scenario]
    print("  " + scenario + " (repeat " + str(repetition) + ")", flush=True)
    sampler = ProcessSampler()
    sampler.start()
    generation_started = time.monotonic()
    sampler.mark_generation_started(generation_started)
    try:
        response = generate(model, spec["prompt"], args.num_predict, args.timeout_seconds)
        generation_finished = time.monotonic()
        sampler.mark_generation_complete(generation_finished)
        metrics_ready = sampler.wait_for_post_response_measurements(
            POST_RESPONSE_SAMPLE_TIMEOUT_SECONDS
        )
    finally:
        sampler.stop()
    if not metrics_ready:
        sampler.result()
        raise RuntimeError(
            "No post-response Ollama model worker CPU/RAM measurements were collected; no telemetry file was written."
        )
    duration = max(0.0, generation_finished - generation_started)
    measured = sampler.result()
    text = response.get("response")
    if not isinstance(text, str):
        raise RuntimeError("Ollama generation response did not contain model output.")
    speed = generation_speed(response)
    if speed is None:
        raise RuntimeError("Ollama did not report valid eval_count/eval_duration; run was not exported.")
    quality = grade_response(scenario, text)
    return {
        "format": "model-telemetry-run",
        "version": 1,
        "id": str(uuid.uuid4()),
        "timestamp": utc_timestamp(),
        "scenarioId": scenario,
        "scenarioLabel": spec["label"],
        "model": model,
        "provider": "Ollama",
        "runtime": "local",
        "durationSeconds": round(duration, 3),
        "qualityScore": quality,
        "timeToFirstTokenMs": None,
        "tokensPerSecond": speed,
        "peakMemoryGb": measured["peakMemoryGb"],
        "averageCpuPercent": measured["averageCpuPercent"],
        "averageGpuPercent": None,
        "estimatedCostUsd": None,
        "device": device_info(),
        "resourceTrend": measured["resourceTrend"],
    }


def write_result(output_dir, result, repetition):
    output_dir.mkdir(parents=True, exist_ok=True)
    name = "-".join((
        safe_filename(result["model"]),
        safe_filename(result["scenarioId"]),
        "run-" + str(repetition),
        datetime.now().strftime("%Y%m%d-%H%M%S"),
    )) + ".json"
    path = output_dir / name
    suffix = 1
    while path.exists():
        suffix += 1
        path = output_dir / (name[:-5] + "-" + str(suffix) + ".json")
    path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def format_gb(value):
    return str(round(value / GIB, 1)) + " GB"


def validate_args(parser, args):
    if args.repeat < 1 or args.repeat > 10:
        parser.error("--repeat must be between 1 and 10.")
    if args.num_predict < 16 or args.num_predict > 512:
        parser.error("--num-predict must be between 16 and 512.")
    if args.timeout_seconds < 15 or args.timeout_seconds > 1800:
        parser.error("--timeout-seconds must be between 15 and 1800.")
    if args.models:
        models = args.models
    else:
        models = ["llama3.2:1b", "gemma3:1b"]
        if args.include_larger:
            models.extend(["phi3:mini", "mistral:7b"])
    larger = [model for model in models if PRESETS[model]["tier"] == "large"]
    if larger and not args.include_larger:
        parser.error("Larger presets need explicit opt-in: add --include-larger.")
    return models


def check_model_resources(model, spec):
    total = psutil.virtual_memory().total / GIB
    available = psutil.virtual_memory().available / GIB
    if total < spec["ram_gb"]:
        return (
            "Skipping " + model + ": this computer has " + str(round(total, 1))
            + " GB total RAM; preset minimum is " + str(spec["ram_gb"]) + " GB."
        )
    available_required = max(2.0, spec["ram_gb"] * 0.35)
    if available < available_required:
        return (
            "Skipping " + model + ": only " + str(round(available, 1))
            + " GB RAM is currently available; close other apps or try later (need about "
            + str(round(available_required, 1)) + " GB free)."
        )
    return None


def build_parser():
    parser = argparse.ArgumentParser(
        description="Run standardized, local-only LLM workloads through Ollama and export dashboard JSON."
    )
    parser.add_argument(
        "--models", nargs="+", choices=tuple(PRESETS),
        help="Selected installed Ollama tags. Larger Phi/Mistral tags also require --include-larger.",
    )
    parser.add_argument(
        "--include-larger", action="store_true",
        help="Opt in to Phi-3 Mini and Mistral 7B when using the default preset list.",
    )
    parser.add_argument(
        "--pull", action="store_true",
        help="Allow missing selected models to be downloaded after explicit confirmation.",
    )
    parser.add_argument(
        "--yes", action="store_true",
        help="Confirm downloads non-interactively; valid only with --pull.",
    )
    parser.add_argument(
        "--start-ollama", action="store_true",
        help="If the local API is unavailable, start `ollama serve` from PATH.",
    )
    parser.add_argument("--scenarios", nargs="+", choices=tuple(SCENARIOS), default=list(SCENARIOS))
    parser.add_argument("--repeat", type=int, default=1, help="Repetitions per model and workload (1-10; default 1).")
    parser.add_argument("--num-predict", type=int, default=160, help="Maximum generated tokens per workload (16-512).")
    parser.add_argument("--timeout-seconds", type=int, default=180, help="Per-request timeout (15-1800 seconds).")
    parser.add_argument("--output-dir", type=Path, default=Path("telemetry-runs"), help="Directory for exported run JSON files.")
    parser.add_argument("--self-test", action="store_true", help="Run local standard-library unit tests and exit.")
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.self_test:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(PureFunctionTests)
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        return 0 if result.wasSuccessful() else 1
    if args.yes and not args.pull:
        parser.error("--yes only applies together with --pull.")
    models = validate_args(parser, args)
    if len(set(models)) != len(models):
        parser.error("Do not list a model more than once.")
    total_runs = len(models) * len(args.scenarios) * args.repeat
    if total_runs > 30:
        parser.error(
            "This run would create " + str(total_runs) + " files; the dashboard import stores up to 30 runs. "
            "Select fewer models, scenarios, or repetitions."
        )
    if psutil is None:
        print(
            "Error: psutil is required for process-level CPU/RAM sampling. Install it with: "
            "python -m pip install psutil",
            file=sys.stderr,
        )
        return 2

    try:
        ollama_models()
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as error:
        if not args.start_ollama:
            print("Error: Ollama is not reachable at " + API_ROOT + ".", file=sys.stderr)
            print("Install Ollama and open it, or rerun with --start-ollama if `ollama` is on PATH.", file=sys.stderr)
            print("Details: " + str(error), file=sys.stderr)
            return 2
        executable = find_ollama_executable()
        if executable is None:
            print("Error: `ollama` was not found on PATH; install Ollama first.", file=sys.stderr)
            return 2
        try:
            start_ollama_server(executable)
        except (OSError, RuntimeError) as start_error:
            print("Error: " + str(start_error), file=sys.stderr)
            return 2

    try:
        installed = ollama_models()
    except Exception as error:
        print("Error: cannot list local Ollama models: " + str(error), file=sys.stderr)
        return 2
    missing = [model for model in models if not model_is_installed(model, installed)]
    if missing and not args.pull:
        print("These selected models are not installed: " + ", ".join(missing), file=sys.stderr)
        print("Rerun with --pull to review and confirm local model downloads.", file=sys.stderr)
        return 1
    if missing:
        try:
            confirm_downloads(missing, args.yes)
        except RuntimeError as error:
            print("Error: " + str(error), file=sys.stderr)
            return 1

    for model in missing:
        spec = PRESETS[model]
        warning = check_model_resources(model, spec)
        if warning:
            print(warning, file=sys.stderr)
            return 1
        try:
            pull_model(model, spec["disk_bytes"], args.timeout_seconds)
        except (urllib.error.URLError, TimeoutError, OSError, RuntimeError, ValueError) as error:
            print("Error pulling " + model + ": " + str(error), file=sys.stderr)
            return 1
    try:
        installed = ollama_models()
    except Exception as error:
        print("Error: cannot verify locally installed models: " + str(error), file=sys.stderr)
        return 2
    still_missing = [model for model in models if not model_is_installed(model, installed)]
    if still_missing:
        print("Error: Ollama did not install the requested model tags: " + ", ".join(still_missing), file=sys.stderr)
        return 1

    skipped_models = []
    runnable_models = []
    quantization_levels = {}
    for model in models:
        try:
            quantization = ollama_model_quantization(model)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, RuntimeError, ValueError) as error:
            print(
                "Skipping " + model + ": quantization could not be verified from Ollama /api/show ("
                + str(error) + "). No benchmark was run for this model.",
                file=sys.stderr,
            )
            skipped_models.append(model)
            continue
        quantization_levels[model] = quantization
        print("Verified " + model + " quantization: " + quantization)
        warning = check_model_resources(model, PRESETS[model])
        if warning:
            print(warning, file=sys.stderr)
            skipped_models.append(model)
        else:
            runnable_models.append(model)
    if not runnable_models:
        print("No selected model fits the current memory checks; no benchmark was run.", file=sys.stderr)
        return 1

    print(
        "Local Ollama benchmark: "
        + ", ".join(model + " (" + quantization_levels[model] + ")" for model in runnable_models)
    )
    print("Workloads: " + ", ".join(args.scenarios) + " · repetitions: " + str(args.repeat))
    print("Results are written locally to: " + str(args.output_dir.expanduser().resolve()))
    print("The output contains measurements and objective task scores, not prompts or model responses.")
    written = []
    failed = []
    for model in runnable_models:
        for repetition in range(1, args.repeat + 1):
            for scenario in args.scenarios:
                try:
                    result = run_one(model, scenario, repetition, args)
                    path = write_result(args.output_dir.expanduser(), result, repetition)
                    written.append(path)
                    print(
                        "    quality " + str(result["qualityScore"]) + "/100 · "
                        + str(result["tokensPerSecond"]) + " tok/s · "
                        + str(result["averageCpuPercent"]) + "% CPU · "
                        + str(round(result["peakMemoryGb"], 2)) + " GB peak RAM"
                    )
                except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, RuntimeError, ValueError) as error:
                    message = model + " / " + scenario + " / run " + str(repetition) + ": " + str(error)
                    failed.append(message)
                    print("    FAILED: " + str(error), file=sys.stderr)
        try:
            unload_model(model, args.timeout_seconds)
            print("Unloaded " + model + " after its measurements.")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, RuntimeError, ValueError) as error:
            message = model + " could not be unloaded and verified: " + str(error)
            failed.append(message)
            print("Error: " + message + " Stopping before another model runs.", file=sys.stderr)
            break
    print("\nExported " + str(len(written)) + " measured run file(s).")
    if written:
        print("Import all *.json files from " + str(args.output_dir.expanduser().resolve()) + " in the dashboard.")
    if skipped_models:
        print("Skipped models: " + ", ".join(skipped_models), file=sys.stderr)
    if failed:
        print(
            str(len(failed)) + " workload/cleanup issue(s); unsuccessful workloads have no JSON file.",
            file=sys.stderr,
        )
        return 1
    return 0


class PureFunctionTests(unittest.TestCase):
    def test_loopback_api_cannot_be_redirected_to_remote_host(self):
        self.assertEqual(ollama_url("/api/tags"), API_ROOT + "/api/tags")
        self.assertTrue(is_local_redirect("http://127.0.0.1:11434/api/tags"))
        self.assertFalse(is_local_redirect("https://example.com/api/tags"))
        self.assertFalse(is_local_redirect("http://127.0.0.1.evil.test:11434/api/tags"))
        self.assertFalse(is_local_redirect("http://127.0.0.1:9999/api/tags"))
        with self.assertRaises(ValueError):
            ollama_url("https://example.com/api/tags")
        with self.assertRaises(ValueError):
            ollama_url("/../other-host")

    def test_show_response_requires_explicit_quantized_format(self):
        self.assertEqual(
            parse_quantization_level({"details": {"quantization_level": "Q4_K_M"}}),
            "Q4_K_M",
        )
        self.assertEqual(
            parse_quantization_level({"details": {"quantization_level": "IQ4_XS"}}),
            "IQ4_XS",
        )
        for level in ("F16", "F32", "unknown", "Q4", "Q999_TEST", ""):
            with self.subTest(level=level):
                with self.assertRaises(ValueError):
                    parse_quantization_level({"details": {"quantization_level": level}})
        with self.assertRaisesRegex(ValueError, "did not report"):
            parse_quantization_level({"details": {}})
        with patch(
            __name__ + ".ollama_request",
            return_value={"details": {"quantization_level": "Q5_K_M"}},
        ) as request:
            self.assertEqual(ollama_model_quantization("mistral:7b"), "Q5_K_M")
            request.assert_called_once_with("POST", "/api/show", {"model": "mistral:7b"})

    def test_worker_sampler_rejects_server_only_and_requires_post_response_worker(self):
        class FakePsutil:
            class NoSuchProcess(Exception):
                pass

            class AccessDenied(Exception):
                pass

            class ZombieProcess(Exception):
                pass

            @staticmethod
            def cpu_count(logical=True):
                return 2

            @staticmethod
            def process_iter(attrs):
                return []

        class FakeWorker:
            pid = 42

            def __init__(self):
                self.cpu_values = iter((0.0, 0.2, 0.9, 1.6))
                self.memory_values = iter((512 * MIB, 512 * MIB, 2 * GIB, 2 * GIB))

            def create_time(self):
                return 1.0

            def cpu_times(self):
                return type("CpuTimes", (), {"user": next(self.cpu_values), "system": 0.0})()

            def memory_info(self):
                return type("MemoryInfo", (), {"rss": next(self.memory_values)})()

        self.assertFalse(is_ollama_worker_identity("ollama serve"))
        self.assertTrue(is_ollama_worker_identity("ollama runner --ollama-engine"))
        self.assertTrue(is_ollama_worker_identity("ollama_llama_server.exe"))
        self.assertTrue(is_ollama_service_identity("ollama serve"))
        self.assertFalse(is_ollama_service_identity("Ollama GUI"))
        self.assertFalse(is_ollama_service_identity("ollama_llama_server.exe"))

        server = type(
            "FakeOllamaServer",
            (),
            {
                "pid": 7,
                "info": {
                    "name": "ollama",
                    "exe": "/usr/local/bin/ollama",
                    "cmdline": ["ollama", "serve"],
                },
                "children": lambda self, recursive=True: [],
            },
        )()
        with (
            patch(__name__ + ".psutil", FakePsutil),
            patch(__name__ + ".psutil.process_iter", return_value=[server]),
            patch(__name__ + ".time.monotonic", return_value=1.0),
        ):
            self.assertEqual(collect_ollama_workers(), {})
            server_only = ProcessSampler()
            server_only.mark_generation_complete(completed_at=0.5)
            server_only.sample()
            with self.assertRaisesRegex(RuntimeError, "persistent Ollama server"):
                server_only.result()

        with (
            patch(__name__ + ".psutil", FakePsutil),
            patch(__name__ + ".collect_ollama_workers", side_effect=lambda: {worker.pid: worker}),
            patch(__name__ + ".time.monotonic", side_effect=(0.5, 1.0, 1.5)),
        ):
            worker = FakeWorker()
            post_only = ProcessSampler()
            post_only.mark_generation_started(started_at=0.0)
            post_only.mark_generation_complete(completed_at=0.25)
            post_only.sample()
            post_only.sample()
            post_only.sample()
        self.assertTrue(post_only.wait_for_post_response_measurements(timeout=0))
        self.assertGreater(post_only.post_response_cpu_intervals, 0)
        self.assertEqual(post_only.in_generation_worker_memory_observations, 0)
        self.assertEqual(post_only.in_generation_cpu_intervals, 0)
        with self.assertRaisesRegex(RuntimeError, "increase --num-predict"):
            post_only.result()

        with (
            patch(__name__ + ".psutil", FakePsutil),
            patch(__name__ + ".collect_ollama_workers", side_effect=lambda: {worker.pid: worker}),
            patch(__name__ + ".time.monotonic", side_effect=(0.0, 0.5, 1.0, 1.5)),
        ):
            worker = FakeWorker()
            during_and_after = ProcessSampler()
            during_and_after.mark_generation_started(started_at=0.0)
            during_and_after.sample()
            during_and_after.sample()
            during_and_after.mark_generation_complete(completed_at=0.75)
            during_and_after.sample()
            during_and_after.sample()
        self.assertTrue(during_and_after.wait_for_post_response_measurements(timeout=0))
        self.assertEqual(during_and_after.in_generation_cpu_intervals, 1)
        self.assertEqual(during_and_after.post_response_cpu_intervals, 1)
        measured = during_and_after.result()
        self.assertEqual(measured["averageCpuPercent"], 20.0)
        self.assertEqual(measured["peakMemoryGb"], 0.5)
        self.assertEqual(len(measured["resourceTrend"]), 1)

    def test_generation_speed_uses_ollama_eval_metrics(self):
        self.assertEqual(generation_speed({"eval_count": 20, "eval_duration": 2_000_000_000}), 10.0)
        self.assertIsNone(generation_speed({"eval_count": 20, "eval_duration": 0}))
        self.assertIsNone(generation_speed({"eval_count": None, "eval_duration": 100}))

    def test_generation_keeps_worker_resident_and_unload_is_verified(self):
        with patch(__name__ + ".ollama_request", return_value={"response": "ok"}) as request:
            generate("llama3.2:1b", "test", 16, 30)
            self.assertEqual(request.call_args.args[2]["keep_alive"], MODEL_KEEP_ALIVE)
        with (
            patch(
                __name__ + ".ollama_request",
                side_effect=(
                    {"done": True},
                    {"models": [{"name": "llama3.2:1b"}]},
                    {"models": []},
                ),
            ) as request,
            patch(__name__ + ".time.sleep"),
        ):
            unload_model("llama3.2:1b")
        self.assertEqual(request.call_args_list[0].args[:2], ("POST", "/api/generate"))
        self.assertEqual(request.call_args_list[0].args[2], {"model": "llama3.2:1b", "keep_alive": 0})
        self.assertEqual(request.call_args_list[-1].args[:2], ("GET", "/api/ps"))

    def test_code_fix_grader_parses_without_execution(self):
        good = "```python\ndef is_adult(age):\n    return age >= 18\n```"
        bad = "def is_adult(age):\n    return age > 18"
        self.assertEqual(grade_code_fix(good), 100.0)
        self.assertEqual(grade_code_fix(bad), 0.0)
        self.assertEqual(grade_code_fix("__import__('os').system('echo unsafe')"), 0.0)

    def test_data_extraction_grader_counts_exact_fields(self):
        answer = json.dumps(EXPECTED_EXTRACTION)
        self.assertEqual(grade_data_extraction(answer), 100.0)
        partial = json.dumps({"name": "Jordan Lee", "age": "21"})
        self.assertEqual(grade_data_extraction(partial), 20.0)
        self.assertEqual(grade_data_extraction("not json"), 0.0)

    def test_summary_grader_is_limited_to_declared_fact_checks(self):
        summary = "On April 14, 2023, 12 students planted 18 maple trees in a 20-square-meter plot; 94 percent survived."
        self.assertEqual(grade_summary(summary), 100.0)
        self.assertEqual(grade_summary("A general summary with no stated facts."), 0.0)

    def test_filenames_are_safe_and_speed_uses_no_estimates(self):
        self.assertEqual(safe_filename("mistral:7b / test"), "mistral-7b-test")
        self.assertLessEqual(len(safe_filename("x" * 200)), 100)
        self.assertIsNone(generation_speed({}))

    def test_mock_run_exports_dashboard_compatible_record(self):
        class FakeSampler:
            def start(self):
                pass

            def mark_generation_started(self, started_at=None):
                pass

            def mark_generation_complete(self, completed_at=None):
                pass

            def wait_for_post_response_measurements(self, timeout):
                return True

            def stop(self):
                pass

            def result(self):
                return {
                    "averageCpuPercent": 12.5,
                    "peakMemoryGb": 1.25,
                    "resourceTrend": [{
                        "timestamp": utc_timestamp(),
                        "cpuPercent": 12.5,
                        "memoryGb": 1.25,
                        "gpuPercent": None,
                    }],
                }

        response = {
            "response": json.dumps(EXPECTED_EXTRACTION),
            "eval_count": 20,
            "eval_duration": 2_000_000_000,
        }
        args = argparse.Namespace(num_predict=160, timeout_seconds=180)
        with (
            patch(__name__ + ".ProcessSampler", FakeSampler),
            patch(__name__ + ".generate", return_value=response),
            patch(__name__ + ".device_info", return_value={
                "machineLabel": "Test Laptop",
                "operatingSystem": "Test OS",
                "cpu": "Test CPU",
                "gpu": "Not measured",
                "memoryGb": 8.0,
            }),
            patch(__name__ + ".time.monotonic", side_effect=(100.0, 102.5)),
        ):
            result = run_one("llama3.2:1b", "data-extraction", 1, args)
        with tempfile.TemporaryDirectory() as directory:
            path = write_result(Path(directory), result, 1)
            saved = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(set(saved), RUN_RECORD_KEYS)
        self.assertEqual(saved["format"], "model-telemetry-run")
        self.assertEqual(saved["scenarioLabel"], "Structured data extraction")
        self.assertEqual(saved["qualityScore"], 100.0)
        self.assertEqual(saved["tokensPerSecond"], 10.0)
        self.assertEqual(saved["durationSeconds"], 2.5)
        self.assertIsNone(saved["averageGpuPercent"])
        self.assertIsNone(saved["timeToFirstTokenMs"])
        self.assertIsNone(saved["estimatedCostUsd"])
        self.assertNotIn("response", saved)
        self.assertLessEqual(len(saved["resourceTrend"]), 1200)


if __name__ == "__main__":
    sys.exit(main())