import io
import json
from urllib.parse import parse_qs, urlsplit

import pytest

from services.api import parcel_assistant as assistant


def test_oauth_attempt_is_bound_to_browser_and_consumed(tmp_path, monkeypatch):
    runtime = assistant.Assistant(tmp_path)
    monkeypatch.setattr(runtime, "exchange", lambda attempt, query: {"access_token": "test", "expires_in": 600})
    location = runtime.start("browser", "http://127.0.0.1:3100", "3002490016")
    query = parse_qs(urlsplit(location).query)
    assert query["client_id"] == ["dynamic_agent_client"]
    assert query["code_challenge_method"] == ["S256"]
    with pytest.raises(assistant.AssistantError):
        runtime.finish("other", query)
    assert runtime.finish("browser", query) == "3002490016"
    assert runtime.token("browser") == "test"
    with pytest.raises(assistant.AssistantError):
        runtime.finish("browser", query)


def test_completed_stream_and_citations():
    stream = io.BytesIO(
        b'data: {"type":"response.output_text.delta","delta":"One permit [2]."}\n\n'
        b'data: {"type":"response.completed"}\n\n'
    )
    answer = assistant.completed_text(stream)
    assert answer == "One permit [2]."
    evidence = [{"id": 1}, {"id": 2}]
    assert assistant.citations(answer + " [999].", evidence) == [{"id": 2}]
    with pytest.raises(assistant.AssistantError):
        assistant.completed_text(io.BytesIO(b'data: {"type":"response.output_text.delta","delta":"Partial"}\n'))


def test_prompt_uses_record_counts_instead_of_large_lot_list():
    raw = {"type": "document", "document_type": "LDMK", "property_bbls": ["1", "2"], "note": "private"}
    event = assistant.public_event(raw)
    assert event["linked_lots"] == 2
    assert "note" not in event
    assert "property_bbls" not in event


def test_chatgpt_request_uses_preview_contract(tmp_path, monkeypatch):
    runtime = assistant.Assistant(tmp_path)
    monkeypatch.setattr(runtime, "token", lambda browser: "test")
    monkeypatch.setattr(assistant, "parcel_evidence", lambda *args: [{"id": 1, "url": "/", "label": "Profile"}])
    monkeypatch.setattr(assistant, "json_request", lambda *args, **kwargs: {
        "models": [{"slug": "eligible", "visibility": "list"}],
    })

    def stream(url, *, data, token):
        assert data["model"] == "eligible"
        assert isinstance(data["input"], list)
        assert data["store"] is False and data["stream"] is True
        assert "max_output_tokens" not in data
        assert json.loads(data["input"][0]["content"])["question"] == "What changed?"
        assert "private draft" not in str(data)
        return io.BytesIO(
            b'data: {"type":"response.output_text.delta","delta":"See [1]."}\n'
            b'data: {"type":"response.completed"}\n'
        )

    monkeypatch.setattr(assistant, "request", stream)
    result = runtime.ask("browser", {"question": "What changed?", "notes": "private draft"})
    assert result["sources"][0]["label"] == "Profile"


