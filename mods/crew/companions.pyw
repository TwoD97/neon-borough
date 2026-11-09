"""herdr companions: your crew robots on the desktop, outside the herdr window.

Run with pythonw (no console):  pythonw companions.pyw   (python companions.pyw to see errors)

- Active agents appear while working or needing attention. On becoming idle,
  they signal completion for five seconds, then leave. Already-idle agents stay hidden.
  Robots come from the crew mod (mods/crew/chars).
- They wander along the top edge of the taskbar while herdr's window is minimized (Windows).
- Click a robot: herdr comes back and focuses that agent. Drag a robot to carry it elsewhere.
- Right-click: show always / only while herdr is minimized, start with Windows, quit.
Settings live in ~/.herdr/companions.json.
"""
import ctypes, hashlib, json, os, random, subprocess, sys, threading, time
import tkinter as tk
from PIL import Image, ImageTk

APP_HOME = os.environ.get("HERDR_APP_HOME") or os.path.expanduser("~/.config/herdr-app")
CHARS = os.path.join(APP_HOME, "mods", "crew", "chars")
FX = os.path.join(APP_HOME, "mods", "crew", "town", "fx")  # the town's status art
CONFIG = os.path.expanduser("~/.herdr/companions.json")
ORDER = ["patch", "ghost", "atlas", "zip", "nova", "hex"]
PALETTES = {"original", "claude", "codex", "violet", "mint", "rose", "gold"}
STATE_ANIM = {"working": "working", "blocked": "attention", "waiting": "idle", "done": "success", "idle": "idle"}
STATE_TEXT = {"working": "working", "blocked": "needs you", "waiting": "waiting", "done": "done", "idle": "idle"}
STATE_COLOR = {"working": "#49dcd7", "blocked": "#ffb347", "waiting": "#a98bff", "done": "#7ee787", "idle": "#8b98a9"}
SHELLS = {"bash", "zsh", "sh", "fish", "pwsh", "powershell", "cmd", "shell", "nu"}
KEY = "#010203"  # the window's transparent color
HEIGHT = 84      # robot height on screen
WINDOWS = sys.platform == "win32"
NO_WINDOW = 0x08000000 if WINDOWS else 0  # CREATE_NO_WINDOW


def run(args, timeout=8):
    try:
        r = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout, creationflags=NO_WINDOW)
        return r.stdout if r.returncode == 0 else None
    except Exception:
        return None


def load_config():
    try:
        d = json.load(open(CONFIG))
        return {"mode": d.get("mode", "minimized"), "with_herdr": d.get("with_herdr", True) is not False}
    except Exception:
        return {"mode": "minimized"}


def save_config(cfg):
    os.makedirs(os.path.dirname(CONFIG), exist_ok=True)
    json.dump(cfg, open(CONFIG, "w"))


# --- herdr's window (Windows) ------------------------------------------------------------------

_herdr = {"hwnd": None, "searched": 0.0}


def herdr_window():
    """The herdr-app main window handle, or None. The handle is kept while it stays valid; a new
    search (every window on the desktop) runs at most every 5 s while herdr isn't found."""
    if not WINDOWS:
        return None
    user32 = ctypes.windll.user32
    hwnd = _herdr["hwnd"]
    if hwnd and user32.IsWindow(hwnd):
        return hwnd
    if time.time() - _herdr["searched"] < 5:
        return None
    _herdr["searched"] = time.time()
    _herdr["hwnd"] = find_herdr_window()
    return _herdr["hwnd"]


def find_herdr_window():
    user32, kernel32 = ctypes.windll.user32, ctypes.windll.kernel32
    found = []

    def name_of(pid):
        h = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return ""
        buf, size = ctypes.create_unicode_buffer(512), ctypes.c_ulong(512)
        ok = kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size))
        kernel32.CloseHandle(h)
        return os.path.basename(buf.value).lower() if ok else ""

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def each(hwnd, _):
        if user32.IsWindowVisible(hwnd) and user32.GetWindowTextLengthW(hwnd) > 0:
            pid = ctypes.c_ulong()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if name_of(pid.value) == "herdr-app.exe":
                found.append(hwnd)
                return False
        return True

    user32.EnumWindows(each, 0)
    return found[0] if found else None


def herdr_minimized():
    hwnd = herdr_window()
    return bool(hwnd and ctypes.windll.user32.IsIconic(hwnd)) if WINDOWS else False


