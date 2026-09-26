#!/usr/bin/env python3
"""Build and standard-library self-test for the downloadable local studio kit."""

import ast
import importlib.util
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


PUBLIC = Path(__file__).resolve().parents[1] / "public"
OUTPUT = PUBLIC / "model-studio-kit.zip"
KIT_FILES = (
    "model-studio.py",
    "private-model.py",
    "model-studio-guide.txt",
    "start-mac.command",
    "start-windows.bat",
)
CLI_MODELS_FILE = PUBLIC / "private-model.py"


def allowed_cli_models():
    tree = ast.parse(CLI_MODELS_FILE.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "MODELS" for target in node.targets
        ):
            if not isinstance(node.value, ast.Dict):
                raise RuntimeError("The private-model.py model allowlist is not a literal dictionary.")
            return tuple(sorted(ast.literal_eval(key) for key in node.value.keys))
    raise RuntimeError("Could not find the private-model.py model allowlist.")


def build_zip(destination):
    missing = [name for name in KIT_FILES if not (PUBLIC / name).is_file()]
    if missing:
        raise RuntimeError("Required kit files are missing: " + ", ".join(missing))
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name in KIT_FILES:
            archive.write(PUBLIC / name, arcname=name)
    return Path(destination)


class KitSelfTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("model_studio", PUBLIC / "model-studio.py")
        cls.studio = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.studio)

    def test_selector_matches_existing_cli_allowlist(self):
        self.assertEqual(tuple(sorted(self.studio.MODEL_CHOICES)), allowed_cli_models())
        self.assertEqual(
            {self.studio.MODEL_KEYS_BY_LABEL[label] for label in self.studio.MODEL_LABELS.values()},
            set(self.studio.MODEL_CHOICES),
        )

    def test_argv_commands_are_safe_and_complete(self):
        cli = self.studio.build_cli_command(
            "/isolated python", "smollm2-135m", "train", "--data", "/private notes/notes.txt",
        )
        self.assertEqual(cli[0], "/isolated python")
        self.assertIn("/private notes/notes.txt", cli)
        self.assertTrue(all(isinstance(part, str) for part in cli))
        self.assertEqual(cli.count("--model"), 1)
        self.assertFalse(any("&&" in part or ";" in part for part in cli))
        for action in ("download", "inspect"):
            built = self.studio.build_cli_command("python", "smollm2-135m", action)
            self.assertEqual(built[2], action)
            self.assertEqual(built.count("--model"), 1)
        with self.assertRaises(ValueError):
            self.studio.build_cli_command("python", "not-allowed", "download")

    def test_launcher_setup_and_packages(self):
        mac, windows = (
            self.studio.launcher_setup_commands("mac"),
            self.studio.launcher_setup_commands("windows"),
        )
        expected = {"torch", "transformers", "peft", "accelerate", "huggingface_hub"}
        self.assertEqual(set(mac[1][4:]), expected)
        self.assertEqual(set(windows[1][4:]), expected)
        for filename, marker in (("start-mac.command", ".model-studio-dependencies-installed"),
                                 ("start-windows.bat", ".model-studio-dependencies-installed")):
            content = (PUBLIC / filename).read_text(encoding="utf-8")
            self.assertIn(marker, content)
            self.assertIn("model-studio.py", content)

    def test_one_action_button_per_screen_and_single_model_selector(self):
        tree = ast.parse((PUBLIC / "model-studio.py").read_text(encoding="utf-8"))
        methods = {
            node.name: node
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }

        def calls_in(method_name, module, member):
            return [
                node for node in ast.walk(methods[method_name])
                if isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == member
                and (
                    isinstance(node.func.value, ast.Name) and node.func.value.id == module
                    or module == "self"
                    and isinstance(node.func.value, ast.Name)
                    and node.func.value.id == "self"
                )
            ]

        for screen in ("_download_screen", "_inspect_screen", "_train_screen"):
            self.assertEqual(len(calls_in(screen, "ttk", "Button")), 1, screen)
        self.assertEqual(len(calls_in("_inspect_screen", "self", "_model_picker")), 0)
        self.assertEqual(len(calls_in("_train_screen", "self", "_model_picker")), 0)

    def test_packaging_members_and_content(self):
        with tempfile.TemporaryDirectory() as temp:
            package = build_zip(Path(temp) / "kit.zip")
            with zipfile.ZipFile(package) as archive:
                self.assertEqual(set(archive.namelist()), set(KIT_FILES))
                self.assertIn(b"Teach with my text", archive.read("model-studio.py"))
                self.assertIn(b"NOT a firewall", archive.read("model-studio-guide.txt"))


def main():
    if "--self-test" in sys.argv:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(KitSelfTests)
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        raise SystemExit(0 if result.wasSuccessful() else 1)
    build_zip(OUTPUT)
    print("Built " + str(OUTPUT))


if __name__ == "__main__":
    main()