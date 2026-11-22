import sys
from datetime import datetime
from pathlib import Path
from types import ModuleType
from zoneinfo import ZoneInfo

import pandas as pd
from streamlit.testing.v1 import AppTest

from streamlit_readonly.analysis_core import normalize_spot


def test_optional_preview_only_reads_after_a_valid_password(monkeypatch):
    root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(root))
    provider = ModuleType("market_data")
    provider.TZ = ZoneInfo("Asia/Shanghai")
    reads = []

    def spot():
        reads.append("spot")
        return normalize_spot(pd.DataFrame({
            "代码": ["600519"], "名称": ["隔离样本"], "最新价": [10], "涨跌幅": [2],
            "成交额": [2e8], "换手率": [2], "量比": [1.5],
        })), datetime(2026, 11, 20, 15, 1, tzinfo=provider.TZ)

    def unexpected_history(*_args):
        raise AssertionError("the preview must not fetch history automatically")

    provider.spot = spot
    provider.history = unexpected_history
    monkeypatch.setitem(sys.modules, "market_data", provider)
    monkeypatch.delenv("DASHBOARD_PASSWORD", raising=False)
    app = AppTest.from_file(str(root / "app.py")).run()
    assert not app.exception
    assert any("尚未配置" in error.value for error in app.error)
    assert reads == []

    password = "隔离测试口令-fixture"
    monkeypatch.setenv("DASHBOARD_PASSWORD", password)
    app.run()
    app.text_input[0].input("错误口令").run()
    app.button[0].click().run()
    assert not app.exception
    assert any("密码不正确" in error.value for error in app.error)
    assert reads == []

    app.text_input[0].input(password).run()
    app.button[0].click().run()
    assert not app.exception
    assert reads == ["spot"]
    assert any("不能验证实时性" in caption.value for caption in app.caption)
