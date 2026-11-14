"""Fit three fixed research baselines on pre-split observations only."""
import json
import sys

try:
    from sklearn import __version__
    from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
    from sklearn.linear_model import Ridge
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
except ImportError:
    sys.exit("请先运行 python3 -m pip install -r tools/requirements-models.txt")

def fit(data):
    models = {
        "ridge": make_pipeline(StandardScaler(), Ridge(alpha=10.0)),
        "extraTrees": ExtraTreesRegressor(n_estimators=48, max_depth=5, min_samples_leaf=8,
                                          n_jobs=1, random_state=42),
        "histBoost": HistGradientBoostingRegressor(max_iter=60, max_leaf_nodes=7,
                                                   min_samples_leaf=12, l2_regularization=1.0,
                                                   early_stopping=False, random_state=42),
    }
    scores = {}
    for name, model in models.items():
        model.fit(data["x"], data["y"])
        scores[name] = model.predict(data["test"]).tolist()
    return {"version": __version__, "scores": scores}

if __name__ == "__main__":
    json.dump(fit(json.load(sys.stdin)), sys.stdout, allow_nan=False)