def bring_back_herdr():
    hwnd = herdr_window()
    if hwnd:
        user32 = ctypes.windll.user32
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        user32.SetForegroundWindow(hwnd)


# --- agents --------------------------------------------------------------------------------------

class TaskbarActivity:
    """Show active work and a brief completion signal, never a permanent idle queue."""
    def __init__(self):
        self.active = set()
        self.finishing = {}

    def select(self, agents, now=None):
        now = time.monotonic() if now is None else now
        current = {a["address"]: a for a in agents}
        active = {addr for addr, a in current.items() if a["status"] in ("working", "blocked", "waiting")}
        for addr in self.active - active:
            if addr in current and current[addr]["status"] in ("idle", "done"):
                self.finishing[addr] = now + 5
        self.active = active
        self.finishing = {addr: until for addr, until in self.finishing.items()
                          if until > now and addr in current and addr not in active}
        items = [a for addr, a in current.items() if addr in active]
        items += [{**current[addr], "status": "done"} for addr in self.finishing]
        order = {"blocked": 0, "working": 1, "waiting": 2, "done": 3}
        return sorted(items, key=lambda a: (order[a["status"]], a["address"]))[:8]


class Agents:
    """Polls herdr-core in the background; `items` is the latest list of agents."""

    def __init__(self):
        self.items, self.crew = [], {}
        self.appearance = {}
        threading.Thread(target=self.loop, daemon=True).start()

    def info(self, address):
        """herdr-core's labels and turn for one terminal (the crew label, what has been seen)."""
        out = run(["hc", "get", address])
        try:
            d = json.loads(out) if out else {}
        except Exception:
            d = {}
        return d.get("labels") or {}, d.get("turn")

    @staticmethod
    def crew_pick(address, label):
        """The crew panel's choice: the terminal's herdr.crew label, else the saved cast, else the
        same stable hash of the address it uses (h * 31 + code, 32-bit, over CHARACTERS)."""
        if label in ORDER:
            return label
        try:
            shared = json.load(open(os.path.join(APP_HOME, "shared.json"), encoding="utf-8"))
            cid = (shared.get("crew.cast") or {}).get(address)
            if cid in ORDER:
                return cid
        except Exception:
            pass
        h = 0
        for ch in address:
            h = (h * 31 + ord(ch)) & 0xFFFFFFFF
        return ORDER[h % len(ORDER)]

    def from_herdr(self):
        """The crew panel's own view (robot, name, status as herdr shows it), while herdr runs."""
        try:
            with open(os.path.join(APP_HOME, "data", "crew", "companions.json"), encoding="utf-8") as snapshot:
                d = json.load(snapshot)
            # Keep the last selected look even if the window stops publishing.
            # Stale snapshots supply appearance only; core still supplies status.
            self.appearance = {a["address"]: {"palette": a.get("palette", "original"), "name": a.get("name", "")}
                               for a in d["agents"] if a.get("address")}
            if time.time() - d["updated"] / 1000 > 15:
                return None  # herdr isn't running (or the crew mod isn't loaded)
            items = [{**a, "agent": "", "where": a.get("where", "")} for a in d["agents"]
                     if a.get("status") in STATE_ANIM and a.get("crew") in ORDER]
            order = {"blocked": 0, "working": 1, "waiting": 2, "done": 3, "idle": 4}
            return sorted(items, key=lambda a: (order[a["status"]], a["address"]))
        except Exception:
            return None

    def loop(self):
        while True:
            fresh = self.from_herdr()
            if fresh is not None:
                self.items = fresh
                time.sleep(2)
                continue
            out = run(["hc", "ls", "--json"])
            if out:
                try:
                    items = []
                    for t in json.loads(out).get("terminals", []):
                        agent, status = t.get("agent"), t.get("status")
                        if t.get("state") != "live" or not agent or agent in SHELLS or status not in STATE_ANIM:
                            continue
                        where = (t.get("where") or "").split(" / ")[0]
                        labels, turn = self.info(t["address"])
                        if status == "done" and turn is not None and str(labels.get("herdr.seen")) == str(turn):
                            status = "idle"  # already seen: herdr's panel shows it idle
                        crew = self.crew_pick(t["address"], labels.get("herdr.crew"))
                        items.append({"address": t["address"], "agent": agent, "status": status, "where": where, "crew": crew,
                                      **self.appearance.get(t["address"], {})})
                    order = {"blocked": 0, "working": 1, "waiting": 2, "done": 3, "idle": 4}
                    self.items = sorted(items, key=lambda a: (order[a["status"]], a["address"]))
                except Exception:
                    pass
            time.sleep(3)


