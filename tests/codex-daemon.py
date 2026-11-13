import base64, hashlib, json, os, socket, struct, subprocess, sys, tempfile, threading, urllib.parse
from reader_bundle import bundle

"""The reader talks to Codex's daemon: it reads a conversation's open requests and answers them, and never opens a
conversation the daemon doesn't already have open."""

LOADED = "01a1d57f-fed7-70b0-8800-0ba8ed6091cf"
OTHER = "01a1d57f-0000-0000-0000-000000000000"
REQUEST = {"jsonrpc": "2.0", "id": 7, "method": "item/commandExecution/requestApproval",
           "params": {"threadId": LOADED, "itemId": "exec-1", "startedAtMs": 1, "command": "touch x", "availableDecisions": ["accept", "cancel"]}}
failures = []
seen = []
running = {"turn": None}

def check(name, ok):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok: failures.append(name)

def frame(obj):
    """A server's WebSocket text frame (unmasked)."""
    data = json.dumps(obj).encode()
    n = len(data)
    head = struct.pack("!BB", 0x81, n) if n < 126 else struct.pack("!BBH", 0x81, 126, n)
    return head + data

def read_frame(conn, buf):
    """A client's masked text frame from `buf` and `conn`: (message or None, rest)."""
    def need(n):
        nonlocal buf
        while len(buf) < n:
            more = conn.recv(65536)
            if not more: raise EOFError
            buf += more
    need(2)
    n = buf[1] & 0x7F
    at = 2
    if n == 126: need(4); n = struct.unpack("!H", buf[2:4])[0]; at = 4
    need(at + 4 + n)
    mask, payload = buf[at:at + 4], buf[at + 4:at + 4 + n]
    data = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
    return json.loads(data), buf[at + 4 + n:]

def serve(conn):
    """One client of the fake daemon: Codex's handshake, its loaded list, resume (which sends the open request again)."""
    buf = b""
    while b"\r\n\r\n" not in buf: buf += conn.recv(4096)
    head, buf = buf.split(b"\r\n\r\n", 1)
    key = [l.split(b": ", 1)[1] for l in head.split(b"\r\n") if l.lower().startswith(b"sec-websocket-key")][0]
    accept = base64.b64encode(hashlib.sha1(key + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest())
    conn.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + b"\r\n\r\n")
    try:
        while True:
            m, buf = read_frame(conn, buf)
            seen.append(m)
            method, mid = m.get("method"), m.get("id")
            if method == "initialize": conn.sendall(frame({"jsonrpc": "2.0", "id": mid, "result": {"userAgent": "fake"}}))
            elif method == "thread/loaded/list": conn.sendall(frame({"jsonrpc": "2.0", "id": mid, "result": {"data": [LOADED]}}))
            elif method == "thread/resume":
                conn.sendall(frame({"jsonrpc": "2.0", "id": mid, "result": {"thread": {"id": LOADED, "status": {"type": "active", "activeFlags": ["waitingOnApproval"]}}}}))
                conn.sendall(frame(REQUEST))
            elif method == "thread/turns/list":
                turns = [{"id": running["turn"], "status": "inProgress"}] if running["turn"] else [{"id": "old", "status": "completed"}]
                conn.sendall(frame({"jsonrpc": "2.0", "id": mid, "result": {"data": turns}}))
            elif method in ("turn/start", "turn/steer"):
                conn.sendall(frame({"jsonrpc": "2.0", "id": mid, "result": {"turnId": "t2"} if method == "turn/steer" else {"turn": {"id": "t2"}}}))
            elif method is None and mid == 7:
                conn.sendall(frame({"jsonrpc": "2.0", "method": "serverRequest/resolved", "params": {"threadId": LOADED, "requestId": 7}}))
    except (EOFError, OSError):
        pass
    finally:
        conn.close()

def daemon(home, req):
    """The reader's answer to one daemon request, with Codex's home at `home`."""
    env = dict(os.environ, CODEX_HOME=home)
    r = subprocess.run([sys.executable, "-I", script, "--app", "codex", "--daemon", json.dumps(req)], env=env, capture_output=True, text=True, timeout=30)
    line = next((l for l in r.stdout.splitlines() if l.startswith("DAEMON|")), "")
    return json.loads(urllib.parse.unquote(line[7:])) if line else {"stdout": r.stdout, "stderr": r.stderr}

script = str(bundle())
try:
    with tempfile.TemporaryDirectory() as home:
        check("no daemon: the conversation isn't open", daemon(home, {"op": "pending", "thread": LOADED}).get("open") is False)
        os.makedirs(os.path.join(home, "app-server-control"))
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind(os.path.join(home, "app-server-control", "app-server-control.sock"))
        listener.listen(8)
        def accept():
            while True:
                try: conn, _ = listener.accept()
                except OSError: return
                threading.Thread(target=serve, args=(conn,), daemon=True).start()
        threading.Thread(target=accept, daemon=True).start()

        r = daemon(home, {"op": "pending", "thread": LOADED})
        check("an open conversation's request is read", [q.get("params", {}).get("itemId") for q in r.get("requests", [])] == ["exec-1"])
        check("with the conversation's status", r.get("status", {}).get("activeFlags") == ["waitingOnApproval"])

        before = len(seen)
        r = daemon(home, {"op": "pending", "thread": OTHER})
        check("a conversation the daemon doesn't have open isn't open", r.get("open") is False)
        check("and the reader never opens it", not any(m.get("method") == "thread/resume" for m in seen[before:]))

        r = daemon(home, {"op": "answer", "thread": LOADED, "method": REQUEST["method"], "item": "exec-2", "result": {"decision": "accept"}})
        check("an answer to a request that's gone isn't sent", r.get("why") == "gone" and not any(m.get("id") == 7 and "result" in m for m in seen))

        r = daemon(home, {"op": "answer", "thread": LOADED, "method": REQUEST["method"], "item": "exec-1", "result": {"decision": "accept"}})
        check("an answer to the open request is sent and confirmed", r == {"ok": True})
        check("with the decision picked", any(m.get("id") == 7 and m.get("result") == {"decision": "accept"} for m in seen))
        check("and the daemon is never asked to change the conversation's settings", all(set(m.get("params", {})) <= {"threadId", "excludeTurns"} for m in seen if m.get("method") == "thread/resume"))
        r = daemon(home, {"op": "send", "thread": LOADED, "text": "hello", "images": ["/tmp/a.png"]})
        start = [m for m in seen if m.get("method") == "turn/start"]
        check("an idle conversation gets a new turn", r == {"sent": True} and len(start) == 1)
        check("with the image and the text, as the person typed them", start and start[-1]["params"]["input"] == [{"type": "localImage", "path": "/tmp/a.png"}, {"type": "text", "text": "hello", "text_elements": []}])
        check("and nothing that changes the conversation's settings", start and set(start[-1]["params"]) == {"threadId", "input"})
        running["turn"] = "t1"
        r = daemon(home, {"op": "send", "thread": LOADED, "text": "also this"})
        steer = [m for m in seen if m.get("method") == "turn/steer"]
        check("a working conversation's turn is steered, as Enter does in the terminal", r == {"sent": True, "steered": True} and steer and steer[-1]["params"]["expectedTurnId"] == "t1")
        before = len(seen)
        r = daemon(home, {"op": "send", "thread": OTHER, "text": "x"})
        check("a conversation the daemon doesn't have open isn't sent to, so typing it is safe", r.get("sent") is False and not any(m.get("method", "").startswith("turn/") for m in seen[before:]))
        listener.close()
finally:
    os.unlink(script)

sys.exit(1 if failures else 0)
