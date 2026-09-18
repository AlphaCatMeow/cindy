"""No compositor connection: exercise ownership, validation and rollback."""
import copy
import importlib.util
import json
import pathlib
import sys
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    "viewer_display", pathlib.Path(__file__).with_name("linux-viewer-display.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ViewerDisplayTests(unittest.TestCase):
    def fixture(self):
        source = {"name": "eDP-2", "width": 1600, "height": 1000, "refreshRate": 60,
                  "x": 0, "y": 0, "scale": 1, "transform": 0, "mirrorOf": "none"}
        monitors = {source["name"]: source}
        calls = []

        def run(*args):
            calls.append(args)
            if args == ("-j", "monitors", "all"):
                return json.dumps(list(monitors.values()))
            if args == ("-j", "workspaces"):
                return "[]"
            if args[:2] == ("output", "create"):
                monitors[args[-1]] = dict(source, name=args[-1])
            if args[:2] == ("output", "remove"):
                monitors.pop(args[-1], None)
            return "ok"

        owner = module.ViewerDisplay(source["name"], run)

        def rule(value, mirror=None):
            monitors[value["name"]] = dict(value, mirrorOf=mirror or "none")

        owner.rule = rule
        return owner, monitors, calls

    def test_rejects_invalid_sizes_before_mutating_any_output(self):
        owner, _, calls = self.fixture()
        for width, height in [(True, 600), (319, 600), (4096, 4096), (800, "600")]:
            with self.assertRaises(ValueError):
                owner.resize(width, height)
        self.assertFalse(any(c[0] == "output" for c in calls))

    def test_restores_exact_source_and_removes_only_owned_output(self):
        owner, monitors, _ = self.fixture()
        before = copy.deepcopy(monitors)
        result = owner.resize(800, 600)
        self.assertEqual(result["width"], 800)
        self.assertEqual(monitors["eDP-2"]["mirrorOf"], owner.name)
        owner.resize(600, 800)
        owner.restore()
        self.assertEqual(monitors, before)
        owner.restore()  # Idempotent cleanup.

    def test_cleanup_keeps_snapshot_after_a_temporary_restore_failure(self):
        owner, monitors, _ = self.fixture()
        owner.resize(800, 600)
        rule = owner.rule
        owner.rule = lambda *_: (_ for _ in ()).throw(RuntimeError("temporary"))
        with self.assertRaises(RuntimeError):
            owner.restore()
        self.assertTrue(owner.created)
        self.assertTrue(owner.mirrored)
        owner.rule = rule
        owner.restore()
        self.assertEqual(set(monitors), {"eDP-2"})

    def test_unplugged_source_does_not_block_owned_output_removal(self):
        owner, monitors, _ = self.fixture()
        owner.resize(800, 600)
        del monitors["eDP-2"]
        owner.restore()
        self.assertFalse(monitors)


if __name__ == "__main__":
    unittest.main()
