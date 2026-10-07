# DaVinci Resolve during playback (#88)

Issue: the Resolve source updated only while the timeline was paused.

## Measurement (07.10.2026, DaVinci Resolve Studio 21.1.1.10, macOS)

Own test project `lz-scopes-test-88` with a 60 s ffmpeg `testsrc2` clip on the Color page; external scripting Local; system Python 3.9 with the `DaVinciResolveScript` module of the installation.

| State | Call | Result |
|---|---|---|
| paused | `Project.ExportCurrentFrameAsStill` | `True`, 7–16 ms per 1920×1080 16-bit TIFF |
| paused | `Timeline.GetCurrentTimecode` | ≤ 11 ms |
| playing | any call (`ExportCurrentFrameAsStill`, `GetCurrentTimecode`, also `GetProductName` in `--probe`) | blocks; no answer within 15 s |
| playing → paused | the blocked calls | return right after the pause, export the paused frame |

So it is not GrabStill/ExportCurrentFrameAsStill being unable to render a moving frame: the whole external scripting connection waits while Resolve plays. `GrabStill` was therefore not tried separately (it would block the same way and also writes into the project gallery).

The scripting API has no "is playing" query and no transport control (`Developer/Scripting/DaVinciResolveScript.pyi` and `CHANGELOG.md` of 21.1, read locally). The probe of the source list ran into its timeout during playback and reported "Python missing" – fixed: a probe timeout is now "busy" (`server/resolve.mjs`).

## Ways to a moving picture

| Way | Live? | Colour accuracy | Needs | Decision |
|---|---|---|---|---|
| Scripting stills | no, only paused | exact: 16 bit graded render | Studio, scripting Local | stays the route while paused |
| Window capture of the Resolve window, cropped to the viewer | yes, ~30 fps | 8 bit, scaled to the viewer, after Resolve's viewer colour management and macOS ColorSync ("Use Mac Display Color Profile for viewers", Resolve manual ch. 3 and 127) | same computer; macOS Screen Recording permission | **automatic during playback** |
| Video Clean Feed to a second display + screen capture | yes | as window capture, full size | a second display | documented (manual) |
| Clean feed / video output through DeckLink or UltraStudio into a capture card | yes | 10 bit, no display colour management | Blackmagic hardware, a capture input | documented as the exact live route; existing `decklink:`/`device:` sources |
| DaVinci Remote Monitor | yes | up to 12 bit 4:4:4 | Blackmagic Cloud account on host and client; client is Blackmagic's own app (manual ch. 198) | not usable as an input |
| NDI output from Resolve | – | – | not found in the Resolve 21 manual | – |

Window capture was checked to work while the Resolve window is covered by other windows (`screencapture -l <window>` and Electron `desktopCapturer`, both 07.10.2026).

## Implementation

- `server/resolveWatch.mjs`: the helper prints one line per still; no line for longer than max(800 ms, 4 frame periods) means *playing*. When lines come again the time code tells real playback (moved) from a slow export (unchanged; the threshold grows).
- The bridge sends `{"type":"resolve","state":"playing"|"paused","played":bool,"project":…}` (docs/frame-protocol.md).
- `src/resolvePlayback.ts`: on *playing* the desktop app captures the Resolve window (window titled like the project, else any Resolve window), `src/resolveViewer.ts` finds the viewer by normalised cross-correlation of the last exact still against the capture (96 → 320 → 960 px wide, coarse to fine; gain/offset of the display colour management do not matter). Real capture: viewer found to within about 5 px of 2690 px, score 0.89, ~0.3 s. The cropped live picture is shown until the next exact still arrives. In the browser the user picks the window once (getDisplayMedia needs a click).
- The source card shows the route (exact still / live window capture / last still held), why, and its colour accuracy.

Checked end to end with the desktop app and Resolve 21.1.1 on 07.10.2026: play → card "Live: Fensteraufnahme", scopes move; pause → "Exaktes Standbild" again. Not checked: Windows and Linux, the browser path with getDisplayMedia, Resolve layouts with dual screen or cinema viewer.

## Sources

- Blackmagic Design, `Developer/Scripting/README.md`, `DaVinciResolveScript.pyi`, `CHANGELOG.md` (Resolve 21.1 installation, last updated 31 Aug / 1 Sep 2026).
- DaVinci Resolve 21 manual (installation PDF): "Video Clean Feed (Studio Version Only)", "Use Mac Display Color Profile for viewers", chapter 198 "DaVinci Remote Monitor".
- Electron documentation, `desktopCapturer` (electronjs.org/docs/latest/api/desktop-capturer): Screen Recording consent on macOS 10.15+.
