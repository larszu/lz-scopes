// lz-aja – AJA Video Systems capture helper for the lz-scopes bridge (KONA, Io, U-TAP, T-TAP …).
//
//   lz-aja --list                            one JSON line: {"ok":true,"devices":[…]} or {"ok":false,"error":"…"}
//   lz-aja --capture <index> [--bits 8|10] [--input sdi1|sdi2|…|hdmi1|…] [--audio 0|2|8|16]
//                                            helper protocol on stdout (docs/frame-protocol.md):
//                                            INFO / FRAM / FPTS / AUDI / TIME / VANC / STAT / ERR records
//
// Built against libajantv2 (AJA's open-source NTV2 SDK, MIT licence, github.com/aja-video/libajantv2),
// linked statically. The AJA driver (AJA Desktop Software on macOS/Windows, the ntv2 kernel module
// on Linux) is installed by the user; nothing of it is shipped.
//
// Pixel formats: NTV2_FBF_10BIT_YCBCR is v210 (6 px per 16 bytes, rows in 128-byte blocks per 48 px),
// NTV2_FBF_8BIT_YCBCR is UYVY ('2vuy'). An RGB signal on HDMI goes through the card's colour-space
// converter into Y′CbCr (the card's own CSC; matrix from the format: BT.601 for SD, BT.709 for HD).
// Format changes on the input are polled (GetInputVideoFormat) and restart AutoCirculate with a new
// INFO record. 4K/UHD (quad link, TSI, 12G) is not handled yet: STAT aja.format4k.
//
// STATUS: compiled in CI; NOT RUN WITH HARDWARE (no AJA card was available).

#include "ntv2card.h"
#include "ntv2devicescanner.h"
#include "ntv2utils.h"
#include "ntv2formatdescriptor.h"
#include "ntv2rp188.h"
#include "ajaanc/includes/ancillarylist.h"
#include "ajaanc/includes/ancillarydata.h"
#include "ajabase/system/process.h"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <csignal>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

static const ULWord APP_SIGNATURE = NTV2_FOURCC('L', 'Z', 'S', 'C');
// audio of one frame: 16 ch × 4 bytes × 2002 samples (23.98 fps) ≈ 128 KiB; AJA's demos use 401 KiB
static const size_t AUDIO_BYTES_MAX = 401 * 1024;
static std::atomic<bool> g_quit{false};

// ---------------------------------------------------------------- output (helper protocol)

static std::mutex g_out;

static bool rawWrite(const char tag[4], const void* data, uint32_t len) {
  std::lock_guard<std::mutex> lock(g_out);
  uint8_t head[8];
  std::memcpy(head, tag, 4);
  head[4] = len & 0xff; head[5] = (len >> 8) & 0xff; head[6] = (len >> 16) & 0xff; head[7] = (len >> 24) & 0xff;
  if (fwrite(head, 1, 8, stdout) != 8 || (len && fwrite(data, 1, len, stdout) != len)) { g_quit = true; return false; } // bridge closed the pipe
  fflush(stdout);
  return true;
}

// Writer thread as in lz-decklink: the newest picture wins (an unwritten FRAM is replaced and counted
// in g_skipped); sound, INFO, TIME, VANC are never dropped. The capture loop must not block on a full
// pipe, or AutoCirculate's frame ring on the card overruns and drops at its own discretion.
struct Record { char tag[4]; std::vector<uint8_t> data; };
static std::mutex g_qLock;
static std::condition_variable g_qCv;
static std::deque<Record> g_queue;
static std::vector<std::vector<uint8_t>> g_pool; // recycled FRAM buffers (under g_qLock)
static std::atomic<bool> g_async{false};
static std::atomic<uint32_t> g_skipped{0};

static void recycle(std::vector<uint8_t>&& v) { if (g_pool.size() < 4) g_pool.push_back(std::move(v)); }

static void enqueue(Record&& r) {
  std::lock_guard<std::mutex> lock(g_qLock);
  if (std::memcmp(r.tag, "FRAM", 4) == 0)
    for (auto it = g_queue.begin(); it != g_queue.end(); ++it)
      if (std::memcmp(it->tag, "FRAM", 4) == 0) { recycle(std::move(it->data)); g_queue.erase(it); g_skipped++; break; }
  g_queue.push_back(std::move(r));
  g_qCv.notify_one();
}

