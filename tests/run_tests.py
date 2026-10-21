"""Minimal runner for environments without pytest:  python -m tests.run_tests"""
import importlib, pkgutil, sys, traceback, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
failed = passed = 0
for mod in sorted(m.name for m in pkgutil.iter_modules([str(pathlib.Path(__file__).parent)]) if m.name.startswith("test_")):
    try:
        module = importlib.import_module(f"tests.{mod}")
    except ModuleNotFoundError as e:          # optional deps (pytest / streamlit) not installed
        print(f"SKIP  {mod} (missing {e.name})")
        continue
    for name in sorted(n for n in dir(module) if n.startswith("test_")):
        try:
            getattr(module, name)()
            passed += 1
            print(f"PASS  {mod}.{name}")
        except Exception:
            failed += 1
            print(f"FAIL  {mod}.{name}")
            traceback.print_exc()
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