def test_loopback_routes_bind_oauth_to_cookie_and_reject_cross_origin(tmp_path, monkeypatch):
    from functools import partial
    from http.client import HTTPConnection
    from http.server import ThreadingHTTPServer
    from threading import Thread

    from scripts import serve_local

    runtime = assistant.Assistant(tmp_path)
    monkeypatch.setattr(serve_local, "ASSISTANT", runtime)
    monkeypatch.setattr(runtime, "exchange", lambda attempt, query: {"access_token": "test", "expires_in": 600})
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(serve_local.Handler, directory=str(tmp_path))) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        client = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        origin = f"http://127.0.0.1:{server.server_port}"

        def call(method, path, body=None, **headers):
            if body is not None:
                body = json.dumps(body)
                headers["Content-Type"] = "application/json"
            client.request(method, "/api/assistant/" + path, body, headers)
            response = client.getresponse()
            return response.status, response.headers, response.read()

        try:
            assert call("POST", "connect", {"bbl": "3002490016"}, Origin="https://example.com")[0] == 403
            status, headers, body = call("POST", "connect", {"bbl": "3002490016"}, Origin=origin)
            assert status == 200
            assert "HttpOnly" in headers["Set-Cookie"]
            assert headers["Cache-Control"] == "no-store"
            cookie = headers["Set-Cookie"].split(";")[0]
            state = parse_qs(urlsplit(json.loads(body)["url"]).query)["state"][0]
            path = "callback?state=" + state
            assert call("GET", path)[0] == 400
            status, headers, _ = call("GET", path, Cookie=cookie)
            assert status == 303
            assert headers["Location"] == "/?parcel=3002490016&ask=1"
            assert call("GET", path, Cookie=cookie)[0] == 400
            assert json.loads(call("GET", "status", Cookie=cookie)[2])["mode"] == "chatgpt"
            assert call("POST", "disconnect", {}, Origin=origin, Cookie=cookie)[0] == 200
            assert runtime.token(cookie.split("=")[1]) is None
        finally:
            client.close()
            server.shutdown()
            thread.join()


def test_lot_search_plan_rejects_unsupported_filters():
    assert assistant.search_plan('{"q":"","filters":{"uses":["11"],"minLot":3000},"limits":[]}')["filters"]["minLot"] == 3000
    for text in (
        '{"q":"","filters":{"minLot":5000,"maxLot":3000},"limits":[]}',
        '{"q":"","filters":{"maxPrice":500000},"limits":[]}',
        '{"q":"","filters":{"uses":["99"]},"limits":[]}',
    ):
        with pytest.raises(assistant.AssistantError):
            assistant.search_plan(text)


def test_lot_search_can_start_without_a_selected_parcel(tmp_path, monkeypatch):
    runtime = assistant.Assistant(tmp_path)
    monkeypatch.setattr(runtime, "exchange", lambda attempt, query: {"access_token": "test", "expires_in": 600})
    url = runtime.start("browser", "http://127.0.0.1:3100", None)
    assert runtime.finish("browser", parse_qs(urlsplit(url).query)) is None
    monkeypatch.setattr(runtime, "respond", lambda browser, prompt, question:
                        '{"q":"","filters":{"uses":["11"],"minLot":3000},"limits":[]}')
    assert runtime.find("browser", {"question": "Vacant lots over 3,000 sq ft"})["filters"]["uses"] == ["11"]


def test_chat_routes_lot_search_and_requests_parcel_context(tmp_path, monkeypatch):
    runtime = assistant.Assistant(tmp_path)
    outputs = iter(["SEARCH", '{"q":"","filters":{"uses":["11"]},"limits":[]}', "PROPERTY", "CLARIFY"])
    monkeypatch.setattr(runtime, "respond", lambda *args: next(outputs))
    plan = runtime.chat("browser", {"question": "Find vacant lots", "bbl": "3002490016"})
    assert plan["kind"] == "search" and plan["filters"]["uses"] == ["11"]
    missing = runtime.chat("browser", {"question": "What permits were issued?"})
    assert missing["kind"] == "answer" and "Select a parcel" in missing["answer"]
    unclear = runtime.chat("browser", {"question": "What about it?"})
    assert "looking for lots" in unclear["answer"]


def test_chat_property_answer_uses_selected_parcel_sources(tmp_path, monkeypatch):
    runtime = assistant.Assistant(tmp_path)
    evidence = [{"id": 1, "label": "Permit", "url": "/?parcel=3002490016"}]

    def lookup(root, release, bbl):
        assert bbl == "3002490016"
        return evidence

    monkeypatch.setattr(assistant, "parcel_evidence", lookup)
    outputs = iter(["PROPERTY", "The record lists a permit [1]."])
    monkeypatch.setattr(runtime, "respond", lambda *args: next(outputs))
    result = runtime.chat("browser", {"question": "What work was permitted here?", "bbl": "3002490016"})
    assert result["kind"] == "answer" and result["sources"] == evidence
