# Backend integration tests

**What:** API tests against the real backend and auth service (HTTP, with JWT). No browser.

**Where:** All tests live in `backend/tests/integration/`. They only run when `BACKEND_URL` and `AUTH_URL` are set (Docker). This includes auth API tests (`test_auth_api.py`), admin-role tests (`test_admin_routes.py`: GET/PATCH users, admin vs staff), and backend API tests.

**Data:** The backend runs in Docker with **fixture-data** mounted as `/app/data` – production data is never used.

- **Local:** `docker compose -f docker-compose.integration.yml up -d --build`, then seed the test user, then `BACKEND_URL=... AUTH_URL=... pytest tests/integration -v`
- **CI:** `.github/workflows/backend-integration-tests.yml` starts the same compose file and runs the tests.

See the project README and `backend/tests/conftest.py` for exact commands.