static void writerLoop() {
  while (!g_quit) {
    Record r;
    {
      std::unique_lock<std::mutex> lock(g_qLock);
      g_qCv.wait_for(lock, std::chrono::milliseconds(200), [] { return !g_queue.empty(); });
      if (g_queue.empty()) continue;
      r = std::move(g_queue.front());
      g_queue.pop_front();
    }
    rawWrite(r.tag, r.data.data(), (uint32_t)r.data.size());
    if (std::memcmp(r.tag, "FRAM", 4) == 0) { std::lock_guard<std::mutex> lock(g_qLock); recycle(std::move(r.data)); }
  }
}

static void writeRecord(const char tag[4], const void* data, uint32_t len) {
  if (!g_async) { rawWrite(tag, data, len); return; }
  Record r;
  std::memcpy(r.tag, tag, 4);
  r.data.assign(static_cast<const uint8_t*>(data), static_cast<const uint8_t*>(data) + len);
  enqueue(std::move(r));
}
static void writeText(const char tag[4], const std::string& s) { writeRecord(tag, s.data(), (uint32_t)s.size()); }

/** A FRAM buffer from the pool, sized for the picture (filled by the caller, then sendFrame). */
static std::vector<uint8_t> frameBuffer(size_t n) {
  std::vector<uint8_t> v;
  { std::lock_guard<std::mutex> lock(g_qLock); if (!g_pool.empty()) { v = std::move(g_pool.back()); g_pool.pop_back(); } }
  v.resize(n);
  return v;
}
static void sendFrame(std::vector<uint8_t>&& v) {
  if (!g_async) { rawWrite("FRAM", v.data(), (uint32_t)v.size()); return; }
  Record r;
  std::memcpy(r.tag, "FRAM", 4);
  r.data = std::move(v);
  enqueue(std::move(r));
}

static std::string jsonEscape(const std::string& s) {
  std::string o;
  for (char c : s) {
    if (c == '"' || c == '\\') { o += '\\'; o += c; }
    else if ((unsigned char)c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o += b; }
    else o += c;
  }
  return o;
}

// ERR as JSON {code, message, params?}: the UI translates the code (server/messages.mjs); texts contain no quotes
static int fatal(const char* code, const std::string& msg, const std::string& params = "") {
  const std::string s = std::string("{\"code\":\"") + code + "\",\"message\":\"" + jsonEscape(msg) + "\"" + (params.empty() ? "" : ",\"params\":" + params) + "}";
  rawWrite("ERR ", s.data(), (uint32_t)s.size());
  return 2;
}

// ---------------------------------------------------------------- inputs

struct Input { std::string name; NTV2InputSource source; };

/** SDI and HDMI inputs of the device, named sdi1…, hdmi1… (the card's connector numbering). */
static std::vector<Input> deviceInputs(CNTV2Card& dev) {
  std::vector<Input> list;
  const UWord sdi = dev.features().GetNumVideoInputs(), hdmi = dev.features().GetNumHDMIVideoInputs();
  for (UWord k = 0; k < sdi; k++) {
    const NTV2InputSource s = ::NTV2ChannelToInputSource(NTV2Channel(k), NTV2_IOKINDS_SDI);
    if (NTV2_IS_VALID_INPUT_SOURCE(s) && dev.features().CanDoInputSource(s)) list.push_back({ "sdi" + std::to_string(k + 1), s });
  }
  for (UWord k = 0; k < hdmi; k++) {
    const NTV2InputSource s = ::NTV2ChannelToInputSource(NTV2Channel(k), NTV2_IOKINDS_HDMI);
    if (NTV2_IS_VALID_INPUT_SOURCE(s) && dev.features().CanDoInputSource(s)) list.push_back({ "hdmi" + std::to_string(k + 1), s });
  }
  return list;
}

/** Signal on an input; SDI: progressive vs PsF from the card's progressive flag. */
static NTV2VideoFormat inputFormat(CNTV2Card& dev, NTV2InputSource src) {
  const bool progressive = NTV2_INPUT_SOURCE_IS_SDI(src) && dev.GetSDIInputIsProgressive(::NTV2InputSourceToChannel(src));
  return dev.GetInputVideoFormat(src, progressive);
}

