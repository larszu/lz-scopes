// lz-decklink – Blackmagic DeckLink / UltraStudio capture helper for the lz-scopes bridge.
//
//   lz-decklink --list                       one JSON line: {"ok":true,"devices":[…]} or {"ok":false,"error":"…"}
//   lz-decklink --reference <index>          one JSON line: genlock/reference status (#72), see reference()
//   lz-decklink --capture <index> [--bits 8|10]
//                                            helper protocol on stdout (docs/frame-protocol.md):
//                                            INFO / FRAM / STAT / ERR records
//
// Pixel formats: YCbCr input → v210 (10 bit) or UYVY (8 bit) unchanged; RGB 4:4:4 input →
// bmdFormat10BitRGB ('r210', SMPTE levels 64–940) converted here to full-range rgb48le.
// Input format detection (bmdVideoInputEnableFormatDetection) re-enables the input on
// every change and sends a new INFO record.
//
// Built against the DeckLink SDK headers (Desktop Video SDK, free download from Blackmagic
// Design after registration – not part of this repository). See README.md next to this file.
//
// STATUS: compiled on macOS against SDK 12.0 headers; NEVER RUN WITH HARDWARE. Windows and
// Linux branches are written from the SDK headers and not compiled here.

#ifdef _WIN32
#include <windows.h>
#endif
#include "DeckLinkAPI.h"

#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

// ---------------------------------------------------------------- output (helper protocol)

static std::mutex g_out;

static void writeRecord(const char tag[4], const void* data, uint32_t len) {
  std::lock_guard<std::mutex> lock(g_out);
  uint8_t head[8];
  std::memcpy(head, tag, 4);
  head[4] = len & 0xff; head[5] = (len >> 8) & 0xff; head[6] = (len >> 16) & 0xff; head[7] = (len >> 24) & 0xff;
  if (fwrite(head, 1, 8, stdout) != 8 || (len && fwrite(data, 1, len, stdout) != len)) std::exit(0); // bridge closed the pipe
  fflush(stdout);
}
static void writeText(const char tag[4], const std::string& s) { writeRecord(tag, s.data(), (uint32_t)s.size()); }

static std::string jsonEscape(const std::string& s) {
  std::string o;
  for (char c : s) {
    if (c == '"' || c == '\\') { o += '\\'; o += c; }
    else if ((unsigned char)c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o += b; }
    else o += c;
  }
  return o;
}

// ---------------------------------------------------------------- platform strings

#if defined(__APPLE__)
typedef bool DLBool;
typedef CFStringRef DLString;
static std::string toStd(DLString s) {
  if (!s) return "";
  char buf[512];
  std::string out = CFStringGetCString(s, buf, sizeof buf, kCFStringEncodingUTF8) ? buf : "";
  CFRelease(s);
  return out;
}
#elif defined(_WIN32)
typedef BOOL DLBool;
typedef BSTR DLString;
static std::string toStd(DLString s) {
  if (!s) return "";
  int n = WideCharToMultiByte(CP_UTF8, 0, s, -1, nullptr, 0, nullptr, nullptr);
  std::string out(n > 0 ? n - 1 : 0, '\0');
  if (n > 1) WideCharToMultiByte(CP_UTF8, 0, s, -1, &out[0], n, nullptr, nullptr);
  SysFreeString(s);
  return out;
}
#else
typedef bool DLBool;
typedef const char* DLString;
static std::string toStd(DLString s) {
  if (!s) return "";
  std::string out(s);
  free((void*)s);
  return out;
}
#endif

static IDeckLinkIterator* createIterator() {
#ifdef _WIN32
  IDeckLinkIterator* it = nullptr;
  if (FAILED(CoInitializeEx(nullptr, COINIT_MULTITHREADED))) return nullptr;
  if (FAILED(CoCreateInstance(CLSID_CDeckLinkIterator, nullptr, CLSCTX_ALL, IID_IDeckLinkIterator, (void**)&it))) return nullptr;
  return it;
#else
  return CreateDeckLinkIteratorInstance(); // DeckLinkAPIDispatch.cpp: nullptr without Desktop Video
#endif
}

