#!/usr/bin/env python3
"""Collect laptop-side resource telemetry while a user-supplied command runs."""

import argparse
import json
import math
import os
import platform
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

try:
    import psutil
except ImportError:
    psutil = None


SCENARIOS = {
    "code-fix": "Code fix",
    "summarization": "Summarization",
    "data-extraction": "Data extraction",
}
SAMPLE_INTERVAL_SECONDS = 0.5
GIB = 1024 ** 3


def timestamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def non_negative(value):
    try:
        number = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be a number") from exc
    if not math.isfinite(number) or number < 0:
        raise argparse.ArgumentTypeError("must be a finite, non-negative number")
    return number


def quality_value(value):
    number = non_negative(value)
    if number > 100:
        raise argparse.ArgumentTypeError("must be between 0 and 100")
    return number


def build_parser():
    parser = argparse.ArgumentParser(
        description=(
            "Measure local CPU and memory while running a command. "
            "All collection stays on this computer."
        )
    )
    parser.add_argument("--model", required=True, help="Model name or identifier")
    parser.add_argument("--provider", required=True, help="Model provider or publisher")
    parser.add_argument("--runtime", required=True, choices=("local", "cloud-client"))
    parser.add_argument("--scenario", required=True, choices=tuple(SCENARIOS))
    parser.add_argument("--scenario-label", help="Readable scenario name (defaults to the scenario name)")
    parser.add_argument("--output", default="telemetry-run.json", help="JSON output path (default: telemetry-run.json)")
    parser.add_argument(
        "--include-process",
        action="append",
        default=[],
        metavar="NAME",
        help="Also measure processes whose name or executable contains NAME (repeatable)",
    )
    parser.add_argument("--quality", type=quality_value, help="Manually supplied quality score from 0 to 100")
    parser.add_argument("--cost", type=non_negative, help="Manually supplied estimated cost in USD")
    parser.add_argument("--tokens-per-second", type=non_negative, help="Manually supplied tokens per second")
    parser.add_argument(
        "command",
        nargs=argparse.REMAINDER,
        help="Command to run; place it after --, for example: -- python my_test.py",
    )
    return parser


def process_name_matches(process, needles):
    try:
        attrs = process.as_dict(attrs=["name", "exe", "cmdline"], ad_value="")
    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
        return False
    values = [attrs.get("name") or "", attrs.get("exe") or ""]
    command = attrs.get("cmdline") or []
    if command:
        values.append(os.path.basename(command[0]))
    candidates = [str(value).casefold() for value in values if value]
    return any(needle in candidate for needle in needles for candidate in candidates)


def collect_targets(root_process, include_names):
    targets = {}

    def add_tree(process):
        try:
            family = [process] + process.children(recursive=True)
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            family = [process]
        for item in family:
            targets[item.pid] = item

    add_tree(root_process)
    if include_names:
        needles = [name.casefold() for name in include_names if name.strip()]
        try:
            processes = psutil.process_iter()
            for process in processes:
                if process_name_matches(process, needles):
                    add_tree(process)
        except (psutil.Error, OSError) as exc:
            print(f"Warning: could not inspect all processes for --include-process: {exc}", file=sys.stderr)
    return targets


def process_label(process):
    try:
        return process.name()
    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
        return f"pid {process.pid}"


def cpu_description():
    description = platform.processor().strip()
    if not description and sys.platform.startswith("linux"):
        try:
            with open("/proc/cpuinfo", encoding="utf-8", errors="replace") as cpuinfo:
                for line in cpuinfo:
                    if line.lower().startswith("model name"):
                        description = line.split(":", 1)[-1].strip()
                        break
        except OSError:
            pass
    return description or platform.machine() or "Unknown"


def take_sample(root_process, include_names, logical_cpus, seen_included, cpu_state):
    targets = collect_targets(root_process, include_names)
    cpu_time_delta = 0.0
    memory_total = 0
    observed_processes = 0
    current_cpu_times = {}
    sampled_at = time.monotonic()
    elapsed = max(0.0, sampled_at - cpu_state["last_time"])
    for pid, process in targets.items():
        try:
            memory_total += process.memory_info().rss
            observed_processes += 1
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
        try:
            process_key = (pid, process.create_time())
            times = process.cpu_times()
            total_cpu_time = times.user + times.system
            previous_cpu_time = cpu_state["process_times"].get(process_key)
            if previous_cpu_time is not None:
                cpu_time_delta += max(0.0, total_cpu_time - previous_cpu_time)
            current_cpu_times[process_key] = total_cpu_time
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue

    if include_names:
        needles = [name.casefold() for name in include_names if name.strip()]
        for process in targets.values():
            if process.pid == root_process.pid:
                continue
            if process_name_matches(process, needles) and process.pid not in seen_included:
                seen_included.add(process.pid)
                print(
                    f"Including named process: {process_label(process)} (pid {process.pid})",
                    file=sys.stderr,
                )

    if observed_processes == 0:
        return None
    cpu_state["last_time"] = sampled_at
    cpu_state["process_times"] = current_cpu_times
    return {
        "timestamp": timestamp(),
        "cpuPercent": round(
            min(100.0, max(0.0, cpu_time_delta / max(elapsed, 1e-9) / logical_cpus * 100.0)),
            3,
        ),
        "memoryGb": round(memory_total / GIB, 6),
        "gpuPercent": None,
    }


