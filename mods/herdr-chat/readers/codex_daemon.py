CODEX_DAEMON_WAIT = 0.25
CODEX_DAEMON_ANSWER_WAIT = 2.0
CODEX_DAEMON_DEADLINE = 6.0

def codex_daemon_socket():
    """The control socket of Codex's shared app-server daemon, which Codex's terminals run their conversations in."""
    root = os.environ.get("CODEX_HOME") or os.path.join(HOME, ".codex")
    return os.path.join(root, "app-server-control", "app-server-control.sock")

class CodexDaemonLink:
    """One JSON-RPC connection to the daemon: WebSocket frames over its unix socket, as Codex's own clients speak it."""

    def __init__(self, path, deadline):
        import base64, socket
        self.deadline = deadline
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(max(0.1, deadline - codex_daemon_now()))
        self.sock.connect(path)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(("GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n" % key).encode())
        head = b""
        while b"\r\n\r\n" not in head:
            more = self.sock.recv(4096)
            if not more: raise EOFError("the daemon closed the connection")
            head += more
        status, self.buf = head.split(b"\r\n\r\n", 1)
        if b" 101 " not in status.split(b"\r\n")[0]: raise EOFError("the daemon refused the connection")
        self.next_id = 0
        self.inbox = []
        self.status = {}

    def take(self, n, until=None):
        while len(self.buf) < n:
            self.sock.settimeout(max(0.05, min(until or self.deadline, self.deadline) - codex_daemon_now()))
            more = self.sock.recv(65536)
            if not more: raise EOFError("the daemon closed the connection")
            self.buf += more
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, obj):
        import struct
        data = json.dumps(obj).encode()
        n, mask = len(data), os.urandom(4)
        if n < 126: head = struct.pack("!BB", 0x81, 0x80 | n)
        elif n < 65536: head = struct.pack("!BBH", 0x81, 0x80 | 126, n)
        else: head = struct.pack("!BBQ", 0x81, 0x80 | 127, n)
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def receive(self, until):
        """The next message, or None once `until` passes."""
        import socket, struct
        data = b""
        while True:
            left = min(until, self.deadline) - codex_daemon_now()
            if left <= 0 and not self.buf: return None
            self.sock.settimeout(max(0.05, left))
            try:
                b0, b1 = self.take(2, until)
            except socket.timeout:
                return None
            op, n = b0 & 0x0F, b1 & 0x7F
            if n == 126: n = struct.unpack("!H", self.take(2))[0]
            elif n == 127: n = struct.unpack("!Q", self.take(8))[0]
            mask = self.take(4) if b1 & 0x80 else None
            payload = self.take(n)
            if mask: payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
            if op == 8: raise EOFError("the daemon closed the connection")
            if op == 9:
                self.sock.sendall(struct.pack("!BB", 0x8A, 0x80 | len(payload)) + b"\0\0\0\0" + payload)
                continue
            if op == 10: continue
            data += payload
            if b0 & 0x80: return json.loads(data)

    def request(self, method, params):
        """A request's result; what else arrives meanwhile is kept in `inbox`."""
        self.next_id += 1
        mine = "herdr-chat-%d" % self.next_id
        self.send({"jsonrpc": "2.0", "id": mine, "method": method, "params": params})
        while True:
            m = self.receive(self.deadline)
            if m is None: raise TimeoutError(method)
            if m.get("id") == mine and "method" not in m:
                if "error" in m: raise RuntimeError("%s: %s" % (method, (m["error"] or {}).get("message", m["error"])))
                return m.get("result") or {}
            self.inbox.append(m)

    def close(self):
        try: self.sock.close()
        except OSError: pass

def codex_daemon_now():
    import time
    return time.monotonic()

