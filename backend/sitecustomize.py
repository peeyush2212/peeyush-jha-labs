"""Project-level Python startup customizations.

Why this exists
--------------
Some developer machines have globally-installed pytest plugins (for example, via
Dash/Flask tooling). Pytest will *auto-load* any third‑party plugins it finds in
the environment, which can cause confusing import/version errors that are
unrelated to this project.

We disable pytest's third-party plugin autoloading by default so that:
- `pytest` works out-of-the-box in a clean virtualenv.
- `pytest` also works even if the user accidentally runs it from a Python
  environment that has unrelated plugins installed.

This file is imported automatically by Python at startup (via the `site` module)
when it is on `sys.path` (e.g. when you run from the backend folder).
"""

from __future__ import annotations

import os


# Disable third-party pytest plugin auto-loading (prevents unrelated plugin crashes).
os.environ.setdefault("PYTEST_DISABLE_PLUGIN_AUTOLOAD", "1")
