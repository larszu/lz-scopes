"""LZ Scopes – DaVinci Resolve input.

Keeps one scripting connection to Resolve and exports the current frame (viewer,
graded) as an uncompressed 16-bit TIFF, alternating between two files so the reader
never sees a half-written one. Prints one JSON line per frame:
  {"path": ".../f0.tif", "tc": "01:00:10:12", "fps": 25.0, "df": false, "timeline": "…", "project": "…"}
Needs DaVinci Resolve (Studio) with Preferences → System → General → External
scripting using: Local.
"""
import json
import os
import sys
import time

API = {
    "darwin": "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting",
    "win32": os.path.join(os.environ.get("PROGRAMDATA", "C:\\ProgramData"), "Blackmagic Design", "DaVinci Resolve", "Support", "Developer", "Scripting"),
    "linux": "/opt/resolve/Developer/Scripting",
}
LIB = {
    "darwin": "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so",
    "win32": "C:\\Program Files\\Blackmagic Design\\DaVinci Resolve\\fusionscript.dll",
    "linux": "/opt/resolve/libs/Fusion/fusionscript.so",
}
plat = "darwin" if sys.platform == "darwin" else "win32" if sys.platform.startswith("win") else "linux"
sys.path.append(os.path.join(os.environ.get("RESOLVE_SCRIPT_API", API[plat]), "Modules"))
os.environ.setdefault("RESOLVE_SCRIPT_LIB", LIB[plat])


def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def timeline_rate(timeline):
    """Timeline frame rate and drop-frame flag (README: "timelineFrameRate" returned as a number,
    "timelineDropFrameTimecode" '0' or '1'). GetSettings() on newer versions, GetSetting() before."""
    fps, df = None, None
    try:
        s = timeline.GetSettings() or {}
        fps, df = s.get("timelineFrameRate"), s.get("timelineDropFrameTimecode")
    except Exception:  # noqa: BLE001
        pass
    try:
        if fps is None:
            fps = timeline.GetSetting("timelineFrameRate")
        if df is None:
            df = timeline.GetSetting("timelineDropFrameTimecode")
    except Exception:  # noqa: BLE001
        pass
    try:
        fps = float(str(fps).split()[0])
    except Exception:  # noqa: BLE001
        fps = None
    return fps, str(df) == "1"


def main():
    folder = sys.argv[1]
    fps = max(0.5, min(30.0, float(sys.argv[2]) if len(sys.argv) > 2 else 10.0))
    try:
        import DaVinciResolveScript as dvr  # noqa: N813
    except Exception as e:  # noqa: BLE001
        out({"error": f"Resolve-Scripting-Modul nicht gefunden: {e}"})
        return
    resolve = dvr.scriptapp("Resolve")
    if not resolve:
        out({"error": "Resolve läuft nicht oder externes Scripting ist aus (Einstellungen → System → Allgemein → Externes Scripting: Lokal)"})
        return
    i = 0
    while True:
        t0 = time.time()
        project = resolve.GetProjectManager().GetCurrentProject()
        timeline = project.GetCurrentTimeline() if project else None
        if not timeline:
            out({"wait": "Kein Projekt/keine Timeline geöffnet"})
        else:
            path = os.path.join(folder, f"f{i % 2}.tif")
            if project.ExportCurrentFrameAsStill(path):
                fps, df = timeline_rate(timeline)
                out({"path": path, "tc": timeline.GetCurrentTimecode(), "fps": fps, "df": df, "timeline": timeline.GetName(), "project": project.GetName()})
                i += 1
            else:
                out({"wait": "Standbild-Export fehlgeschlagen (Farbseite/Viewer prüfen)"})
        time.sleep(max(0.0, 1.0 / fps - (time.time() - t0)))


if __name__ == "__main__":
    main()