static bool is4k(NTV2VideoFormat f) { return NTV2_IS_4K_VIDEO_FORMAT(f) || NTV2_IS_QUAD_QUAD_FORMAT(f); }

// ---------------------------------------------------------------- --list

static int listDevices() {
  std::string out = "{\"ok\":true,\"sdk\":\"" + jsonEscape(::NTV2GetVersionString(false)) + "\",\"devices\":[";
  CNTV2Card dev;
  ULWord index = 0;
  for (; CNTV2DeviceScanner::GetDeviceAtIndex(index, dev); index++) {
    std::string serial;
    dev.GetSerialNumberString(serial);
    ULWord app = 0; int32_t pid = 0;
    dev.GetStreamingApplication(app, pid);
    const bool busy = pid != 0 && AJAProcess::IsValid(uint64_t(pid)) && app != APP_SIGNATURE;
    std::string inputs = "[", signals = "{";
    for (const Input& in : deviceInputs(dev)) {
      if (inputs.size() > 1) { inputs += ","; }
      inputs += "\"" + in.name + "\"";
      const NTV2VideoFormat f = inputFormat(dev, in.source);
      if (f != NTV2_FORMAT_UNKNOWN) { if (signals.size() > 1) signals += ","; signals += "\"" + in.name + "\":\"" + jsonEscape(::NTV2VideoFormatToString(f)) + "\""; }
    }
    inputs += "]"; signals += "}";
    if (index) out += ",";
    out += "{\"index\":" + std::to_string(index) + ",\"name\":\"" + jsonEscape(dev.GetDisplayName()) + "\""
      + (serial.empty() ? "" : ",\"serial\":\"" + jsonEscape(serial) + "\"")
      + ",\"capture\":" + (dev.features().CanDoCapture() ? "true" : "false")
      + ",\"ready\":" + (dev.IsDeviceReady() ? "true" : "false")
      + ",\"busy\":" + (busy ? "true" : "false")
      + ",\"anc\":" + (dev.features().CanDoCustomAnc() ? "true" : "false")
      + ",\"audioChannels\":" + std::to_string(dev.features().GetMaxAudioChannels())
      + ",\"inputs\":" + inputs + ",\"signals\":" + signals + "}";
    dev.Close();
  }
  out += "]}";
  printf("%s\n", out.c_str());
  return 0;
}

// ---------------------------------------------------------------- capture

struct Session {
  CNTV2Card* dev = nullptr;
  NTV2Channel ch = NTV2_CHANNEL1;
  NTV2EveryFrameTaskMode savedTasks = NTV2_DISABLE_TASKS;
  bool acquired = false, running = false;
};
static Session g_session;

static void cleanup() {
  Session& s = g_session;
  if (!s.dev) return;
  if (s.running) s.dev->AutoCirculateStop(s.ch);
  s.dev->UnsubscribeInputVerticalEvent(s.ch);
  if (s.acquired) {
    s.dev->SetTaskMode(s.savedTasks);
    s.dev->ReleaseStreamForApplication(APP_SIGNATURE, int32_t(AJAProcess::GetPid()));
  }
  s.dev = nullptr;
}

static void onSignal(int) { g_quit = true; }

static std::thread g_writer;
/** Ends the capture: AutoCirculate off, device released, queued records written. */
static void stopCapture() {
  cleanup();
  g_quit = true;
  g_qCv.notify_all();
  if (g_writer.joinable()) g_writer.join();
}
static int abortCapture(const char* code, const std::string& msg) { stopCapture(); return fatal(code, msg); }