# --- sprites -------------------------------------------------------------------------------------

class Sprites:
    def __init__(self):
        self.cache = {}

    def get(self, crew, anim, frame, flip=False, palette="original"):
        palette = palette if palette in PALETTES else "original"
        k = (crew, palette, anim, frame, flip)
        if k not in self.cache:
            base = CHARS if palette == "original" else os.path.join(CHARS, "providers", palette)
            path = os.path.join(base, crew, f"{anim}-{frame}.png")
            if not os.path.isfile(path):
                path = os.path.join(CHARS, crew, f"{anim}-{frame}.png")
            try:
                im = Image.open(path).convert("RGBA")
            except Exception:
                im = Image.new("RGBA", (157, 209), (0, 0, 0, 0))
            w = round(im.width * HEIGHT / im.height)
            im = im.resize((w, HEIGHT), Image.LANCZOS)
            if flip:
                im = im.transpose(Image.FLIP_LEFT_RIGHT)
            # The window keys out one exact color, so edges can't be half transparent. Each
            # pixel is either solid (blended onto a dark ink) or fully transparent, and the image
            # keeps that alpha so robots overlap each other cleanly on the canvas.
            bg = Image.new("RGBA", im.size, (11, 19, 32, 255))
            solid = Image.alpha_composite(bg, im)
            solid.putalpha(im.getchannel("A").point(lambda a: 255 if a > 90 else 0))
            self.cache[k] = ImageTk.PhotoImage(solid)
        return self.cache[k]


class Art:
    """The town's status art at a given height, keyed for the transparent window."""
    def __init__(self):
        self.cache = {}

    def get(self, name, height):
        k = (name, height)
        if k not in self.cache:
            try:
                im = Image.open(os.path.join(FX, name + ".png")).convert("RGBA")
                im = im.resize((max(1, round(im.width * height / im.height)), height), Image.LANCZOS)
                bg = Image.new("RGBA", im.size, (11, 19, 32, 255))
                solid = Image.alpha_composite(bg, im)
                solid.putalpha(im.getchannel("A").point(lambda a: 255 if a > 110 else 0))
                self.cache[k] = ImageTk.PhotoImage(solid)
            except Exception:
                self.cache[k] = None
        return self.cache[k]


def taskbar_band(root):
    """(left, right, taskbar top, taskbar bottom) on the monitor herdr's window is on (for a
    minimized window, the one it was minimized from), else the primary screen. The taskbar is
    the strip between the end of that monitor's work area and its bottom edge."""
    sw, sh = root.winfo_screenwidth(), root.winfo_screenheight()
    if WINDOWS:
        class RECT(ctypes.Structure):
            _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long), ("right", ctypes.c_long), ("bottom", ctypes.c_long)]
        class MONITORINFO(ctypes.Structure):
            _fields_ = [("cbSize", ctypes.c_ulong), ("rcMonitor", RECT), ("rcWork", RECT), ("dwFlags", ctypes.c_ulong)]
        user32 = ctypes.windll.user32
        user32.MonitorFromWindow.restype = ctypes.c_void_p
        user32.MonitorFromWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        user32.GetMonitorInfoW.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        hwnd = herdr_window()
        mon = user32.MonitorFromWindow(hwnd, 2) if hwnd else None  # MONITOR_DEFAULTTONEAREST
        info = MONITORINFO(); info.cbSize = ctypes.sizeof(MONITORINFO)
        if mon and user32.GetMonitorInfoW(mon, ctypes.byref(info)):
            m, w = info.rcMonitor, info.rcWork
            top = w.bottom if w.bottom < m.bottom else m.bottom - 48  # taskbar hidden or on another edge
            return w.left, w.right, top, m.bottom
        r = RECT()
        if user32.SystemParametersInfoW(0x30, 0, ctypes.byref(r), 0) and r.bottom < sh:  # SPI_GETWORKAREA
            return r.left, r.right, r.bottom, sh
    return 0, sw, sh - 48, sh


# --- window: robots wander along the top edge of the taskbar --------------------------------------

STEP_MS = 50
JUMP_ROOM = 46  # extra window height above the robots for jumps