def codex_daemon_join(thread, deadline):
    """A connection subscribed to `thread`, joined only while the daemon already has that conversation open: resuming a
    closed one would open it a second time, beside the terminal's own."""
    path = codex_daemon_socket()
    if os.name == "nt" or not os.path.exists(path): return None, "no daemon here"
    link = CodexDaemonLink(path, deadline)
    link.request("initialize", {"clientInfo": {"name": "herdr-chat", "title": "Herdr Chat", "version": "1"}, "capabilities": {"experimentalApi": True}})
    link.send({"jsonrpc": "2.0", "method": "initialized"})
    loaded = link.request("thread/loaded/list", {}).get("data") or []
    if thread not in loaded:
        link.close()
        return None, "closed in the daemon"
    resumed = link.request("thread/resume", {"threadId": thread, "excludeTurns": True})
    link.status = ((resumed.get("thread") or {}).get("status")) or {}
    return link, ""

def codex_daemon_requests(link, thread, wait):
    """The questions the daemon has open for `thread`: it sends them again to a client that joins."""
    until = codex_daemon_now() + wait
    while True:
        m = link.receive(until)
        if m is None: break
        link.inbox.append(m)
    return [{"id": m["id"], "method": m["method"], "params": m.get("params") or {}} for m in link.inbox
            if "id" in m and "method" in m and (m.get("params") or {}).get("threadId") == thread]

def codex_daemon_pending(req):
    """The requests the daemon has open for `req["thread"]`, with the conversation's status."""
    link, why = codex_daemon_join(req["thread"], codex_daemon_now() + CODEX_DAEMON_DEADLINE)
    if not link: return {"open": False, "why": why}
    try:
        return {"open": True, "status": link.status, "requests": codex_daemon_requests(link, req["thread"], CODEX_DAEMON_WAIT)}
    finally: link.close()

def codex_daemon_answer(req):
    """Answers the open question whose item is `req["item"]`, then waits for the daemon to close it."""
    link, why = codex_daemon_join(req["thread"], codex_daemon_now() + CODEX_DAEMON_DEADLINE)
    if not link: return {"ok": False, "why": why}
    try:
        until = codex_daemon_now() + CODEX_DAEMON_ANSWER_WAIT
        found = None
        while not found and codex_daemon_now() < until:
            found = next((r for r in codex_daemon_requests(link, req["thread"], 0.1)
                          if r["method"] == req["method"] and r["params"].get("itemId") == req["item"]), None)
        if not found: return {"ok": False, "why": "gone"}
        link.send({"jsonrpc": "2.0", "id": found["id"], "result": req["result"]})
        until = codex_daemon_now() + CODEX_DAEMON_ANSWER_WAIT
        while codex_daemon_now() < until:
            m = link.receive(until)
            if m is None: break
            if m.get("method") == "serverRequest/resolved" and (m.get("params") or {}).get("requestId") == found["id"]: return {"ok": True}
        return {"ok": True, "unconfirmed": True}
    finally: link.close()

def codex_daemon_running_turn(link, thread):
    """The id of the turn `thread` is running, or None."""
    turns = link.request("thread/turns/list", {"threadId": thread, "limit": 1, "sortDirection": "desc"}).get("data") or []
    return turns[0]["id"] if turns and turns[0].get("status") == "inProgress" else None

def codex_daemon_send(req):
    """Sends a message as the person: a new turn when the conversation is idle, else into the turn it's running, as Enter
    does in Codex's terminal. `sent` is False when the request stayed with the chat, so typing the message instead is safe."""
    link, why = codex_daemon_join(req["thread"], codex_daemon_now() + CODEX_DAEMON_DEADLINE)
    if not link: return {"sent": False, "why": why}
    inputs = [{"type": "localImage", "path": p} for p in req.get("images") or []]
    if req.get("text"): inputs.append({"type": "text", "text": req["text"], "text_elements": []})
    try:
        for _ in range(2):
            running = codex_daemon_running_turn(link, req["thread"])
            try:
                if running:
                    link.request("turn/steer", {"threadId": req["thread"], "expectedTurnId": running, "input": inputs})
                    return {"sent": True, "steered": True}
                link.request("turn/start", {"threadId": req["thread"], "input": inputs})
                return {"sent": True}
            except RuntimeError:
                continue
        return {"sent": False, "why": "the conversation's turn kept changing"}
    finally: link.close()

DAEMONS["codex"] = {"pending": codex_daemon_pending, "answer": codex_daemon_answer, "send": codex_daemon_send}