/** Matrix/transfer/primaries of the signal: SMPTE 352 VPID on SDI, AVI/DRM InfoFrame on HDMI. */
struct Colour { std::string matrix, transfer = "unknown", primaries = "unknown"; };
static Colour signalColour(CNTV2Card& dev, NTV2InputSource src, NTV2VideoFormat fmt) {
  Colour c;
  const bool sd = NTV2_IS_SD_VIDEO_FORMAT(fmt);
  c.matrix = sd ? "smpte170m" : "bt709";
  const NTV2Channel ch = ::NTV2InputSourceToChannel(src);
  if (NTV2_INPUT_SOURCE_IS_SDI(src)) {
    NTV2VPIDColorimetry col; NTV2VPIDTransferCharacteristics tc;
    if (dev.GetVPIDValidA(ch) && dev.GetVPIDColorimetry(col, ch)) {
      if (col == NTV2_VPID_Color_UHDTV) { c.matrix = "bt2020nc"; c.primaries = "bt2020"; }
      else if (col == NTV2_VPID_Color_Rec709 && !sd) c.primaries = "bt709";
    }
    if (dev.GetVPIDValidA(ch) && dev.GetVPIDTransferCharacteristics(tc, ch))
      c.transfer = tc == NTV2_VPID_TC_PQ ? "smpte2084" : tc == NTV2_VPID_TC_HLG ? "arib-std-b67" : tc == NTV2_VPID_TC_SDR_TV ? (sd ? "smpte170m" : "bt709") : "unknown";
  } else if (NTV2_INPUT_SOURCE_IS_HDMI(src)) {
    NTV2HDMIColorimetry col;
    if (dev.GetHDMIInColorimetry(col, ch)) {
      if (col == NTV2_HDMIColorimetry2020 || col == NTV2_HDMIColorimetry2020CL) { c.matrix = col == NTV2_HDMIColorimetry2020CL ? "bt2020c" : "bt2020nc"; c.primaries = "bt2020"; }
      else if (col == NTV2_HDMIColorimetry709) { c.matrix = "bt709"; c.primaries = "bt709"; }
      else if (col == NTV2_HDMIColorimetry601) c.matrix = "smpte170m";
    }
    HDRRegValues hdr;
    // CEA-861.3 EOTF: 0 SDR, 2 PQ, 3 HLG – as with lz-decklink
    if (dev.GetHDMIInDynamicRange(hdr, ch))
      c.transfer = hdr.electroOpticalTransferFunction == 2 ? "smpte2084" : hdr.electroOpticalTransferFunction == 3 ? "arib-std-b67" : "unknown";
  }
  return c;
}

/** p ↔ PsF of the same geometry and rate: the same picture on the wire – no restart (cf. lz-decklink). */
static bool samePicture(NTV2VideoFormat a, NTV2VideoFormat b) {
  if (a == b) return true;
  if (a == NTV2_FORMAT_UNKNOWN || b == NTV2_FORMAT_UNKNOWN) return false;
  const NTV2FormatDescriptor da(a, NTV2_FBF_10BIT_YCBCR), db(b, NTV2_FBF_10BIT_YCBCR);
  return da.GetRasterWidth() == db.GetRasterWidth() && da.GetRasterHeight() == db.GetRasterHeight()
    && ::GetNTV2FrameRateFromVideoFormat(a) == ::GetNTV2FrameRateFromVideoFormat(b)
    && (IsProgressivePicture(a) || NTV2_IS_PSF_VIDEO_FORMAT(a)) && (IsProgressivePicture(b) || NTV2_IS_PSF_VIDEO_FORMAT(b));
}

/** VANC (#160): every packet as JSON like lz-decklink, at most 4/s or when the set of packets changes. */
static void sendVanc(const NTV2Buffer& f1, const NTV2Buffer& f2, std::string& lastSig, std::chrono::steady_clock::time_point& last) {
  AJAAncillaryList pkts;
  if (AJA_FAILURE(AJAAncillaryList::SetFromDeviceAncBuffers(f1, f2, pkts))) return;
  std::string list, sig;
  const uint32_t n = pkts.CountAncillaryData();
  for (uint32_t i = 0; i < n && i < 64; i++) {
    AJAAncillaryData* p = pkts.GetAncillaryDataAtIndex(i);
    if (!p) continue;
    std::string hex;
    const uint8_t* d = p->GetPayloadData();
    char x[3];
    for (uint32_t k = 0; d && k < p->GetDC() && k < 255; k++) { snprintf(x, sizeof x, "%02x", d[k]); hex += x; }
    char head[112];
    // data stream: AJA counts DS1 = 0 as DeckLink does; Y/C channel (HD) is the anc channel
    snprintf(head, sizeof head, "{\"did\":%u,\"sdid\":%u,\"line\":%u,\"stream\":%u,\"data\":\"",
      (unsigned)p->GetDID(), (unsigned)p->GetSID(), (unsigned)p->GetLocationLineNumber(), (unsigned)p->GetLocationDataStream());
    list += (list.empty() ? "" : ",") + std::string(head) + hex + "\"}";
    sig += std::to_string(p->GetDID()) + "/" + std::to_string(p->GetSID()) + "/" + std::to_string(p->GetLocationLineNumber()) + ";";
  }
  const auto now = std::chrono::steady_clock::now();
  if (sig == lastSig && now - last < std::chrono::milliseconds(250)) return;
  lastSig = sig; last = now;
  writeText("VANC", "{\"packets\":[" + list + "]}");
}

