"""Serve the built pilot on loopback; no LAN listener or directory listing."""
import argparse
from functools import partial
from html import escape
from http.cookies import CookieError, SimpleCookie
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
import json
from pathlib import Path
import re
import secrets
import sqlite3
import sys
from contextlib import closing
from urllib.parse import parse_qs, urlsplit

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from services.api.brooklyn import route
from services.api.parcel_assistant import Assistant, AssistantError, CALLBACK

ASSISTANT = Assistant(ROOT)


class Handler(SimpleHTTPRequestHandler):
    extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.pbf':'application/vnd.mapbox-vector-tile','.mjs':'text/javascript'}
    def list_directory(self,path):
        self.send_error(404);return None

    def translate_path(self, path):
        if urlsplit(path).path.startswith('/data/'):
            # Use the published data root so importing a release does not require
            # rebuilding or copying every static tile.
            return str(ROOT/'apps'/'web'/'public' / Path(super().translate_path(path)).relative_to(self.directory))
        return super().translate_path(path)

    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path.startswith('/api/assistant/'):
            return self.assistant_request(parsed, post=False)
        match = re.fullmatch(r'/data/(bk-[a-f0-9]{12})/((?:profiles/|history/|comps/).*|(?:search|summaries)\.json)', parsed.path)
        if not match:
            return super().do_GET()
        release, asset = match.groups()
        path = ROOT/'data'/'releases'/release/'brooklyn.sqlite'
        if not path.is_file():
            return super().do_GET()
        try:
            with closing(sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True)) as db:
                db.execute('PRAGMA mmap_size=2147418112')
                response = route(db, release, asset, parsed.query)
        except ValueError:
            self.send_error(400, 'Invalid property query')
            return
        if response is None:
            self.send_error(404)
            return
        payload = json.dumps(response, separators=(',', ':')).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
    def do_POST(self):
        parsed = urlsplit(self.path)
        if not parsed.path.startswith('/api/assistant/'):
            return self.send_error(404)
        return self.assistant_request(parsed, post=True)

    def assistant_request(self, parsed, *, post):
        host = f'127.0.0.1:{self.server.server_port}'
        origin = 'http://' + host
        callback = not post and parsed.path == CALLBACK
        cookie_header = None
        try:
            if self.headers.get('Host') != host or (post and self.headers.get('Origin') != origin):
                raise AssistantError('Open Parcel Explorer from its local address.', 403)
            cookies = SimpleCookie(self.headers.get('Cookie', ''))
            session = cookies.get('parcel_assistant')
            browser = session.value if session and re.fullmatch(r'[A-Za-z0-9_-]{43}', session.value) else ''
            if callback:
                bbl = ASSISTANT.finish(browser, parse_qs(parsed.query))
                self.send_response(303)
                self.send_header('Location', f'/?parcel={bbl}&ask=1' if bbl else '/?find=1')
                self.end_headers()
                return
            if post:
                if self.headers.get_content_type() != 'application/json' or self.headers.get('Transfer-Encoding'):
                    raise AssistantError('Expected a JSON request.', 415)
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 8192:
                    raise AssistantError('Invalid request size.', 413)
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise AssistantError('Expected a JSON object.')
                if parsed.path == '/api/assistant/connect':
                    if not browser:
                        browser = secrets.token_urlsafe(32)
                        cookie_header = f'parcel_assistant={browser}; HttpOnly; SameSite=Lax; Path=/api/assistant/'
                    result = {'url': ASSISTANT.start(browser, origin, data.get('bbl'))}
                elif parsed.path == '/api/assistant/disconnect':
                    ASSISTANT.disconnect(browser)
                    result = ASSISTANT.status(browser)
                elif parsed.path == '/api/assistant/chat':
                    result = ASSISTANT.chat(browser, data)
                elif parsed.path == '/api/assistant/find':
                    result = ASSISTANT.find(browser, data)
                elif parsed.path == '/api/assistant/ask':
                    result = ASSISTANT.ask(browser, data)
                else:
                    raise AssistantError('Not found.', 404)
            elif parsed.path == '/api/assistant/status':
                result = ASSISTANT.status(browser)
            else:
                raise AssistantError('Not found.', 404)
            status = 200
        except (ValueError, CookieError):
            status, result = 400, {'error': 'Invalid assistant request.'}
        except AssistantError as exc:
            status, result = exc.status, {'error': str(exc)}
        except (KeyError, OSError, sqlite3.Error):
            status, result = 502, {'error': 'The assistant could not complete this request.'}

        self.send_response(status)
        if cookie_header and status == 200:
            self.send_header('Set-Cookie', cookie_header)
        if callback:
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            payload = ('<!doctype html><meta charset="utf-8"><title>Parcel Explorer</title>'
                       '<h1>ChatGPT connection</h1><p>' + escape(result['error']) +
                       '</p><a href="/">Return to Parcel Explorer</a>').encode()
        else:
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            payload = json.dumps(result).encode()
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def end_headers(self):
        assistant = self.path.startswith('/api/assistant/')
        self.send_header('Referrer-Policy', 'no-referrer' if assistant else 'strict-origin-when-cross-origin')
        self.send_header('X-Content-Type-Options','nosniff')
        if assistant:
            self.send_header('Cache-Control', 'no-store')
            return super().end_headers()
        self.send_header('Cache-Control','no-cache' if self.path.split('?')[0] in ('/','/index.html','/data/coverage.json') else 'private, max-age=3600')
        super().end_headers()
    def log_message(self,format,*args):
        if not self.path.startswith('/api/assistant/') and str(args[1]) not in ('200','304'):
            super().log_message(format,*args)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=3100);args=parser.parse_args()
    directory=ROOT/'apps'/'web'/'out'
    if not (directory/'index.html').exists():raise SystemExit('Run npm run build first.')
    server=ThreadingHTTPServer(('127.0.0.1',args.port),partial(Handler,directory=str(directory)))
    print(f'Parcel Explorer: http://127.0.0.1:{args.port} (loopback only)',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:server.server_close()