def run(args):
    if psutil is None:
        print(
            "Error: psutil is required. Install it with: python -m pip install psutil",
            file=sys.stderr,
        )
        return 2
    command = args.command
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        print("Error: provide a command to run after --.", file=sys.stderr)
        return 2

    logical_cpus = psutil.cpu_count(logical=True) or 1
    start_time = time.monotonic()
    try:
        child = subprocess.Popen(command, shell=False)
    except OSError as exc:
        print(f"Error: could not start command {command[0]!r}: {exc}", file=sys.stderr)
        return 2

    try:
        root_process = psutil.Process(child.pid)
    except psutil.NoSuchProcess:
        child.wait()
        print("Error: command ended before CPU and memory could be sampled; no telemetry file was written.", file=sys.stderr)
        return child.returncode or 1
    include_names = args.include_process or []
    trend = []
    seen_included = set()
    cpu_state = {"last_time": time.monotonic(), "process_times": {}}
    cpu_sum = 0.0
    cpu_sample_count = 0
    peak_memory = 0.0
    next_sample = time.monotonic()
    try:
        while True:
            now = time.monotonic()
            if now < next_sample:
                time.sleep(next_sample - now)
            sample = take_sample(root_process, include_names, logical_cpus, seen_included, cpu_state)
            if sample is not None:
                cpu_sum += sample["cpuPercent"]
                cpu_sample_count += 1
                peak_memory = max(peak_memory, sample["memoryGb"])
                trend.append(sample)
                if len(trend) > 1200:
                    compacted_trend = trend[::2]
                    if trend[-1] is not compacted_trend[-1]:
                        compacted_trend.append(trend[-1])
                    trend = compacted_trend
            next_sample = time.monotonic() + SAMPLE_INTERVAL_SECONDS
            if child.poll() is not None:
                break
    except KeyboardInterrupt:
        child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
        print("Interrupted; no telemetry file was written.", file=sys.stderr)
        return 130

    duration = max(0.0, time.monotonic() - start_time)
    if not trend:
        print("Error: no resource samples were collected; no telemetry file was written.", file=sys.stderr)
        return child.returncode or 1

    cpu_average = cpu_sum / cpu_sample_count
    operating_system = f"{platform.system()} {platform.release()}".strip()
    device = {
        "machineLabel": platform.node() or "This computer",
        "operatingSystem": operating_system or platform.platform(),
        "cpu": cpu_description(),
        "gpu": "Not measured",
        "memoryGb": round(psutil.virtual_memory().total / GIB, 3),
    }
    result = {
        "format": "model-telemetry-run",
        "version": 1,
        "id": str(uuid.uuid4()),
        "timestamp": timestamp(),
        "scenarioId": args.scenario,
        "scenarioLabel": args.scenario_label or SCENARIOS[args.scenario],
        "model": args.model,
        "provider": args.provider,
        "runtime": args.runtime,
        "durationSeconds": round(duration, 3),
        "qualityScore": args.quality,
        "timeToFirstTokenMs": None,
        "tokensPerSecond": args.tokens_per_second,
        "peakMemoryGb": round(peak_memory, 6),
        "averageCpuPercent": round(cpu_average, 3),
        "averageGpuPercent": None,
        "estimatedCostUsd": args.cost,
        "device": device,
        "resourceTrend": trend,
    }
    output_path = Path(args.output).expanduser()
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    except OSError as exc:
        print(f"Error: could not write telemetry file {output_path}: {exc}", file=sys.stderr)
        return 2

    print(f"Telemetry saved to {output_path}", file=sys.stderr)
    if args.include_process and not seen_included:
        print(
            "Warning: no additional processes matched --include-process; only the command tree was measured.",
            file=sys.stderr,
        )
    if child.returncode:
        print(f"Command exited with status {child.returncode}; telemetry was still saved.", file=sys.stderr)
    return child.returncode


def main():
    parser = build_parser()
    args = parser.parse_args()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())