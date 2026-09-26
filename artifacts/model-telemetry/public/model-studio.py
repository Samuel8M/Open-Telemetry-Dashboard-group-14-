#!/usr/bin/env python3
"""A small local Tkinter companion for the private-model.py CLI."""

import json
import importlib.util
import os
import queue
import subprocess
import sys
import threading
from pathlib import Path

tk = None
filedialog = None
messagebox = None
ttk = None


APP_DIR = Path(__file__).resolve().parent
CLI_PATH = APP_DIR / "private-model.py"


def load_model_specs():
    """Use the bundled CLI's curated catalog, never a separate GUI copy."""
    if not CLI_PATH.is_file():
        raise SystemExit("private-model.py must be in the same extracted folder as model-studio.py.")
    spec = importlib.util.spec_from_file_location("private_model", CLI_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.MODELS


MODEL_SPECS = load_model_specs()
MODEL_CHOICES = tuple(MODEL_SPECS)
FRIENDLY_NAMES = {
    "smollm2-135m": "SmolLM2 — smallest",
    "qwen2.5-0.5b": "Qwen 0.5B — medium",
    "qwen2.5-1.5b": "Qwen 1.5B — larger",
}
MODEL_LABELS = {key: FRIENDLY_NAMES.get(key, key) for key in MODEL_CHOICES}
MODEL_KEYS_BY_LABEL = {label: key for key, label in MODEL_LABELS.items()}


def build_cli_command(python_executable, model, action, *arguments):
    """Construct an argv list only; never invoke a shell."""
    if model not in MODEL_CHOICES:
        raise ValueError("Unsupported model choice.")
    if action not in ("download", "inspect", "train"):
        raise ValueError("Unsupported local action.")
    return [str(python_executable), str(CLI_PATH), action, "--model", model, *map(str, arguments)]


def launcher_setup_commands(platform_name):
    """Return the setup command fragments used by the supplied launchers."""
    if platform_name == "mac":
        return [
            ["python3", "-m", "venv", ".venv"],
            [".venv/bin/python", "-m", "pip", "install", "torch", "transformers", "peft", "accelerate", "huggingface_hub"],
            [".venv/bin/python", "model-studio.py"],
        ]
    if platform_name == "windows":
        return [
            ["py", "-3", "-m", "venv", ".venv"],
            [r".venv\Scripts\python.exe", "-m", "pip", "install", "torch", "transformers", "peft", "accelerate", "huggingface_hub"],
            [r".venv\Scripts\python.exe", "model-studio.py"],
        ]
    raise ValueError("Platform must be mac or windows.")


class ModelStudio:
    def __init__(self, root):
        self.root = root
        self.root.title("Model Studio")
        self.root.minsize(650, 570)
        self.root.geometry("760x660")
        self.root.configure(background="#f4f6f8")
        self.model = tk.StringVar(value=MODEL_LABELS[MODEL_CHOICES[0]])
        self.selected_file = None
        self.busy = False
        self.events = queue.Queue()
        self.current_screen = 0
        self.status = tk.StringVar(value="Ready. Choose a model to begin.")
        self.log_visible = False
        self._configure_style()
        self._build_shell()
        self.show_screen(0)
        self.root.protocol("WM_DELETE_WINDOW", self._close)
        self.root.after(100, self._poll_events)

    def _selected_model(self):
        return MODEL_KEYS_BY_LABEL[self.model.get()]

    def _close(self):
        if self.busy:
            messagebox.showwarning("Still working", "Please wait for the current step to finish before closing.")
            return
        self.root.destroy()

    def _configure_style(self):
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("TFrame", background="#f4f6f8")
        style.configure("Card.TFrame", background="#ffffff")
        style.configure("TLabel", background="#f4f6f8", foreground="#233044", font=("TkDefaultFont", 11))
        style.configure("Title.TLabel", font=("TkDefaultFont", 23, "bold"), foreground="#14233b")
        style.configure("Subtitle.TLabel", font=("TkDefaultFont", 12), foreground="#526176")
        style.configure("Card.TLabel", background="#ffffff", foreground="#233044", font=("TkDefaultFont", 11))
        style.configure("CardTitle.TLabel", background="#ffffff", foreground="#14233b", font=("TkDefaultFont", 14, "bold"))
        style.configure("Primary.TButton", font=("TkDefaultFont", 12, "bold"), padding=(20, 12))

    def _build_shell(self):
        self.shell = ttk.Frame(self.root, padding=(26, 22))
        self.shell.pack(fill="both", expand=True)
        ttk.Label(self.shell, text="MODEL STUDIO", font=("TkDefaultFont", 10, "bold"),
                  foreground="#315ac7").pack(anchor="w")
        ttk.Label(self.shell, text="Make a model your own", style="Title.TLabel").pack(anchor="w", pady=(5, 3))
        ttk.Label(
            self.shell,
            text="Three little steps. Your text stays on this computer.",
            style="Subtitle.TLabel",
        ).pack(anchor="w")
        nav = ttk.Frame(self.shell)
        nav.pack(fill="x", pady=(17, 14))
        for index, label in enumerate(("1  Get a model", "2  Look inside", "3  Teach it")):
            link = tk.Label(nav, text=label, bg="#f4f6f8", fg="#315ac7", cursor="hand2",
                            font=("TkDefaultFont", 10, "underline"))
            link.pack(side="left", padx=(0, 18))
            link.bind("<Button-1>", lambda _event, screen=index: self.show_screen(screen))
        self.screen_area = ttk.Frame(self.shell)
        self.screen_area.pack(fill="both", expand=True)
        self.status_label = ttk.Label(self.shell, textvariable=self.status, wraplength=690)
        self.status_label.pack(fill="x", anchor="w", pady=(10, 4))
        self.log_link = tk.Label(self.shell, text="Show progress details", bg="#f4f6f8", fg="#53647c",
                                 cursor="hand2", font=("TkDefaultFont", 9, "underline"))
        self.log_link.pack(anchor="w")
        self.log_link.bind("<Button-1>", lambda _event: self._toggle_log())
        self.log_frame = ttk.Frame(self.shell)
        self.log = tk.Text(self.log_frame, height=6, wrap="word", state="disabled",
                           background="#101b2d", foreground="#dbe5f4", font=("TkFixedFont", 9))
        scrollbar = ttk.Scrollbar(self.log_frame, orient="vertical", command=self.log.yview)
        self.log.configure(yscrollcommand=scrollbar.set)
        self.log.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        self._set_log_visible(False)

    def _card(self):
        card = ttk.Frame(self.screen_area, style="Card.TFrame", padding=22)
        card.pack(fill="both", expand=True)
        return card

    def _model_picker(self, parent):
        ttk.Label(parent, text="Which model? Start with the smallest.", style="Card.TLabel").pack(anchor="w")
        picker = ttk.Combobox(
            parent, textvariable=self.model,
            values=tuple(MODEL_LABELS[key] for key in MODEL_CHOICES), state="readonly", width=30,
        )
        picker.pack(anchor="w", pady=(6, 15))
        picker.bind("<<ComboboxSelected>>", lambda _event: self._model_changed())
        self.model_picker = picker

    def show_screen(self, index):
        if self.busy:
            self.status.set("Please wait for the current local task to finish before changing screens.")
            return
        self.current_screen = index
        for child in self.screen_area.winfo_children():
            child.destroy()
        card = self._card()
        if index == 0:
            self._download_screen(card)
        elif index == 1:
            self._inspect_screen(card)
        else:
            self._train_screen(card)

    def _download_screen(self, card):
        ttk.Label(card, text="1. Get a model", style="CardTitle.TLabel").pack(anchor="w", pady=(0, 10))
        ttk.Label(card, text="The model downloads to this computer.",
                  style="Card.TLabel", wraplength=630).pack(anchor="w", pady=(0, 14))
        self._model_picker(card)
        self.download_info = ttk.Label(card, style="Card.TLabel", wraplength=630, justify="left")
        self.download_info.pack(anchor="w", pady=(0, 17))
        self._model_changed()
        self.download_button = ttk.Button(card, text="Download model", style="Primary.TButton",
                                          command=self._download, state="disabled" if self.busy else "normal")
        self.download_button.pack(anchor="w")
        ttk.Label(card, text="This step needs internet and can take a while. Keep this window open.",
                  style="Card.TLabel", wraplength=630).pack(anchor="w", pady=(18, 0))

    def _model_changed(self):
        if hasattr(self, "download_info"):
            detail = MODEL_SPECS[self._selected_model()]
            gib = 1024 ** 3
            required_disk = (detail["download_bytes"] + 512 * 1024 ** 2) / gib
            self.download_info.configure(
                text="Needs about " + format(required_disk, "g") + " GB of free space and at least "
                     + str(detail["minimum_ram"]) + " GB of memory. It may need more."
            )

    def _inspect_screen(self, card):
        ttk.Label(card, text="2. Look inside", style="CardTitle.TLabel").pack(anchor="w", pady=(0, 10))
        ttk.Label(card, text="See how many numbers your model has. This does not read your text file.",
                  style="Card.TLabel", wraplength=630).pack(anchor="w", pady=(0, 14))
        ttk.Label(card, text="Selected model: " + self.model.get(), style="Card.TLabel").pack(anchor="w", pady=(0, 16))
        self.inspect_button = ttk.Button(card, text="See my model", style="Primary.TButton",
                                         command=self._inspect, state="disabled" if self.busy else "normal")
        self.inspect_button.pack(anchor="w", pady=(0, 18))
        self.report_text = tk.Text(card, height=10, wrap="word", state="disabled", relief="flat",
                                   background="#f3f6fb", foreground="#233044", font=("TkDefaultFont", 11))
        self.report_text.pack(fill="both", expand=True)
        ttk.Label(card, text="One number is not a readable fact.",
                  style="Card.TLabel", wraplength=630).pack(anchor="w", pady=(12, 0))

    def _train_screen(self, card):
        ttk.Label(card, text="3. Teach it with your text", style="CardTitle.TLabel").pack(anchor="w", pady=(0, 10))
        ttk.Label(card, text="Pick a short .txt or .jsonl file from this computer. Only this computer reads it.",
                  style="Card.TLabel", wraplength=630).pack(anchor="w", pady=(0, 12))
        ttk.Label(card, text="Selected model: " + self.model.get(), style="Card.TLabel").pack(anchor="w", pady=(0, 16))
        self.train_button = ttk.Button(card, text="Teach with my text", style="Primary.TButton",
                                       command=self._train, state="disabled" if self.busy else "normal")
        self.train_button.pack(anchor="w")
        ttk.Label(card, text="Your original model stays the same. What it learns goes into a small extra file.",
                  style="Card.TLabel", wraplength=630).pack(anchor="w", pady=(18, 0))

    def _download(self):
        model = self._selected_model()
        directory = APP_DIR / "private-models" / model
        if directory.is_symlink():
            messagebox.showerror("Unsafe folder", "The model folder is a link. Model Studio will not write to it.")
            return
        if directory.exists():
            has_adapter = (APP_DIR / "private-adapters" / model).exists()
            warning = (
                "This model is already in the folder. Downloading again may replace its files."
                + ("\n\nYou also have a trained add-on for it. New base files may not work with that add-on."
                   if has_adapter else "")
                + "\n\nDownload it again?"
            )
            if not messagebox.askyesno("Download again?", warning, icon="warning"):
                return
        self._start_task(
            "Downloading selected public model; internet access is being used.",
            build_cli_command(sys.executable, model, "download"),
            "download",
        )

    def _inspect(self):
        model = self._selected_model()
        if not self._has_model(model):
            return
        report = APP_DIR / ("weight-report-" + model + ".json")
        self._start_task(
            "Inspecting local weight metadata. No tensor payloads are loaded.",
            build_cli_command(sys.executable, model, "inspect", "--output", report),
            "inspect",
            report,
        )

    def _train(self):
        if not self._has_model(self._selected_model()):
            return
        path = filedialog.askopenfilename(
            title="Select private training text",
            filetypes=(("Text or JSON Lines", "*.txt *.jsonl"), ("Text files", "*.txt"), ("JSON Lines", "*.jsonl")),
        )
        if not path:
            return
        selected_file = Path(path)
        if selected_file.suffix.lower() not in (".txt", ".jsonl"):
            messagebox.showerror("Unsupported file", "Choose a .txt or .jsonl file.")
            return
        try:
            file_size = selected_file.stat().st_size
        except OSError as error:
            messagebox.showerror("Could not read file", str(error))
            return
        if file_size > 32 * 1024:
            messagebox.showerror(
                "Choose a shorter file",
                "This simple app accepts text files up to 32 KB. Shorten the file and try again.",
            )
            return

        model = self._selected_model()
        adapter = APP_DIR / "private-adapters" / model
        overwrite = adapter.exists()
        if not messagebox.askyesno(
            "Keep your text private",
            "For extra privacy, turn off Wi-Fi before you continue.\n\n"
            "This app uses your text on this computer and tells the training tools to stay offline. "
            "It cannot turn off your internet connection for you.\n\nContinue?",
            icon="warning",
        ):
            return
        arguments = ["--data", selected_file]
        if overwrite:
            if not messagebox.askyesno(
                "Replace existing adapter?",
                "An adapter already exists for " + model + ". Continue only if you intend to replace it. "
                "The old adapter is retained until new training completes successfully.",
                icon="warning",
            ):
                return
            arguments.append("--overwrite")
        self._start_task(
            "Training with local files. No download is requested; base weights will remain unchanged.",
            build_cli_command(sys.executable, model, "train", *arguments),
            "train",
        )

    def _has_model(self, model):
        folder = APP_DIR / "private-models" / model
        if (folder / "config.json").is_file() and any(folder.glob("*.safetensors")):
            return True
        messagebox.showinfo("Get a model first", "Go to step 1 and download this model first.")
        return False

    def _start_task(self, message, command, task, report_path=None):
        if self.busy:
            return
        self.busy = True
        self.status.set(message)
        self._append_log("Started " + task + ". Detailed output is secondary; private file contents are not logged.")
        self._set_controls_enabled(False)

        def run():
            try:
                process = subprocess.Popen(
                    command,
                    cwd=str(APP_DIR),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    bufsize=1,
                    shell=False,
                )
                for line in process.stdout:
                    safe_line = line.rstrip()
                    if task == "train":
                        data_path = command[command.index("--data") + 1]
                        safe_line = safe_line.replace(data_path, "[selected local file]")
                    self.events.put(("log", safe_line[:1200]))
                return_code = process.wait()
                self.events.put(("finished", task, return_code, report_path))
            except Exception as error:
                self.events.put(("failed", task, str(error)))

        threading.Thread(target=run, daemon=True).start()

    def _poll_events(self):
        try:
            while True:
                event = self.events.get_nowait()
                if event[0] == "log":
                    self._append_log(event[1])
                elif event[0] == "failed":
                    self.busy = False
                    self._set_controls_enabled(True)
                    self.status.set("Could not start the local task.")
                    self._append_log(event[2])
                    messagebox.showerror("Local task could not start", event[2])
                else:
                    _, task, return_code, report_path = event
                    self.busy = False
                    self._set_controls_enabled(True)
                    if return_code != 0:
                        self.status.set(task.capitalize() + " failed. See progress details for the error.")
                        messagebox.showerror(
                            "Task failed",
                            "The local command exited with status " + str(return_code)
                            + ". Nothing is reported as successful. Expand progress details for the error.",
                        )
                    elif task == "inspect":
                        try:
                            report = json.loads(Path(report_path).read_text(encoding="utf-8"))
                            self._show_report(report)
                            self.status.set("Inspection complete. Local metadata report saved.")
                        except (OSError, json.JSONDecodeError) as error:
                            self.status.set("CLI completed, but the local report could not be read.")
                            messagebox.showerror("Report could not be read", str(error))
                    elif task == "download":
                        self.status.set("Download complete. The CLI exited successfully; weights are saved locally.")
                        messagebox.showinfo("Download complete", "The selected model download completed successfully.")
                        self.show_screen(1)
                    else:
                        self.status.set("Training complete. The local LoRA adapter was saved; base weights are unchanged.")
                        messagebox.showinfo("Training complete", "The local LoRA adapter was saved successfully.")
        except queue.Empty:
            pass
        self.root.after(100, self._poll_events)

    def _show_report(self, report):
        model = report.get("model", "selected model")
        parameters = report.get("parameterCount", 0)
        tensors = report.get("tensorCount", 0)
        role_counts = {}
        for tensor in report.get("tensors", []):
            role = tensor.get("role")
            if isinstance(role, str):
                role_counts[role] = role_counts.get(role, 0) + 1
        role, count = max(role_counts.items(), key=lambda item: item[1]) if role_counts else ("other", 0)
        explanation = {
            "attention": "This group helps the model notice related words.",
            "embedding": "This group helps turn words into numbers.",
            "feed_forward": "This group helps the model process what it noticed.",
            "normalization": "This group helps keep its numbers in a useful range.",
            "output": "This group helps it guess the next word.",
            "other": "This group has a name the simple guide does not recognize.",
        }.get(role, "This is one group of the model's numbers.")
        lines = [
            "Your model: " + str(model),
            "It has about " + format_count(parameters) + " weights in " + format_count(tensors) + " groups.",
            "Here is one group (" + str(count) + " of the examples):",
            explanation,
            "",
            "These numbers do not tell us what the model knows.",
        ]
        self.report_text.configure(state="normal")
        self.report_text.delete("1.0", "end")
        self.report_text.insert("1.0", "\n".join(lines))
        self.report_text.configure(state="disabled")

    def _set_controls_enabled(self, enabled):
        for widget in self.screen_area.winfo_children():
            self._set_widget_tree(widget, enabled)

    def _set_widget_tree(self, widget, enabled):
        try:
            if isinstance(widget, ttk.Button):
                widget.configure(state="normal" if enabled else "disabled")
            elif isinstance(widget, ttk.Combobox):
                widget.configure(state="readonly" if enabled else "disabled")
        except tk.TclError:
            pass
        for child in widget.winfo_children():
            self._set_widget_tree(child, enabled)

    def _append_log(self, line):
        self.log.configure(state="normal")
        self.log.insert("end", line + "\n")
        line_count = int(self.log.index("end-1c").split(".")[0])
        if line_count > 500:
            self.log.delete("1.0", str(line_count - 500) + ".0")
        self.log.see("end")
        self.log.configure(state="disabled")

    def _toggle_log(self):
        self.log_visible = not self.log_visible
        self._set_log_visible(self.log_visible)

    def _set_log_visible(self, visible):
        if visible:
            self.log_frame.pack(fill="both", expand=False, pady=(6, 0))
            self.log_link.configure(text="Hide progress details")
        else:
            self.log_frame.pack_forget()
            self.log_link.configure(text="Show progress details")


def format_count(value):
    try:
        return format(int(value), ",")
    except (TypeError, ValueError):
        return "unknown"


def main():
    global tk, filedialog, messagebox, ttk
    if not CLI_PATH.is_file():
        raise SystemExit("private-model.py must be in the same extracted folder as model-studio.py.")
    try:
        import tkinter as tk_module
        from tkinter import filedialog as file_dialog_module
        from tkinter import messagebox as message_box_module
        from tkinter import ttk as ttk_module
    except ImportError as error:
        raise SystemExit(
            "Model Studio needs Python's Tkinter desktop GUI support. "
            "Install a Python distribution that includes Tkinter."
        ) from error
    tk, filedialog, messagebox, ttk = tk_module, file_dialog_module, message_box_module, ttk_module
    os.chdir(APP_DIR)
    root = tk.Tk()
    ModelStudio(root)
    root.mainloop()


if __name__ == "__main__":
    main()