static std::vector<IDeckLink*> allDevices() {
  std::vector<IDeckLink*> list;
  IDeckLinkIterator* it = createIterator();
  if (!it) return list;
  IDeckLink* d = nullptr;
  while (it->Next(&d) == S_OK) list.push_back(d);
  it->Release();
  return list;
}

// ---------------------------------------------------------------- --list

static int listDevices() {
  IDeckLinkIterator* it = createIterator();
  if (!it) {
    printf("{\"ok\":false,\"error\":\"Blackmagic Desktop Video ist nicht installiert (DeckLink-Treiber fehlt)\"}\n");
    return 0;
  }
  it->Release();
  std::string out = "{\"ok\":true,\"devices\":[";
  int index = 0;
  for (IDeckLink* d : allDevices()) {
    DLString name = nullptr;
    d->GetDisplayName(&name);
    bool detect = false, canInput = false;
    IDeckLinkProfileAttributes* attr = nullptr;
    if (d->QueryInterface(IID_IDeckLinkProfileAttributes, (void**)&attr) == S_OK) {
      DLBool f = false;
      if (attr->GetFlag(BMDDeckLinkSupportsInputFormatDetection, &f) == S_OK) detect = f;
      int64_t io = 0;
      if (attr->GetInt(BMDDeckLinkVideoIOSupport, &io) == S_OK) canInput = (io & bmdDeviceSupportsCapture) != 0;
      attr->Release();
    }
    if (index) out += ",";
    out += "{\"index\":" + std::to_string(index) + ",\"name\":\"" + jsonEscape(toStd(name)) + "\",\"formatDetection\":" + (detect ? "true" : "false") + ",\"capture\":" + (canInput ? "true" : "false") + "}";
    d->Release();
    index++;
  }
  out += "]}";
  printf("%s\n", out.c_str());
  return 0;
}

// ---------------------------------------------------------------- capture

class Capture : public IDeckLinkInputCallback {
 public:
  Capture(IDeckLinkInput* in, bool tenBit) : input_(in), tenBit_(tenBit) {}

