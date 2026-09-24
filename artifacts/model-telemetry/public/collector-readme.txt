LOCAL MODEL TELEMETRY COLLECTOR

This Python 3 script measures CPU and memory on your computer while a command
runs. It does not send data to a server, read API keys, or require installation
in the Model Telemetry app.

1. Install its only dependency:

   python -m pip install psutil

   On some systems the command is named `python3` instead of `python`.

2. Run the collector with the command to measure after `--`:

   python collector.py --model "Your model" --provider "Provider" \
     --runtime local --scenario code-fix --output run.json -- \
     ollama run your-model

   Replace the example command with the command you actually use. Supported
   scenarios are code-fix, summarization, and data-extraction. Runtime is
   local or cloud-client. The collector runs the command directly without a
   shell; quote arguments as needed for your operating system.

Optional metadata:

   --scenario-label "My task"
   --quality 85
   --cost 0.02
   --tokens-per-second 34.5

Quality, cost, and token rate are only recorded when you supply them manually.
The collector cannot measure quality, time to first token, or token rate, and
does not estimate cost. GPU utilization is not detected and remains null.

CPU and resident memory are sampled approximately every 0.5 seconds for the
command and its child processes. To include another process, repeat
--include-process with a name or executable substring, for example:

   --include-process ollama

Named-process matches and their child processes are added to the command tree;
duplicate processes are counted once. This is useful for a model daemon that
was already running. Other computer activity can still affect readings, and
short-lived CPU or memory peaks may fall between samples. A very fast command
may have only an initial observation, so its peak resource use can be missed.
The collector does not claim to isolate the model's work from other activity.

The JSON output is saved locally to the path given by --output (default:
telemetry-run.json). A command's nonzero exit status is reported and its
telemetry is still saved. If collection cannot produce any samples, no
telemetry file is written.