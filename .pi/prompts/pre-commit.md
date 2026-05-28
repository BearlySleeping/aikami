# Pre-Commit Validation

Run before asking user to commit:

1. Call `validate()` — detects affected projects, runs fix+typecheck on all
2. If test=true flag: also run build + tests
3. If errors: fix them, re-run until clean
4. Present diff + suggested commit message

No need to manually specify which project — Moon handles affected detection.
