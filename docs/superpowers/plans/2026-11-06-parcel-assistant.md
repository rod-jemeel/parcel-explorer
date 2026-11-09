# Parcel assistant

- Test OAuth callback binding, single-use state, granted scope and completed Responses streams in `tests/test_parcel_assistant.py`.
- Implement the loopback-only OAuth and inference service in `services/api/parcel_assistant.py`, and mount its narrow routes in `scripts/serve_local.py`.
- Add the selected-parcel UI in `apps/web/components/PropertyAssistant.tsx` and verify the sign-in and answer paths with local fixtures before trying the real authorization handoff.