  // IUnknown (the object lives for the whole process)
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID, LPVOID* ppv) override { *ppv = nullptr; return E_NOINTERFACE; }
  ULONG STDMETHODCALLTYPE AddRef() override { return ++refs_; }
  ULONG STDMETHODCALLTYPE Release() override { return --refs_; }

  HRESULT STDMETHODCALLTYPE VideoInputFormatChanged(BMDVideoInputFormatChangedEvents, IDeckLinkDisplayMode* mode, BMDDetectedVideoInputFormatFlags flags) override {
    const bool rgb = (flags & bmdDetectedVideoInputRGB444) != 0;
    const BMDPixelFormat pf = rgb ? bmdFormat10BitRGB : (tenBit_ ? bmdFormat10BitYUV : bmdFormat8BitYUV);
    input_->PauseStreams();
    input_->EnableVideoInput(mode->GetDisplayMode(), pf, bmdVideoInputEnableFormatDetection);
    input_->FlushStreams();
    setMode(mode, pf);
    input_->StartStreams();
    return S_OK;
  }

  HRESULT STDMETHODCALLTYPE VideoInputFrameArrived(IDeckLinkVideoInputFrame* frame, IDeckLinkAudioInputPacket*) override {
    if (!frame) return S_OK;
    if (frame->GetFlags() & bmdFrameHasNoInputSource) {
      auto now = std::chrono::steady_clock::now();
      if (now - lastNoSignal_ > std::chrono::seconds(1)) { writeText("STAT", "{\"message\":\"kein Eingangssignal\"}"); lastNoSignal_ = now; }
      return S_OK;
    }
    const long w = frame->GetWidth(), h = frame->GetHeight(), row = frame->GetRowBytes();
    void* bytes = nullptr;
    if (frame->GetBytes(&bytes) != S_OK || !bytes) return S_OK;
    sendInfoIfChanged(frame);
    const uint8_t* src = static_cast<const uint8_t*>(bytes);
    if (pixel_ == bmdFormat10BitRGB) {
      // r210: big-endian 2:10:10:10, SMPTE levels 64–940 → full-range 16 bit (clipped)
      buf_.resize((size_t)w * h * 6);
      uint16_t* dst = reinterpret_cast<uint16_t*>(buf_.data());
      for (long y = 0; y < h; y++) {
        const uint8_t* p = src + y * row;
        for (long x = 0; x < w; x++, p += 4) {
          const uint32_t v = (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3];
          const uint32_t c[3] = { (v >> 20) & 0x3ff, (v >> 10) & 0x3ff, v & 0x3ff };
          for (int k = 0; k < 3; k++) {
            long s = ((long)c[k] - 64) * 65535 / 876;
            *dst++ = (uint16_t)(s < 0 ? 0 : s > 65535 ? 65535 : s);
          }
        }
      }
      writeRecord("FRAM", buf_.data(), (uint32_t)buf_.size());
      return S_OK;
    }
    // v210 rows are 128-byte blocks per 48 px, UYVY rows 2 bytes per px – DeckLink uses exactly
    // these strides, so rows are copied unless the driver pads them further
    const long tight = pixel_ == bmdFormat10BitYUV ? ((w + 47) / 48) * 128 : w * 2;
    if (row == tight) { writeRecord("FRAM", src, (uint32_t)(row * h)); return S_OK; }
    buf_.resize((size_t)tight * h);
    for (long y = 0; y < h; y++) std::memcpy(buf_.data() + y * tight, src + y * row, tight);
    writeRecord("FRAM", buf_.data(), (uint32_t)buf_.size());
    return S_OK;
  }

  void setMode(IDeckLinkDisplayMode* mode, BMDPixelFormat pf) {
    std::lock_guard<std::mutex> lock(modeLock_);
    BMDTimeValue duration = 0; BMDTimeScale scale = 0;
    mode->GetFrameRate(&duration, &scale);
    DLString name = nullptr;
    mode->GetName(&name);
    modeName_ = toStd(name);
    fpsNum_ = (long long)scale; fpsDen_ = (long long)duration;
    const BMDDisplayModeFlags f = mode->GetFlags();
    modeMatrix_ = (f & bmdDisplayModeColorspaceRec2020) ? "bt2020nc" : (f & bmdDisplayModeColorspaceRec601) ? "smpte170m" : (f & bmdDisplayModeColorspaceRec709) ? "bt709" : "unknown";
    interlaced_ = mode->GetFieldDominance() == bmdLowerFieldFirst || mode->GetFieldDominance() == bmdUpperFieldFirst;
    pixel_ = pf;
    lastInfo_.clear();
  }

 private:
  void sendInfoIfChanged(IDeckLinkVideoInputFrame* frame) {
    std::string matrix, transfer = "unknown", primaries = "unknown", tc;
    {
      std::lock_guard<std::mutex> lock(modeLock_);
      matrix = modeMatrix_;
    }
    // HDR and colorspace from the frame's metadata (CEA-861.3 EOTF: 0 SDR, 2 PQ, 3 HLG)
    IDeckLinkVideoFrameMetadataExtensions* meta = nullptr;
    if (frame->QueryInterface(IID_IDeckLinkVideoFrameMetadataExtensions, (void**)&meta) == S_OK) {
      int64_t v = 0;
      if (meta->GetInt(bmdDeckLinkFrameMetadataColorspace, &v) == S_OK) {
        if (v == bmdColorspaceRec2020) { matrix = "bt2020nc"; primaries = "bt2020"; }
        else if (v == bmdColorspaceRec709) { matrix = "bt709"; primaries = "bt709"; }
        else if (v == bmdColorspaceRec601) { matrix = "smpte170m"; }
      }
      if ((frame->GetFlags() & bmdFrameContainsHDRMetadata) && meta->GetInt(bmdDeckLinkFrameMetadataHDRElectroOpticalTransferFunc, &v) == S_OK) {
        transfer = v == 2 ? "smpte2084" : v == 3 ? "arib-std-b67" : v == 0 ? "bt709" : "unknown";
      }
      meta->Release();
    }
    IDeckLinkTimecode* t = nullptr;
    if (frame->GetTimecode(bmdTimecodeRP188Any, &t) == S_OK && t) {
      uint8_t hh = 0, mm = 0, ss = 0, ff = 0;
      if (t->GetComponents(&hh, &mm, &ss, &ff) == S_OK) { char b[16]; snprintf(b, sizeof b, "%02u:%02u:%02u:%02u", hh, mm, ss, ff); tc = b; }
      // every frame: TIME record with the RP 188 timecode (the bridge forwards it as {type:'tc'})
      if (!tc.empty()) writeText("TIME", "{\"tc\":\"" + tc + "\",\"df\":" + ((t->GetFlags() & bmdTimecodeIsDropFrame) ? "true" : "false") + "}");
      t->Release();
    }
    const char* pixel = pixel_ == bmdFormat10BitRGB ? "rgb48le" : pixel_ == bmdFormat10BitYUV ? "v210" : "uyvy422";
    std::string info = "{\"width\":" + std::to_string(frame->GetWidth()) + ",\"height\":" + std::to_string(frame->GetHeight())
      + ",\"fpsNum\":" + std::to_string(fpsNum_) + ",\"fpsDen\":" + std::to_string(fpsDen_)
      + ",\"pixel\":\"" + pixel + "\",\"matrix\":\"" + matrix + "\",\"range\":\"" + (pixel_ == bmdFormat10BitRGB ? "pc" : "tv")
      + "\",\"transfer\":\"" + transfer + "\",\"primaries\":\"" + primaries + "\",\"interlaced\":" + (interlaced_ ? "true" : "false")
      + ",\"name\":\"" + jsonEscape(modeName_) + "\"";
    // the timecode changes every frame; only format changes trigger a new INFO
    if (info == lastInfo_) return;
    lastInfo_ = info;
    writeText("INFO", info + (tc.empty() ? "" : ",\"timecode\":\"" + tc + "\"") + "}");
  }

  IDeckLinkInput* input_;
  bool tenBit_;
  std::atomic<ULONG> refs_{1};
  std::mutex modeLock_;
  std::string modeName_, modeMatrix_ = "unknown", lastInfo_;
  long long fpsNum_ = 25, fpsDen_ = 1;
  bool interlaced_ = false;
  BMDPixelFormat pixel_ = bmdFormat10BitYUV;
  std::vector<uint8_t> buf_;
  std::chrono::steady_clock::time_point lastNoSignal_{};
};

