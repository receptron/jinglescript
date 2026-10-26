"""Mocked test (no key, no network): python -m pytest training/singing  or  python training/singing/test_fetch_common_voice.py"""
import os
import sys
import types
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import fetch_common_voice as f  # noqa: E402


def fake_sdk(license_abbr):
    calls = []
    mod = types.ModuleType("datacollective")
    mod.get_dataset_details = lambda d: {"id": d, "licenseAbbreviation": license_abbr}
    mod.download_dataset = lambda d, download_directory=None: calls.append(d) or Path(download_directory) / "cv.tar.gz"
    return mod, calls


def test_cc0_downloads(tmp="/tmp"):
    mod, calls = fake_sdk("CC0-1.0")
    with mock.patch.dict(sys.modules, {"datacollective": mod}), mock.patch.dict(os.environ, {"MDC_API_KEY": "x"}):
        assert f.download_via_sdk("cv-ja", Path(tmp)) == Path(tmp) / "cv.tar.gz"
    assert calls == ["cv-ja"]


def test_non_cc0_refused(tmp="/tmp"):
    mod, calls = fake_sdk("CC-BY-NC-4.0")
    with mock.patch.dict(sys.modules, {"datacollective": mod}), mock.patch.dict(os.environ, {"MDC_API_KEY": "x"}):
        try:
            f.download_via_sdk("x", Path(tmp))
            raise AssertionError("should refuse")
        except SystemExit as e:
            assert "only CC0" in str(e)
    assert calls == []


if __name__ == "__main__":
    test_cc0_downloads()
    test_non_cc0_refused()
    print("ok")