static int capture(ULWord index, bool tenBit, const std::string& inputName, int wantAudio) {
  static CNTV2Card dev;
  if (!CNTV2DeviceScanner::GetDeviceAtIndex(0, dev)) return fatal("aja.noDevices", "No AJA devices found (AJA driver installed? Device connected?)");
  if (!CNTV2DeviceScanner::GetDeviceAtIndex(index, dev)) return fatal("aja.noDevice", "AJA device " + std::to_string(index) + " not present", "{\"index\":" + std::to_string(index) + "}");
  if (!dev.IsDeviceReady()) return fatal("aja.notReady", "AJA device not ready (firmware loading?)");
  if (!dev.features().CanDoCapture()) return fatal("aja.noInput", "Device cannot capture");
  const std::vector<Input> inputs = deviceInputs(dev);
  if (inputs.empty()) return fatal("aja.noInput", "Device cannot capture");
  const Input* in = &inputs[0];
  if (!inputName.empty()) {
    in = nullptr;
    for (const Input& i : inputs) if (i.name == inputName) in = &i;
    if (!in) return fatal("aja.inputConnector", "Input " + inputName + " not available on this device", "{\"input\":\"" + jsonEscape(inputName) + "\"}");
  }
  const NTV2InputSource src = in->source;
  const NTV2Channel ch = ::NTV2InputSourceToChannel(src);
  const NTV2PixelFormat fbf = tenBit ? NTV2_FBF_10BIT_YCBCR : NTV2_FBF_8BIT_YCBCR;
  if (!dev.features().CanDoFrameBufferFormat(fbf)) return fatal("aja.pixel", "Device cannot capture this pixel format");

  // exclusive use, as AJA's own capture demos do; a stale owner (process gone) is taken over by the SDK
  ULWord app = 0; int32_t pid = 0;
  dev.GetStreamingApplication(app, pid);
  if (!dev.AcquireStreamForApplication(APP_SIGNATURE, int32_t(AJAProcess::GetPid())))
    return fatal("aja.busy", "AJA device in use by another application (pid " + std::to_string(pid) + ")", "{\"pid\":" + std::to_string(pid) + "}");
  g_session.dev = &dev; g_session.ch = ch; g_session.acquired = true;
  dev.GetTaskMode(g_session.savedTasks);
  dev.SetTaskMode(NTV2_OEM_TASKS); // keep AJA's retail services from re-routing under us
  std::atexit(cleanup);
  if (dev.features().CanDoMultiFormat()) dev.SetMultiFormatMode(false);

  dev.EnableChannel(ch);
  dev.EnableInputInterrupt(ch);
  dev.SubscribeInputVerticalEvent(ch);
  if (dev.features().HasBiDirectionalSDI() && NTV2_INPUT_SOURCE_IS_SDI(src)) {
    dev.SetSDITransmitEnable(ch, false); // bidirectional connector to receive
    std::this_thread::sleep_for(std::chrono::milliseconds(250)); // receiver lock (AJA's demos wait 10 VBIs)
  }

  // embedded sound: audio system of this channel when the card has one per channel
  NTV2AudioSystem audSys = NTV2_AUDIOSYSTEM_INVALID;
  int channels = 0;
  if (wantAudio > 0) {
    audSys = UWord(ch) < dev.features().GetNumAudioSystems() ? ::NTV2ChannelToAudioSystem(ch) : NTV2_AUDIOSYSTEM_1;
    const UWord maxCh = dev.features().GetMaxAudioChannels();
    for (int c : { 16, 8, 6, 2 }) if (!channels && c <= wantAudio && c <= maxCh) channels = c;
    bool ok = channels > 0
      && dev.SetAudioSystemInputSource(audSys, ::NTV2InputSourceToAudioSource(src), ::NTV2InputSourceToEmbeddedAudioInput(src))
      && dev.SetNumberAudioChannels(ULWord(channels), audSys)
      && dev.SetAudioRate(NTV2_AUDIO_48K, audSys)
      && dev.SetAudioBufferSize(NTV2_AUDIO_BUFFER_SIZE_4MB, audSys)
      && dev.SetAudioLoopBack(NTV2_AUDIO_LOOPBACK_OFF, audSys);
    if (!ok) { writeText("STAT", "{\"code\":\"aja.noAudio\",\"message\":\"Sound input cannot be opened - picture only\"}"); audSys = NTV2_AUDIOSYSTEM_INVALID; channels = 0; }
  }

  std::signal(SIGINT, onSignal);
  std::signal(SIGTERM, onSignal);
#ifdef SIGPIPE
  std::signal(SIGPIPE, SIG_IGN); // a closed pipe ends the loop through rawWrite
#endif
  g_async = true;
  g_writer = std::thread(writerLoop);

  // anc extraction (SDI, cards with custom anc firmware): buffer sizes from the driver's anc offsets
  const bool withAnc = NTV2_INPUT_SOURCE_IS_SDI(src) && dev.features().CanDoCustomAnc();
  ULWord ancF1 = 0, ancF2 = 0;
  if (withAnc) {
    ULWord o1 = 0, o2 = 0;
    dev.ReadRegister(kVRegAncField1Offset, o1);
    dev.ReadRegister(kVRegAncField2Offset, o2);
    ancF1 = o2 > o1 ? 0 : o1 - o2;
    ancF2 = o2 > o1 ? o2 - o1 : o2;
  }
  NTV2Buffer anc1(ancF1), anc2(ancF2), audio(audSys != NTV2_AUDIOSYSTEM_INVALID ? AUDIO_BYTES_MAX : 0);
  std::vector<uint8_t> abuf;
  int64_t audioNext = -1; // running sample index on the card's 48 kHz audio clock
  std::string lastVancSig = "-";
  auto lastNoSignal = std::chrono::steady_clock::time_point{}, lastVanc = lastNoSignal, last4k = lastNoSignal;
  auto lastStat = std::chrono::steady_clock::now();
  ULWord lastDropped = 0;

  while (!g_quit) {
    // ---- wait for a usable signal
    NTV2VideoFormat fmt = inputFormat(dev, src);
    const auto now = std::chrono::steady_clock::now();
    if (fmt == NTV2_FORMAT_UNKNOWN || !dev.features().CanDoVideoFormat(fmt)) {
      if (now - lastNoSignal > std::chrono::seconds(1)) {
        writeText("STAT", fmt == NTV2_FORMAT_UNKNOWN ? "{\"code\":\"aja.noSignal\",\"message\":\"no input signal\"}"
          : "{\"code\":\"aja.format\",\"message\":\"Device cannot capture this format\",\"params\":{\"format\":\"" + jsonEscape(::NTV2VideoFormatToString(fmt)) + "\"}}");
        lastNoSignal = now;
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(100));
      continue;
    }
    if (is4k(fmt)) {
      if (now - last4k > std::chrono::seconds(1)) { writeText("STAT", "{\"code\":\"aja.format4k\",\"message\":\"4K/UHD inputs are not supported yet\",\"params\":{\"format\":\"" + jsonEscape(::NTV2VideoFormatToString(fmt)) + "\"}}"); last4k = now; }
      std::this_thread::sleep_for(std::chrono::milliseconds(200));
      continue;
    }

    // ---- configure channel and route for this format
    dev.SetVideoFormat(fmt, false, false, ch);
    dev.SetVANCMode(NTV2_VANCMODE_OFF, ch);
    dev.SetFrameBufferFormat(ch, fbf);
    NTV2LHIHDMIColorSpace cs = NTV2_LHIHDMIColorSpaceYCbCr;
    if (NTV2_INPUT_SOURCE_IS_HDMI(src)) dev.GetHDMIInputColor(cs, ch);
    const bool rgbIn = cs == NTV2_LHIHDMIColorSpaceRGB;
    NTV2XptConnections route;
    const NTV2InputXptID fbIn = ::GetFrameStoreInputXptFromChannel(ch);
    const NTV2OutputXptID srcOut = ::GetInputSourceOutputXpt(src, false, rgbIn);
    if (rgbIn) { // RGB → card's CSC → Y′CbCr frame store
      route.insert(NTV2Connection(fbIn, ::GetCSCOutputXptFromChannel(ch, false, false)));
      route.insert(NTV2Connection(::GetCSCInputXptFromChannel(ch), srcOut));
    } else route.insert(NTV2Connection(fbIn, srcOut));
    // without inReplace: only these crosspoints change, the rest of the card's routing stays
    if (!dev.ApplySignalRoute(route, false)) return abortCapture("aja.route", "Signal routing on the card failed");

    const NTV2FormatDescriptor desc(fmt, fbf);
    const ULWord w = desc.GetRasterWidth(), h = desc.GetVisibleRasterHeight(), pitch = desc.GetBytesPerRow();
    const ULWord tight = tenBit ? ((w + 47) / 48) * 128 : w * 2;
    NTV2Buffer video(desc.GetVideoWriteSize());
    ULWord rateNum = 25, rateDen = 1;
    ::GetFramesPerSecond(::GetNTV2FrameRateFromVideoFormat(fmt), rateNum, rateDen);
    const bool interlaced = !IsProgressivePicture(fmt) && !NTV2_IS_PSF_VIDEO_FORMAT(fmt);
    const Colour col = signalColour(dev, src, fmt);
    std::string info = "{\"width\":" + std::to_string(w) + ",\"height\":" + std::to_string(h)
      + ",\"fpsNum\":" + std::to_string(rateNum) + ",\"fpsDen\":" + std::to_string(rateDen)
      + ",\"pixel\":\"" + (tenBit ? "v210" : "uyvy422") + "\",\"matrix\":\"" + col.matrix + "\",\"range\":\"tv\""
      + ",\"transfer\":\"" + col.transfer + "\",\"primaries\":\"" + col.primaries + "\",\"interlaced\":" + (interlaced ? "true" : "false")
      + ",\"name\":\"" + jsonEscape(::NTV2VideoFormatToString(fmt)) + "\",\"input\":\"" + in->name + "\""
      + (channels ? ",\"audio\":{\"sampleRate\":48000,\"channels\":" + std::to_string(channels) + ",\"format\":\"s32le\"}" : "");
    bool infoSent = false;

    dev.AutoCirculateStop(ch);
    ULWord options = AUTOCIRCULATE_WITH_RP188 | (withAnc ? AUTOCIRCULATE_WITH_ANC : 0);
    if (!dev.AutoCirculateInitForInput(ch, 7, audSys, options) || !dev.AutoCirculateStart(ch)) {
      return abortCapture("aja.startFailed", "Capture cannot be started (device in use?)");
    }
    g_session.running = true;
    audioNext = -1;
    int frames = 0;
    AUTOCIRCULATE_TRANSFER xfer;

    // ---- frame loop until the input format changes
    while (!g_quit) {
      AUTOCIRCULATE_STATUS st;
      dev.AutoCirculateGetStatus(ch, st);
      if (!(st.IsRunning() && st.HasAvailableInputFrame())) { dev.WaitForInputVerticalInterrupt(ch); }
      else {
        xfer.SetVideoBuffer(static_cast<ULWord*>(video.GetHostPointer()), ULWord(video.GetByteCount()));
        if (audio) xfer.SetAudioBuffer(static_cast<ULWord*>(audio.GetHostPointer()), ULWord(audio.GetByteCount()));
        if (withAnc && anc1) xfer.SetAncBuffers(static_cast<ULWord*>(anc1.GetHostPointer()), ULWord(anc1.GetByteCount()), static_cast<ULWord*>(anc2.GetHostPointer()), ULWord(anc2.GetByteCount()));
        if (dev.AutoCirculateTransfer(ch, xfer)) {
          const FRAME_STAMP& fs = xfer.acTransferStatus.acFrameStamp;
          const int64_t t = int64_t(fs.acAudioClockTimeStamp); // card's 48 kHz clock at this frame's VBI
          // timecode: first valid RP 188 / ATC of this input
          NTV2TimeCodes tcs;
          std::string tc;
          bool df = false;
          if (xfer.GetInputTimeCodes(tcs, ch, true) && !tcs.empty()) {
            const CRP188 r(tcs.begin()->second);
            r.GetRP188Str(tc);
            df = r.FormatIsDropFrame();
          }
          if (!infoSent) { writeText("INFO", info + (tc.empty() ? "" : ",\"timecode\":\"" + tc + "\"") + "}"); infoSent = true; }
          if (!tc.empty()) writeText("TIME", "{\"tc\":\"" + tc + "\",\"df\":" + (df ? "true" : "false") + "}");
          // sound first (never dropped): contiguous sample counter, anchored on the first frame's clock
          const ULWord abytes = audio ? xfer.GetCapturedAudioByteCount() : 0;
          if (abytes && channels) {
            if (audioNext < 0) audioNext = t;
            abuf.resize(8 + abytes);
            std::memcpy(abuf.data(), &audioNext, 8);
            std::memcpy(abuf.data() + 8, audio.GetHostPointer(), abytes);
            writeRecord("AUDI", abuf.data(), (uint32_t)abuf.size());
            audioNext += int64_t(abytes / (4 * ULWord(channels)));
          }
          if (withAnc) {
            const NTV2Buffer a1(anc1.GetHostPointer(), xfer.GetCapturedAncByteCount(false)), a2(anc2.GetHostPointer(), xfer.GetCapturedAncByteCount(true));
            sendVanc(a1, a2, lastVancSig, lastVanc);
          }
          writeRecord("FPTS", &t, 8);
          std::vector<uint8_t> pic = frameBuffer(size_t(tight) * h);
          const uint8_t* p = static_cast<const uint8_t*>(video.GetHostPointer());
          if (pitch == tight) std::memcpy(pic.data(), p, size_t(tight) * h);
          else for (ULWord y = 0; y < h; y++) std::memcpy(pic.data() + size_t(y) * tight, p + size_t(y) * pitch, tight);
          sendFrame(std::move(pic));
        }
        // format check every 10 frames (register reads, cheap); p ↔ PsF only is not a change
        if (++frames % 10 == 0) {
          const NTV2VideoFormat now = inputFormat(dev, src);
          if (!samePicture(now, fmt)) break;
        }
      }
      const auto n = std::chrono::steady_clock::now();
      if (n - lastStat >= std::chrono::seconds(1)) {
        lastStat = n;
        const uint32_t sk = g_skipped.exchange(0);
        if (sk) writeText("STAT", "{\"code\":\"aja.skipped\",\"message\":\"" + std::to_string(sk) + " pictures skipped - bridge busy\",\"params\":{\"n\":" + std::to_string(sk) + "}}");
        const ULWord dropped = st.GetDroppedFrameCount();
        if (dropped > lastDropped) writeText("STAT", "{\"code\":\"aja.dropped\",\"message\":\"" + std::to_string(dropped - lastDropped) + " pictures dropped on the card\",\"params\":{\"n\":" + std::to_string(dropped - lastDropped) + "}}");
        lastDropped = dropped;
      }
    }
    dev.AutoCirculateStop(ch);
    g_session.running = false;
    lastDropped = 0;
  }
  stopCapture();
  return 0;
}

int main(int argc, char** argv) {
#ifdef _WIN32
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  if (argc >= 2 && std::strcmp(argv[1], "--list") == 0) return listDevices();
  if (argc >= 3 && std::strcmp(argv[1], "--capture") == 0) {
    bool tenBit = true;
    std::string input;
    int audio = 0;
    for (int i = 3; i + 1 < argc; i++) {
      if (std::strcmp(argv[i], "--bits") == 0) tenBit = std::strcmp(argv[i + 1], "8") != 0;
      if (std::strcmp(argv[i], "--input") == 0) input = argv[i + 1];
      if (std::strcmp(argv[i], "--audio") == 0) audio = std::atoi(argv[i + 1]);
    }
    return capture(ULWord(std::atoi(argv[2])), tenBit, input, audio);
  }
  fprintf(stderr, "usage: lz-aja --list | --capture <index> [--bits 8|10] [--input sdi1|hdmi1|…] [--audio 0|2|8|16]\n");
  return 1;
}