static int fatal(const std::string& msg) { writeText("ERR ", msg); return 2; }

// ---------------------------------------------------------------- --reference (#72)

/** {"name","width","height","fpsNum","fpsDen","field"} of a display mode, "null" if unknown. */
static std::string modeJson(IDeckLink* d, int64_t mode) {
  if (!mode) return "null";
  IDeckLinkInput* in = nullptr;
  IDeckLinkOutput* out = nullptr;
  IDeckLinkDisplayModeIterator* it = nullptr;
  if (d->QueryInterface(IID_IDeckLinkInput, (void**)&in) == S_OK) in->GetDisplayModeIterator(&it);
  else if (d->QueryInterface(IID_IDeckLinkOutput, (void**)&out) == S_OK) out->GetDisplayModeIterator(&it);
  std::string json = "null";
  if (it) {
    IDeckLinkDisplayMode* m = nullptr;
    while (it->Next(&m) == S_OK) {
      if ((int64_t)m->GetDisplayMode() == mode && json == "null") {
        BMDTimeValue duration = 0; BMDTimeScale scale = 0;
        m->GetFrameRate(&duration, &scale);
        DLString name = nullptr;
        m->GetName(&name);
        const BMDFieldDominance f = m->GetFieldDominance();
        json = "{\"name\":\"" + jsonEscape(toStd(name)) + "\",\"width\":" + std::to_string(m->GetWidth()) + ",\"height\":" + std::to_string(m->GetHeight())
          + ",\"fpsNum\":" + std::to_string((long long)scale) + ",\"fpsDen\":" + std::to_string((long long)duration)
          + ",\"field\":\"" + (f == bmdProgressiveSegmentedFrame ? "psf" : f == bmdProgressiveFrame ? "progressive" : "interlaced") + "\"}";
      }
      m->Release();
    }
    it->Release();
  }
  if (in) in->Release();
  if (out) out->Release();
  return json;
}