# Where each status lives on the taskbar (fractions of its width) and how robots get there:
#   needs you -> leap to the middle and keep bouncing   done -> a shelf left of the middle, little hops
#   idle      -> stroll off to the left side and rest    working -> wander the middle of the bar
ZONES = {"blocked": 0.5, "done": 0.30, "idle": 0.06}


class Robot:
    def __init__(self, agent, x):
        self.agent, self.x, self.y = agent, float(x), 0.0
        self.dir = random.choice((-1, 1))
        self.pause = random.randint(0, 40)
        self.hop = 0       # steps into the current hop, 0 when on the ground
        self.slot = 0      # index among robots with the same status, so they line up
        self.wander = None

    def target(self, width):
        status = self.agent["status"]
        if status == "working":
            return None
        base = ZONES[status] * width
        spread = 74 if status == "blocked" else 64
        # Fan out around the zone: 0, +1, -1, +2, -2 ...
        k = (self.slot + 1) // 2 * (1 if self.slot % 2 else -1)
        if status == "idle":
            k = self.slot  # idle robots queue up from the left edge
        return min(max(base + k * spread, 50), width - 50)

    def start_hop(self, height, length):
        self.hop, self.hop_h, self.hop_len = 1, height, length

    def step(self, width):
        status = self.agent["status"]
        # Airborne: follow the arc.
        if self.hop:
            t = self.hop / self.hop_len
            self.y = -4 * self.hop_h * t * (1 - t)
            self.hop += 1
            if self.hop > self.hop_len:
                self.hop, self.y = 0, 0.0
        goal = self.target(width)
        if goal is None:  # working: wander the middle of the bar
            lo, hi = 0.18 * width, 0.82 * width
            if self.pause > 0:
                self.pause -= 1
                return
            if self.x < lo or self.x > hi:
                self.dir = 1 if self.x < lo else -1
            self.x += self.dir * 1.7
            if random.random() < 0.012:
                self.pause = random.randint(70, 180)  # 3.5 to 9 s at the station
                if random.random() < 0.5:
                    self.dir *= -1
            return
        gap = goal - self.x
        if abs(gap) > 6:
            self.dir = 1 if gap > 0 else -1
            if status == "blocked":
                # Leap there in big hops.
                if not self.hop:
                    self.start_hop(34, 14)
                self.x += self.dir * min(abs(gap), 11)
            else:
                self.x += self.dir * min(abs(gap), 2.6 if status == "done" else 1.4)
            return
        # Arrived.
        if status == "blocked":
            if not self.hop:
                self.start_hop(22, 10)  # keep bouncing until someone looks
        elif status == "done":
            if not self.hop and random.random() < 0.01:
                self.start_hop(10, 8)
        elif status == "idle":
            # Rest, then shuffle a little and face around.
            if random.random() < 0.004:
                self.dir *= -1

    @property
    def walking(self):
        return self.agent["status"] == "working" and self.pause == 0 and not self.hop


