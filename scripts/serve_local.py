"""Serve the built pilot on loopback; no LAN listener or directory listing."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
    extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.pbf':'application/vnd.mapbox-vector-tile','.mjs':'text/javascript'}
    def list_directory(self,path):
        self.send_error(404);return None
    def end_headers(self):
        self.send_header('Referrer-Policy','strict-origin-when-cross-origin')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Cache-Control','no-cache' if self.path.split('?')[0] in ('/','/index.html','/data/coverage.json') else 'private, max-age=3600')
        super().end_headers()
    def log_message(self,format,*args):
        if str(args[1]) not in ('200','304'):super().log_message(format,*args)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=3100);args=parser.parse_args()
    directory=ROOT/'apps'/'web'/'out'
    if not (directory/'index.html').exists():raise SystemExit('Run npm run build first.')
    server=ThreadingHTTPServer(('127.0.0.1',args.port),partial(Handler,directory=str(directory)))
    print(f'Parcel Explorer: http://127.0.0.1:{args.port} (loopback only)',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:server.server_close()