/**
 * Reference (genlock) input status. Everything comes from the SDK: attributes
 * BMDDeckLinkHasReferenceInput / ...SupportsFullFrameReferenceInputTimingOffset, status
 * bmdDeckLinkStatusReferenceSignalLocked / ...Mode / ...Flags (mode and flags only on devices
 * with reference format detection), configuration bmdDeckLinkConfigReferenceInputTimingOffset
 * (pixels; +/-511, or +/- half the frame's total pixels with the full-frame attribute) and
 * IDeckLinkOutput::GetReferenceStatus. The SDK reports no phase between input and reference.
 */
static int reference(int index) {
  IDeckLinkIterator* probe = createIterator();
  if (!probe) { printf("{\"ok\":false,\"error\":\"Blackmagic Desktop Video ist nicht installiert (DeckLink-Treiber fehlt)\"}\n"); return 0; }
  probe->Release();
  std::vector<IDeckLink*> list = allDevices();
  if (index < 0 || index >= (int)list.size()) { printf("{\"ok\":false,\"error\":\"DeckLink-Gerät %d nicht vorhanden\"}\n", index); return 0; }
  IDeckLink* d = list[index];
  DLString dn = nullptr;
  d->GetDisplayName(&dn);
  std::string out = "{\"ok\":true,\"index\":" + std::to_string(index) + ",\"name\":\"" + jsonEscape(toStd(dn)) + "\"";
  DLBool has = false, full = false;
  IDeckLinkProfileAttributes* attr = nullptr;
  if (d->QueryInterface(IID_IDeckLinkProfileAttributes, (void**)&attr) == S_OK) {
    attr->GetFlag(BMDDeckLinkHasReferenceInput, &has);
    attr->GetFlag(BMDDeckLinkSupportsFullFrameReferenceInputTimingOffset, &full);
    attr->Release();
  }
  out += std::string(",\"hasReference\":") + (has ? "true" : "false") + ",\"fullFrameOffset\":" + (full ? "true" : "false");
  IDeckLinkStatus* st = nullptr;
  if (d->QueryInterface(IID_IDeckLinkStatus, (void**)&st) == S_OK) {
    DLBool locked = false, inLocked = false;
    int64_t mode = 0, flags = 0, inMode = 0;
    const bool lockedOk = st->GetFlag(bmdDeckLinkStatusReferenceSignalLocked, &locked) == S_OK;
    const bool modeOk = st->GetInt(bmdDeckLinkStatusReferenceSignalMode, &mode) == S_OK;
    const bool flagsOk = st->GetInt(bmdDeckLinkStatusReferenceSignalFlags, &flags) == S_OK;
    const bool inOk = st->GetFlag(bmdDeckLinkStatusVideoInputSignalLocked, &inLocked) == S_OK;
    const bool inModeOk = st->GetInt(bmdDeckLinkStatusCurrentVideoInputMode, &inMode) == S_OK;
    out += std::string(",\"referenceLocked\":") + (lockedOk ? (locked ? "true" : "false") : "null");
    out += ",\"referenceMode\":" + (modeOk ? modeJson(d, mode) : std::string("null"));
    out += std::string(",\"referencePsF\":") + (flagsOk ? ((flags & bmdDeckLinkVideoStatusPsF) ? "true" : "false") : "null");
    out += std::string(",\"inputLocked\":") + (inOk ? (inLocked ? "true" : "false") : "null");
    out += ",\"inputMode\":" + (inModeOk ? modeJson(d, inMode) : std::string("null"));
    st->Release();
  }
  IDeckLinkConfiguration* cfg = nullptr;
  if (d->QueryInterface(IID_IDeckLinkConfiguration, (void**)&cfg) == S_OK) {
    int64_t off = 0;
    if (cfg->GetInt(bmdDeckLinkConfigReferenceInputTimingOffset, &off) == S_OK) out += ",\"timingOffsetPixels\":" + std::to_string((long long)off);
    cfg->Release();
  }
  IDeckLinkOutput* o = nullptr;
  if (d->QueryInterface(IID_IDeckLinkOutput, (void**)&o) == S_OK) {
    BMDReferenceStatus rs = 0;
    if (o->GetReferenceStatus(&rs) == S_OK)
      out += std::string(",\"outputReference\":{\"locked\":") + ((rs & bmdReferenceLocked) ? "true" : "false") + ",\"notSupported\":" + ((rs & bmdReferenceNotSupportedByHardware) ? "true" : "false") + "}";
    o->Release();
  }
  out += "}";
  printf("%s\n", out.c_str());
  for (IDeckLink* x : list) x->Release();
  return 0;
}

