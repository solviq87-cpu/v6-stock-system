"""Fit fixed research baselines on pre-split observations only."""
import json
import math
import sys

try:
    from sklearn import __version__
    from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
    from sklearn.linear_model import Ridge
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
except ImportError:
    sys.exit("请先运行 python3 -m pip install -r tools/requirements-models.txt")


DEFAULT_MODELS = ["ridge", "extraTrees", "histBoost"]
OPTIONAL_MODELS = ["lightgbm", "xgboost"]


def selected_models(data):
    if not isinstance(data, dict):
        raise ValueError("模型输入必须为 JSON 对象")
    names = data.get("models", DEFAULT_MODELS)
    if not isinstance(names, list) or not names:
        raise ValueError("models 必须为非空模型名数组")
    allowed = DEFAULT_MODELS + OPTIONAL_MODELS
    if any(not isinstance(name, str) or name not in allowed for name in names):
        raise ValueError("models 包含未知模型；可选：" + ", ".join(allowed))
    if len(set(names)) != len(names):
        raise ValueError("models 不允许重复模型")
    return names


def validate_observations(data):
    def finite(value):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return False
        try:
            return math.isfinite(value)
        except OverflowError:
            return False

    x, y, test = (data.get(key) for key in ("x", "y", "test"))
    if not isinstance(x, list) or not x or not isinstance(x[0], list) or not x[0]:
        raise ValueError("x 必须为非空有限数值矩阵")
    width = len(x[0])
    for key, rows in (("x", x), ("test", test)):
        if (not isinstance(rows, list) or not rows or
                any(not isinstance(row, list) or len(row) != width or
                    not all(finite(value) for value in row) for row in rows)):
            raise ValueError(key + " 必须为列数一致的非空有限数值矩阵")
    if (not isinstance(y, list) or len(y) != len(x) or
            not all(finite(value) for value in y)):
        raise ValueError("y 必须为与 x 行数一致的有限数值数组")


def optional_model(name):
    try:
        if name == "lightgbm":
            from lightgbm import LGBMRegressor, __version__ as version
            model = LGBMRegressor(objective="regression", n_estimators=60,
                                 learning_rate=0.05, num_leaves=7, max_depth=3,
                                 min_child_samples=12, reg_lambda=1.0,
                                 n_jobs=1, random_state=42, device_type="cpu",
                                 deterministic=True, force_col_wise=True, verbosity=-1)
        else:
            from xgboost import XGBRegressor, __version__ as version
            model = XGBRegressor(objective="reg:squarederror", n_estimators=60,
                                 learning_rate=0.05, max_depth=3, min_child_weight=12,
                                 reg_lambda=1.0, subsample=1.0, colsample_bytree=1.0,
                                 tree_method="hist", device="cpu", n_jobs=1,
                                 random_state=42, verbosity=0)
    except (ImportError, OSError) as error:
        raise RuntimeError(
            "可选模型 " + name + " 依赖不可用；请运行 python3 -m pip install -r "
            "tools/requirements-models-optional.txt；原因：" + str(error)
        ) from error
    return model, version


def fit(data):
    names = selected_models(data)
    validate_observations(data)
    models = {
        "ridge": make_pipeline(StandardScaler(), Ridge(alpha=10.0)),
        "extraTrees": ExtraTreesRegressor(n_estimators=48, max_depth=5, min_samples_leaf=8,
                                          n_jobs=1, random_state=42),
        "histBoost": HistGradientBoostingRegressor(max_iter=60, max_leaf_nodes=7,
                                                   min_samples_leaf=12, l2_regularization=1.0,
                                                   early_stopping=False, random_state=42),
    }
    versions = {name: __version__ for name in DEFAULT_MODELS}
    # Optional imports never affect installations that only use the original baselines.
    for name in names:
        if name in OPTIONAL_MODELS:
            models[name], versions[name] = optional_model(name)
    scores = {}
    for name in names:
        model = models[name]
        model.fit(data["x"], data["y"])
        scores[name] = model.predict(data["test"]).tolist()
    return {"version": __version__, "scores": scores,
            "modelVersions": {name: versions[name] for name in names}}

if __name__ == "__main__":
    try:
        json.dump(fit(json.load(sys.stdin)), sys.stdout, allow_nan=False)
    except (ValueError, RuntimeError) as error:
        sys.exit(str(error))