class Companions:
    def __init__(self):
        self.cfg = load_config()
        self.root = tk.Tk()
        self.root.title("herdr companions")
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        if WINDOWS:
            self.root.attributes("-transparentcolor", KEY)  # keyed pixels also let clicks through
        self.canvas = tk.Canvas(self.root, bg=KEY, highlightthickness=0, bd=0)
        self.canvas.pack(fill="both", expand=True)
        self.agents, self.sprites, self.art = Agents(), Sprites(), Art()
        self.robots, self.drag, self.shown, self.t = {}, None, None, 0
        self.items = {}  # address -> canvas ids and what they last showed
        # Robots stand on the taskbar's top edge (their feet on it), with room above for tags and jumps.
        self.feet = 0
        self.h = HEIGHT + JUMP_ROOM + 30
        self.band = None
        self.place()
        self.canvas.bind("<ButtonPress-1>", self.press)
        self.canvas.bind("<B1-Motion>", self.motion)
        self.canvas.bind("<ButtonRelease-1>", self.release)
        self.canvas.bind("<Button-3>", self.menu)
        self.tick()

    def place(self):
        """Sit on the taskbar of herdr's monitor; follows herdr to another screen."""
        band = taskbar_band(self.root)
        if band == self.band:
            return
        old = (self.right - self.left) if self.band else None
        self.band = band
        self.left, self.right, bar_top, _ = band
        self.root.geometry(f"{self.right - self.left}x{self.h}+{self.left}+{bar_top - self.h}")
        if old:  # keep each robot at the same share of the (maybe different) width
            for r in self.robots.values():
                r.x = r.x * (self.right - self.left) / old

    def visible(self):
        if self.cfg["mode"] == "always":
            return True
        return herdr_minimized() if WINDOWS else True

    def sync(self):
        """Robots follow the agent list: new agents walk in at a random spot, gone ones leave."""
        if not hasattr(self, "activity"):
            self.activity = TaskbarActivity()
        items = {a["address"]: a for a in self.activity.select(self.agents.items)}
        width = self.right - self.left
        for addr, a in items.items():
            if addr in self.robots:
                self.robots[addr].agent = a
            else:
                self.robots[addr] = Robot(a, random.randint(80, max(81, width - 80)))
        for addr in [k for k in self.robots if k not in items]:
            del self.robots[addr]
            for cid in self.items.pop(addr, {}).get("ids", ()):
                self.canvas.delete(cid)
        slots = {}
        for addr in sorted(self.robots):
            r = self.robots[addr]
            st = r.agent["status"]
            r.slot = slots.get(st, 0)
            slots[st] = r.slot + 1

    def tick(self):
        """One frame. An error is logged and the loop goes on, so the robots never silently stop."""
        try:
            delay = self.frame()
        except Exception:
            log_error()
            delay = 1000
        self.root.after(delay, self.tick)

    def frame(self):
        self.t += 1
        if self.t % 20 == 1:
            self.place()
            self.sync()
            show = bool(self.robots) and self.visible()
            if show != self.shown:
                (self.root.deiconify if show else self.root.withdraw)()
                if show:
                    self.root.attributes("-topmost", True)
                self.shown = show
        if self.shown:
            width = self.right - self.left
            for r in self.robots.values():
                if not (self.drag and self.drag.get("robot") is r):
                    r.step(width)
            self.draw()
            return STEP_MS
        # Hidden: only check every second whether to show up again (sync runs every 20 ticks).
        self.t += 20 - (self.t % 20)
        return 1000

    def draw(self):
        c = self.canvas
        frame = 1 + (self.t // 6) % 2
        lanes = []  # right edge of the last tag in each row, so close tags stack instead of overlapping
        for r in sorted(self.robots.values(), key=lambda r: r.x):
            a, status = r.agent, r.agent["status"]
            palette = a.get("palette", "original")
            if r.walking:
                img = self.sprites.get(a["crew"], "walk-left" if r.dir < 0 else "walk-right", 1 + (self.t // 3) % 4, palette=palette)
            else:
                img = self.sprites.get(a["crew"], STATE_ANIM[status], frame if status != "idle" else 1 + (self.t // 14) % 2,
                                       flip=r.dir < 0, palette=palette)
            color = STATE_COLOR[status]
            label = a.get("name") or a["crew"].upper()
            station = bubble = None
            if status == "working" and not r.walking:
                station = self.art.get(f"station-{a.get('kind') or 'run'}-{1 + (self.t // 10) % 2}", round(HEIGHT * 0.72))
            elif status in ("blocked", "done", "waiting"):
                bubble = self.art.get({"blocked": "bubble-alert", "waiting": "bubble-waiting"}.get(status, "bubble-done"), 30)
            tw = 7 * len(label) + 14
            lane = next((i for i, edge in enumerate(lanes) if r.x - tw / 2 > edge + 4), len(lanes))
            if lane == len(lanes):
                lanes.append(0)
            lanes[lane] = r.x + tw / 2
            base = self.h - self.feet + r.y
            top = base - HEIGHT - 20 - lane * 18
            it = self.items.get(a["address"])
            if it is None:
                ids = (c.create_image(0, 0, anchor="s"), c.create_rectangle(0, 0, 0, 0, fill="#0b1320"),
                       c.create_text(0, 0, font=("Segoe UI", 7, "bold")),
                       c.create_image(0, 0, anchor="s"), c.create_image(0, 0, anchor="s"))
                it = self.items[a["address"]] = {"ids": ids, "img": None, "label": None, "color": None, "station": None, "bubble": None}
            sprite, rect, text, st_id, bub_id = it["ids"]
            # The station stands on the bar on the side the robot faces; the bubble sits over its tag.
            c.coords(st_id, r.x + (46 if r.dir >= 0 else -46), base)
            c.coords(bub_id, r.x, top - 2)
            for key, cid, im in (("station", st_id, station), ("bubble", bub_id, bubble)):
                if it[key] is not im:
                    c.itemconfigure(cid, image=im or "", state="normal" if im else "hidden"); it[key] = im
            c.coords(sprite, r.x, base)
            c.coords(rect, r.x - tw / 2, top, r.x + tw / 2, top + 16)
            c.coords(text, r.x, top + 8)
            if it["img"] is not img:
                c.itemconfigure(sprite, image=img); it["img"] = img
            if it["label"] != label or it["color"] != color:
                c.itemconfigure(rect, outline=color)
                c.itemconfigure(text, text=label, fill=color if status != "idle" else "#c5d2e0")
                it["label"], it["color"] = label, color
            # Robots further right draw on top, like the old full redraw did.
            c.tag_raise(st_id); c.tag_raise(sprite); c.tag_raise(rect); c.tag_raise(text); c.tag_raise(bub_id)

    def robot_at(self, x):
        best = None
        for r in self.robots.values():
            if abs(r.x - x) < 30 and (best is None or abs(r.x - x) < abs(best.x - x)):
                best = r
        return best

    # Click: herdr comes back on that agent. Drag: carry the robot elsewhere on the ledge.
    def press(self, e):
        r = self.robot_at(e.x)
        self.drag = {"robot": r, "x0": e.x, "moved": False} if r else None

    def motion(self, e):
        if self.drag and abs(e.x - self.drag["x0"]) > 4:
            self.drag["moved"] = True
            self.drag["robot"].x = min(max(e.x, 50), self.right - self.left - 50)

    def release(self, e):
        d, self.drag = self.drag, None
        if d and not d["moved"]:
            bring_back_herdr()
            run(["herdr-app", "do", "agent.focus", "--terminal", d["robot"].agent["address"]])

    def menu(self, e):
        m = tk.Menu(self.root, tearoff=0)
        mode = tk.StringVar(value=self.cfg["mode"])
        m.add_radiobutton(label="Show while herdr is minimized", variable=mode, value="minimized", command=lambda: self.set_mode("minimized"))
        m.add_radiobutton(label="Always show", variable=mode, value="always", command=lambda: self.set_mode("always"))
        m.add_separator()
        if WINDOWS:
            m.add_checkbutton(label="Start with herdr", onvalue=True, offvalue=False,
                              variable=tk.BooleanVar(value=self.cfg.get("with_herdr", True)), command=self.toggle_with_herdr)
            m.add_checkbutton(label="Start with Windows", onvalue=True, offvalue=False,
                              variable=tk.BooleanVar(value=os.path.exists(startup_link())), command=toggle_startup)
        m.add_command(label="Quit", command=self.root.destroy)
        m.tk_popup(e.x_root, e.y_root)

    def toggle_with_herdr(self):
        self.cfg["with_herdr"] = not self.cfg.get("with_herdr", True)
        save_config(self.cfg)

    def set_mode(self, mode):
        self.cfg["mode"] = mode
        save_config(self.cfg)


# --- start with Windows: a .cmd in the Startup folder --------------------------------------------

def startup_link():
    return os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Windows\Start Menu\Programs\Startup\herdr-companions.cmd")


def toggle_startup():
    p = startup_link()
    if os.path.exists(p):
        os.remove(p)
        return
    pyw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    with open(p, "w") as f:
        f.write(f'@start "" "{pyw if os.path.exists(pyw) else sys.executable}" "{os.path.abspath(__file__)}"\n')


LOG = os.path.join(os.path.expanduser("~"), ".herdr", "companions.log")


def log_error():
    """pythonw has no console: append the traceback to ~/.herdr/companions.log (kept small)."""
    import traceback
    try:
        if os.path.exists(LOG) and os.path.getsize(LOG) > 200_000:
            os.replace(LOG, LOG + ".old")
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + traceback.format_exc() + "\n")
    except Exception:
        pass


def already_running():
    """One copy only: herdr starts this on every launch, and so may Windows."""
    if not WINDOWS:
        return False
    global _MUTEX
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _MUTEX = kernel32.CreateMutexW(None, False, r"Local\herdr-companions")
    return ctypes.get_last_error() == 183  # ERROR_ALREADY_EXISTS


if __name__ == "__main__":
    if already_running():
        sys.exit(0)
    try:
        app = Companions()
        app.root.report_callback_exception = lambda *exc: log_error()
        app.root.mainloop()
    except Exception:
        log_error()
        raise