static int capture(int index, bool tenBit) {
  std::vector<IDeckLink*> list = allDevices();
  if (list.empty()) return fatal("Keine DeckLink-Geräte gefunden (Desktop Video installiert? Gerät angeschlossen?)");
  if (index < 0 || index >= (int)list.size()) return fatal("DeckLink-Gerät " + std::to_string(index) + " nicht vorhanden");
  IDeckLink* d = list[index];
  IDeckLinkInput* in = nullptr;
  if (d->QueryInterface(IID_IDeckLinkInput, (void**)&in) != S_OK) return fatal("Gerät kann nicht aufnehmen");
  DLBool detect = false;
  IDeckLinkProfileAttributes* attr = nullptr;
  if (d->QueryInterface(IID_IDeckLinkProfileAttributes, (void**)&attr) == S_OK) { attr->GetFlag(BMDDeckLinkSupportsInputFormatDetection, &detect); attr->Release(); }

  // start with 1080i50 (or the first mode); format detection switches to the real signal
  IDeckLinkDisplayModeIterator* modes = nullptr;
  IDeckLinkDisplayMode* start = nullptr;
  if (in->GetDisplayModeIterator(&modes) == S_OK) {
    IDeckLinkDisplayMode* m = nullptr;
    while (modes->Next(&m) == S_OK) {
      if (!start) { start = m; continue; }
      if (m->GetDisplayMode() == bmdModeHD1080i50) { start->Release(); start = m; } else m->Release();
    }
    modes->Release();
  }
  if (!start) return fatal("Gerät meldet keine Videomodi");
  const BMDPixelFormat pf = tenBit ? bmdFormat10BitYUV : bmdFormat8BitYUV;
  Capture cb(in, tenBit);
  in->SetCallback(&cb);
  if (in->EnableVideoInput(start->GetDisplayMode(), pf, detect ? bmdVideoInputEnableFormatDetection : bmdVideoInputFlagDefault) != S_OK)
    return fatal("Videoeingang lässt sich nicht öffnen (von anderer Software belegt?)");
  cb.setMode(start, pf);
  start->Release();
  if (!detect) writeText("STAT", "{\"message\":\"Gerät ohne Formaterkennung – Modus fest auf 1080i50\"}");
  if (in->StartStreams() != S_OK) return fatal("Aufnahme lässt sich nicht starten");
  // runs until the bridge closes stdout (writeRecord exits) or kills the process
  for (;;) std::this_thread::sleep_for(std::chrono::seconds(1));
}

int main(int argc, char** argv) {
#ifdef _WIN32
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  if (argc >= 2 && std::strcmp(argv[1], "--list") == 0) return listDevices();
  if (argc >= 3 && std::strcmp(argv[1], "--reference") == 0) return reference(std::atoi(argv[2]));
  if (argc >= 3 && std::strcmp(argv[1], "--capture") == 0) {
    bool tenBit = true;
    for (int i = 3; i + 1 < argc; i++) if (std::strcmp(argv[i], "--bits") == 0) tenBit = std::strcmp(argv[i + 1], "8") != 0;
    return capture(std::atoi(argv[2]), tenBit);
  }
  fprintf(stderr, "usage: lz-decklink --list | --reference <index> | --capture <index> [--bits 8|10]\n");
  return 1;
}
