"""UI smoke tests using Streamlit's own AppTest harness.

NOTE: written without being able to execute them (Streamlit was not installable in the
authoring sandbox). Run `pytest tests/test_app_streamlit.py` locally once Streamlit is installed.
"""
import pathlib

import pytest

pytest.importorskip("streamlit")
from streamlit.testing.v1 import AppTest  # noqa: E402

APP = str(pathlib.Path(__file__).resolve().parents[1] / "app.py")


def _button(at, text):
    return [b for b in at.sidebar.button if text in b.label][0]


def test_app_loads_without_error():
    at = AppTest.from_file(APP, default_timeout=120).run()
    assert not at.exception


def test_run_button_produces_results_and_reset_clears_them():
    at = AppTest.from_file(APP, default_timeout=180).run()
    _button(at, "Run Simulation").click().run()
    assert not at.exception
    assert "results" in at.session_state
    _button(at, "Reset").click().run()
    assert "results" not in at.session_state
