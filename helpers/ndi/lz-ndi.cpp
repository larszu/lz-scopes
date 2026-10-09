// lz-ndi – NDI(R) receive helper for the lz-scopes bridge.
//
//   lz-ndi --list [--wait <ms>]         one JSON line: {"ok":true,"version":"…","sources":[{"name":"…","url":"…"}]}
//   lz-ndi --capture <source name> [--depth 8|16] [--width N]
//                                       helper protocol on stdout (docs/frame-protocol.md)
//   lz-ndi --send-test <name> [seconds] [WxH] test sender: P216 frames, left half Y′ 940, right half 502 (10-bit scale)
//   lz-ndi --selftest                   checks the box-filter reduction, one JSON line
//
// The NDI runtime is loaded at run time (dlopen / LoadLibrary) from $NDI_RUNTIME_DIR_V6 or
// the system paths – it is installed by the user (NDI Tools or the NDI runtime from
// ndi.video) and is not part of lz-scopes.
//
// --depth 16 asks for NDIlib_recv_color_format_best (16-bit sources as P216), --depth 8 for
// _fastest (UYVY, half the data). --width N reduces the picture in the helper by a whole
// factor while it stays at least N wide (box filter in Y′CbCr, matrix and range unchanged),
// so a 1080p source crosses the pipes with a quarter of the bytes; ffmpeg scales the rest.
// One thread receives, the main thread writes: when the bridge reads slower than NDI
// delivers, only the newest picture waits and older ones are counted as skipped.
//
// NDI(R) is a registered trademark of Vizrt NDI AB. https://ndi.video/

#include "ndi-min.h"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <windows.h>
typedef HMODULE LibHandle;
static LibHandle openLib(const std::string& p) { return LoadLibraryA(p.c_str()); }
static void* sym(LibHandle h, const char* n) { return (void*)GetProcAddress(h, n); }
static const char SEP = '\\';
#else
#include <dlfcn.h>
typedef void* LibHandle;
static LibHandle openLib(const std::string& p) { return dlopen(p.c_str(), RTLD_NOW | RTLD_LOCAL); }
static void* sym(LibHandle h, const char* n) { return dlsym(h, n); }
static const char SEP = '/';
#endif

// ---------------------------------------------------------------- output

static void writeRecord(const char tag[4], const void* data, uint32_t len) {
  uint8_t head[8];
  std::memcpy(head, tag, 4);
  head[4] = len & 0xff; head[5] = (len >> 8) & 0xff; head[6] = (len >> 16) & 0xff; head[7] = (len >> 24) & 0xff;
  if (fwrite(head, 1, 8, stdout) != 8 || (len && fwrite(data, 1, len, stdout) != len)) std::exit(0); // bridge gone
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

// ---------------------------------------------------------------- runtime

struct Ndi {
  NDI_initialize_fn initialize = nullptr;
  NDI_destroy_fn destroy = nullptr;
  NDI_version_fn version = nullptr;
  NDI_find_create_v2_fn find_create_v2 = nullptr;
  NDI_find_wait_for_sources_fn find_wait_for_sources = nullptr;
  NDI_find_get_current_sources_fn find_get_current_sources = nullptr;
  NDI_find_destroy_fn find_destroy = nullptr;
  NDI_recv_create_v3_fn recv_create_v3 = nullptr;
  NDI_recv_capture_v3_fn recv_capture_v3 = nullptr;
  NDI_recv_free_video_v2_fn recv_free_video_v2 = nullptr;
  NDI_recv_destroy_fn recv_destroy = nullptr;
  NDI_recv_get_performance_fn recv_get_performance = nullptr;   // optional (counters)
  NDI_recv_get_queue_fn recv_get_queue = nullptr;
  NDI_recv_get_no_connections_fn recv_get_no_connections = nullptr;
  NDI_send_create_fn send_create = nullptr;
  NDI_send_send_video_v2_fn send_send_video_v2 = nullptr;
  NDI_send_destroy_fn send_destroy = nullptr;
  std::string path;
};

/** Loads the runtime; empty error string on success. */
static std::string loadNdi(Ndi& n) {
  std::vector<std::string> tries;
  if (const char* dir = std::getenv(LZ_NDI_REDIST_FOLDER)) tries.push_back(std::string(dir) + SEP + LZ_NDI_LIBRARY);
  tries.push_back(LZ_NDI_LIBRARY);
#if defined(__APPLE__)
  tries.push_back("/usr/local/lib/libndi.dylib");
  tries.push_back("/Library/NDI SDK for Apple/lib/macOS/libndi.dylib");
#elif !defined(_WIN32)
  tries.push_back("/usr/lib/libndi.so.6");
  tries.push_back("/usr/local/lib/libndi.so.6");
  tries.push_back("/usr/lib/x86_64-linux-gnu/libndi.so.6");
#endif
  LibHandle h = nullptr;
  for (const auto& p : tries) { h = openLib(p); if (h) { n.path = p; break; } }
  if (!h) return "NDI runtime not found – install the NDI runtime (ndi.link/NDIRedistV6) or NDI Tools, then restart LZ Scopes";
#define LOAD(field, name) n.field = (decltype(n.field))sym(h, name); if (!n.field) return std::string("NDI runtime incomplete: ") + name;
  LOAD(initialize, "NDIlib_initialize")
  LOAD(destroy, "NDIlib_destroy")
  LOAD(version, "NDIlib_version")
  LOAD(find_create_v2, "NDIlib_find_create_v2")
  LOAD(find_wait_for_sources, "NDIlib_find_wait_for_sources")
  LOAD(find_get_current_sources, "NDIlib_find_get_current_sources")
  LOAD(find_destroy, "NDIlib_find_destroy")
  LOAD(recv_create_v3, "NDIlib_recv_create_v3")
  LOAD(recv_capture_v3, "NDIlib_recv_capture_v3")
  LOAD(recv_free_video_v2, "NDIlib_recv_free_video_v2")
  LOAD(recv_destroy, "NDIlib_recv_destroy")
  LOAD(send_create, "NDIlib_send_create")
  LOAD(send_send_video_v2, "NDIlib_send_send_video_v2")
  LOAD(send_destroy, "NDIlib_send_destroy")
#undef LOAD
  n.recv_get_performance = (NDI_recv_get_performance_fn)sym(h, "NDIlib_recv_get_performance");
  n.recv_get_queue = (NDI_recv_get_queue_fn)sym(h, "NDIlib_recv_get_queue");
  n.recv_get_no_connections = (NDI_recv_get_no_connections_fn)sym(h, "NDIlib_recv_get_no_connections");
  if (!n.initialize()) return "NDI cannot be initialised on this computer (CPU without SSE4.2?)";
  return "";
}

/** Code of a loadNdi() error for the UI (server/messages.mjs). */
static const char* ndiErrCode(const std::string& err) {
  if (err.rfind("NDI runtime not found", 0) == 0) return "ndi.noRuntime";
  if (err.rfind("NDI runtime incomplete", 0) == 0) return "ndi.runtimeIncomplete";
  return "ndi.initFailed";
}

// ---------------------------------------------------------------- --list

static int listSources(int waitMs) {
  Ndi n;
  std::string err = loadNdi(n);
  if (!err.empty()) { printf("{\"ok\":false,\"runtime\":false,\"code\":\"%s\",\"error\":\"%s\"}\n", ndiErrCode(err), jsonEscape(err).c_str()); return 0; }
  NDI_find_create fc = { true, nullptr, nullptr };
  NDI_find_instance f = n.find_create_v2(&fc);
  if (!f) { printf("{\"ok\":false,\"runtime\":true,\"code\":\"ndi.findFailed\",\"error\":\"NDI search cannot be started\"}\n"); return 0; }
  // sources announce themselves over mDNS; give them a moment
  auto until = std::chrono::steady_clock::now() + std::chrono::milliseconds(waitMs);
  while (std::chrono::steady_clock::now() < until) n.find_wait_for_sources(f, 250);
  uint32_t count = 0;
  const NDI_source* src = n.find_get_current_sources(f, &count);
  std::string out = std::string("{\"ok\":true,\"runtime\":true,\"version\":\"") + jsonEscape(n.version ? n.version() : "") + "\",\"sources\":[";
  for (uint32_t i = 0; i < count; i++) {
    if (i) out += ",";
    out += "{\"name\":\"" + jsonEscape(src[i].p_ndi_name ? src[i].p_ndi_name : "") + "\",\"url\":\"" + jsonEscape(src[i].p_url_address ? src[i].p_url_address : "") + "\"}";
  }
  out += "]}";
  printf("%s\n", out.c_str());
  n.find_destroy(f);
  n.destroy();
  return 0;
}

// ---------------------------------------------------------------- capture

/** Copies the picture into tight rows; returns the helper-protocol pixel name or nullptr. */
static const char* repack(const NDI_video_frame_v2& v, std::vector<uint8_t>& out) {
  const int w = v.xres, h = v.yres, s = v.line_stride_in_bytes;
  auto rows = [&](const uint8_t* src, int stride, int rowBytes, int count) {
    for (int y = 0; y < count; y++) out.insert(out.end(), src + (size_t)y * stride, src + (size_t)y * stride + rowBytes);
  };
  out.clear();
  switch (v.FourCC) {
    case LZ_NDI_FOURCC('U', 'Y', 'V', 'Y'):
    case LZ_NDI_FOURCC('U', 'Y', 'V', 'A'): // alpha plane follows, ignored
      rows(v.p_data, s, w * 2, h); return "uyvy422";
    case LZ_NDI_FOURCC('P', '2', '1', '6'):
    case LZ_NDI_FOURCC('P', 'A', '1', '6'): // Y plane, then interleaved CbCr (4:2:2, 16 bit); alpha ignored
      rows(v.p_data, s, w * 2, h); rows(v.p_data + (size_t)s * h, s, w * 2, h); return "p216le";
    case LZ_NDI_FOURCC('B', 'G', 'R', 'A'): rows(v.p_data, s, w * 4, h); return "bgra";
    case LZ_NDI_FOURCC('B', 'G', 'R', 'X'): rows(v.p_data, s, w * 4, h); return "bgr0";
    case LZ_NDI_FOURCC('R', 'G', 'B', 'A'): rows(v.p_data, s, w * 4, h); return "rgba";
    case LZ_NDI_FOURCC('R', 'G', 'B', 'X'): rows(v.p_data, s, w * 4, h); return "rgb0";
    case LZ_NDI_FOURCC('N', 'V', '1', '2'):
      rows(v.p_data, s, w, h); rows(v.p_data + (size_t)s * h, s, w, h / 2); return "nv12";
    case LZ_NDI_FOURCC('I', '4', '2', '0'):
    case LZ_NDI_FOURCC('Y', 'V', '1', '2'): {
      const uint8_t* y = v.p_data;
      const uint8_t* p1 = y + (size_t)s * h;
      const uint8_t* p2 = p1 + (size_t)(s / 2) * (h / 2);
      const bool yv12 = v.FourCC == LZ_NDI_FOURCC('Y', 'V', '1', '2'); // Y, Cr, Cb
      rows(y, s, w, h); rows(yv12 ? p2 : p1, s / 2, w / 2, h / 2); rows(yv12 ? p1 : p2, s / 2, w / 2, h / 2);
      return "yuv420p";
    }
    default: return nullptr;
  }
}

// ---------------------------------------------------------------- reduction

/**
 * Box filter by the whole factor k (k ≥ 2) for 4:2:2 layouts: every output luma is the mean of
 * k×k input lumas, every output Cb/Cr the mean of the k×k chroma samples it covers. `T` is the
 * sample type (uint8 for UYVY, uint16 for P216). Output width is even, rows beyond h/k·k drop.
 */
template <typename T>
static void reduceUyvy(const T* in, int w, int h, int k, std::vector<uint8_t>& outBytes, int& ow, int& oh) {
  ow = (w / k) & ~1; oh = h / k;
  outBytes.resize((size_t)ow * oh * 2 * sizeof(T));
  T* out = reinterpret_cast<T*>(outBytes.data());
  const uint32_t n = (uint32_t)k * k;
  for (int oy = 0; oy < oh; oy++) {
    for (int op = 0; op < ow / 2; op++) {              // output pixel pair: Cb Y0 Cr Y1
      uint32_t cb = 0, cr = 0, y0 = 0, y1 = 0;
      for (int dy = 0; dy < k; dy++) {
        const T* row = in + (size_t)(oy * k + dy) * w * 2;
        for (int j = 0; j < k; j++) {                     // input pairs op·k … op·k+k−1
          const T* q = row + (size_t)(op * k + j) * 4;
          cb += q[0]; cr += q[2];
        }
        for (int j = 0; j < k; j++) { y0 += row[(size_t)(2 * op * k + j) * 2 + 1]; y1 += row[(size_t)((2 * op + 1) * k + j) * 2 + 1]; }
      }
      T* o = out + (size_t)oy * ow * 2 + (size_t)op * 4;
      o[0] = (T)((cb + n / 2) / n); o[1] = (T)((y0 + n / 2) / n); o[2] = (T)((cr + n / 2) / n); o[3] = (T)((y1 + n / 2) / n);
    }
  }
}

/** P216: Y plane (w×h uint16) then CbCr interleaved (w×h uint16); same filter as above. */
static void reduceP216(const uint16_t* in, int w, int h, int k, std::vector<uint8_t>& outBytes, int& ow, int& oh) {
  ow = (w / k) & ~1; oh = h / k;
  outBytes.resize((size_t)ow * oh * 4);
  uint16_t* oY = reinterpret_cast<uint16_t*>(outBytes.data());
  uint16_t* oC = oY + (size_t)ow * oh;
  const uint16_t* iC = in + (size_t)w * h;
  const uint32_t n = (uint32_t)k * k;
  for (int oy = 0; oy < oh; oy++) {
    for (int ox = 0; ox < ow; ox++) {
      uint32_t y = 0;
      for (int dy = 0; dy < k; dy++) for (int dx = 0; dx < k; dx++) y += in[(size_t)(oy * k + dy) * w + ox * k + dx];
      oY[(size_t)oy * ow + ox] = (uint16_t)((y + n / 2) / n);
    }
    for (int op = 0; op < ow / 2; op++) {
      uint32_t cb = 0, cr = 0;
      for (int dy = 0; dy < k; dy++) for (int j = 0; j < k; j++) {
        const uint16_t* q = iC + (size_t)(oy * k + dy) * w + (size_t)(op * k + j) * 2;
        cb += q[0]; cr += q[1];
      }
      oC[(size_t)oy * ow + op * 2] = (uint16_t)((cb + n / 2) / n);
      oC[(size_t)oy * ow + op * 2 + 1] = (uint16_t)((cr + n / 2) / n);
    }
  }
}

/** Whole reduction factor so the result stays ≥ maxWidth; 1 = keep. */
static int reduceFactor(int w, int maxWidth) { return maxWidth > 0 && w >= 2 * maxWidth ? w / maxWidth : 1; }

/** Reduces a repacked picture in place when the layout allows it; returns the new size. */
static void reduce(const char* pixel, std::vector<uint8_t>& buf, std::vector<uint8_t>& tmp, int& w, int& h, int maxWidth) {
  const int k = reduceFactor(w, maxWidth);
  if (k < 2) return;
  int ow = 0, oh = 0;
  if (std::strcmp(pixel, "uyvy422") == 0) reduceUyvy<uint8_t>(buf.data(), w, h, k, tmp, ow, oh);
  else if (std::strcmp(pixel, "p216le") == 0) reduceP216(reinterpret_cast<const uint16_t*>(buf.data()), w, h, k, tmp, ow, oh);
  else return;   // RGB and 4:2:0 layouts are rare on NDI; ffmpeg scales them
  buf.swap(tmp); w = ow; h = oh;
}

// ---------------------------------------------------------------- capture

/** One picture handed from the receive thread to the writer (newest wins). */
struct Picture {
  std::vector<uint8_t> data;
  const char* pixel = nullptr;
  int w = 0, h = 0, fpsN = 0, fpsD = 1;
  bool interlaced = false;
};

struct Shared {
  std::mutex m;
  std::condition_variable cv;
  Picture slot;
  bool has = false;
  std::string stat, err;           // records for the writer (JSON); err ends the helper
  int64_t skipped = 0;             // pictures replaced before the writer took them
  bool lastWasVideo = false;
};

static void receiveLoop(Ndi& n, NDI_recv_instance r, Shared& sh, std::atomic<bool>& stop) {
  Picture next;
  auto lastFrame = std::chrono::steady_clock::now();
  while (!stop) {
    NDI_video_frame_v2 v;
    std::memset(&v, 0, sizeof v);
    const int32_t t = n.recv_capture_v3(r, &v, nullptr, nullptr, 100);
    if (t == NDI_frame_type_error) {
      std::lock_guard<std::mutex> l(sh.m);
      sh.err = "{\"code\":\"ndi.lost\",\"message\":\"Connection to the NDI source lost\"}";
      sh.cv.notify_one();
      return;
    }
    if (t != NDI_frame_type_video) {
      if (std::chrono::steady_clock::now() - lastFrame > std::chrono::seconds(2)) {
        std::lock_guard<std::mutex> l(sh.m);
        sh.stat = "{\"code\":\"ndi.waiting\",\"message\":\"waiting for a picture from the NDI source\"}";
        sh.cv.notify_one();
        lastFrame = std::chrono::steady_clock::now();
      }
      continue;
    }
    lastFrame = std::chrono::steady_clock::now();
    // copy out and free at once: NDI's own queue is short
    next.pixel = repack(v, next.data);
    next.w = v.xres; next.h = v.yres; next.fpsN = v.frame_rate_N; next.fpsD = v.frame_rate_D;
    next.interlaced = v.frame_format_type != NDI_frame_format_progressive;
    const uint32_t fourcc = v.FourCC;
    n.recv_free_video_v2(r, &v);
    std::lock_guard<std::mutex> l(sh.m);
    if (!next.pixel) {
      char cc[5] = { (char)(fourcc & 0xff), (char)((fourcc >> 8) & 0xff), (char)((fourcc >> 16) & 0xff), (char)(fourcc >> 24), 0 };
      sh.stat = std::string("{\"code\":\"ndi.format\",\"message\":\"NDI format ") + jsonEscape(cc) + " not supported\",\"params\":{\"fourcc\":\"" + jsonEscape(cc) + "\"}}";
      sh.cv.notify_one();
      continue;
    }
    if (sh.has) sh.skipped++;
    std::swap(sh.slot, next);       // the old slot's buffer is reused for the next picture
    sh.has = true;
    sh.cv.notify_one();
  }
}

static int capture(const std::string& name, int depth, int maxWidth) {
  Ndi n;
  std::string err = loadNdi(n);
  if (!err.empty()) { writeText("ERR ", "{\"code\":\"" + std::string(ndiErrCode(err)) + "\",\"message\":\"" + jsonEscape(err) + "\"}"); return 2; }
  NDI_find_create fc = { true, nullptr, nullptr };
  NDI_find_instance f = n.find_create_v2(&fc);
  NDI_source found = { nullptr, nullptr };
  std::string foundName, foundUrl;
  for (int i = 0; i < 40 && foundName.empty(); i++) {   // up to 10 s
    n.find_wait_for_sources(f, 250);
    uint32_t count = 0;
    const NDI_source* src = n.find_get_current_sources(f, &count);
    for (uint32_t k = 0; k < count; k++) if (src[k].p_ndi_name && name == src[k].p_ndi_name) {
      foundName = src[k].p_ndi_name; foundUrl = src[k].p_url_address ? src[k].p_url_address : "";
    }
    if (i == 4 && foundName.empty()) writeText("STAT", "{\"code\":\"ndi.searching\",\"message\":\"searching for the NDI source …\"}");
  }
  if (foundName.empty()) { const std::string en = jsonEscape(name); writeText("ERR ", "{\"code\":\"ndi.notFound\",\"message\":\"NDI source \\\"" + en + "\\\" not found\",\"params\":{\"name\":\"" + en + "\"}}"); return 2; }
  found.p_ndi_name = foundName.c_str();
  found.p_url_address = foundUrl.empty() ? nullptr : foundUrl.c_str();
  const int32_t colour = depth == 8 ? NDI_recv_color_format_fastest : NDI_recv_color_format_best;
  NDI_recv_create_v3 rc = { found, colour, NDI_recv_bandwidth_highest, false, "LZ Scopes" };
  NDI_recv_instance r = n.recv_create_v3(&rc);
  n.find_destroy(f);
  if (!r) { writeText("ERR ", "{\"code\":\"ndi.recvFailed\",\"message\":\"NDI receiver cannot be created\"}"); return 2; }

  Shared sh;
  std::atomic<bool> stop(false);
  std::thread rx(receiveLoop, std::ref(n), r, std::ref(sh), std::ref(stop));
  std::string lastInfo;
  Picture pic;
  std::vector<uint8_t> tmp;
  int64_t sent = 0, lastSent = 0, lastSkipped = 0, lastTotal = 0, lastDropped = 0;
  auto lastStats = std::chrono::steady_clock::now();
  int rc2 = 0;
  for (;;) {
    std::string stat, fatal;
    bool got = false;
    {
      std::unique_lock<std::mutex> l(sh.m);
      sh.cv.wait_for(l, std::chrono::milliseconds(250), [&] { return sh.has || !sh.stat.empty() || !sh.err.empty(); });
      if (sh.has) { std::swap(pic, sh.slot); sh.has = false; got = true; }
      stat.swap(sh.stat); fatal.swap(sh.err);
    }
    if (!stat.empty()) writeText("STAT", stat);
    if (!fatal.empty()) { writeText("ERR ", fatal); rc2 = 3; break; }
    if (got) {
      int w = pic.w, h = pic.h;
      reduce(pic.pixel, pic.data, tmp, w, h, maxWidth);
      // NDI signals no colour metadata here; the bridge applies BT.709 above SD, BT.601 for SD.
      // Fields may arrive individually (field_0/1); each is then measured as its own picture.
      std::string info = "{\"width\":" + std::to_string(w) + ",\"height\":" + std::to_string(h)
        + ",\"sourceWidth\":" + std::to_string(pic.w) + ",\"sourceHeight\":" + std::to_string(pic.h)
        + ",\"fpsNum\":" + std::to_string(pic.fpsN) + ",\"fpsDen\":" + std::to_string(pic.fpsD)
        + ",\"pixel\":\"" + pic.pixel + "\",\"range\":\"" + (pic.pixel[0] == 'b' || pic.pixel[0] == 'r' ? "pc" : "tv") + "\",\"interlaced\":" + (pic.interlaced ? "true" : "false")
        + ",\"name\":\"" + jsonEscape(foundName) + "\"}";
      if (info != lastInfo) { writeText("INFO", info); lastInfo = info; }
      writeRecord("FRAM", pic.data.data(), (uint32_t)pic.data.size());
      sent++;
    }
    // counters about once a second: NDI's own total/dropped, its queue, connections, our skips
    const auto now = std::chrono::steady_clock::now();
    if (now - lastStats >= std::chrono::seconds(1)) {
      const double secs = std::chrono::duration<double>(now - lastStats).count();
      lastStats = now;
      NDI_recv_performance total = { 0, 0, 0 }, dropped = { 0, 0, 0 };
      NDI_recv_queue queue = { 0, 0, 0 };
      if (n.recv_get_performance) n.recv_get_performance(r, &total, &dropped);
      if (n.recv_get_queue) n.recv_get_queue(r, &queue);
      const int conns = n.recv_get_no_connections ? n.recv_get_no_connections(r) : -1;
      int64_t skipped;
      { std::lock_guard<std::mutex> l(sh.m); skipped = sh.skipped; }
      char b[400];
      snprintf(b, sizeof b, "{\"code\":\"ndi.stats\",\"message\":\"NDI counters\",\"params\":{\"fps\":%.1f,\"received\":%lld,\"ndiDropped\":%lld,\"skipped\":%lld,\"queue\":%d,\"connections\":%d}}",
        (sent - lastSent) / secs, (long long)(total.video_frames - lastTotal), (long long)(dropped.video_frames - lastDropped), (long long)(skipped - lastSkipped), queue.video_frames, conns);
      lastSent = sent; lastSkipped = skipped; lastTotal = total.video_frames; lastDropped = dropped.video_frames;
      writeText("STAT", b);
    }
  }
  stop = true;
  rx.join();
  n.recv_destroy(r);
  n.destroy();
  return rc2;
}

/** Reduction check without NDI: known pictures in, means out (vitest runs it when built). */
static int selftest() {
  bool ok = true;
  // UYVY 8×2 → k=2 → 4×1. Luma = column index·10, Cb = 100+pair, Cr = 200+pair
  std::vector<uint8_t> u(8 * 2 * 2), t, o;
  for (int y = 0; y < 2; y++) for (int p = 0; p < 4; p++) {
    uint8_t* q = &u[(size_t)y * 16 + p * 4];
    q[0] = (uint8_t)(100 + p); q[1] = (uint8_t)(2 * p * 10 + y); q[2] = (uint8_t)(200 + p); q[3] = (uint8_t)((2 * p + 1) * 10 + y);
  }
  int ow = 0, oh = 0;
  reduceUyvy<uint8_t>(u.data(), 8, 2, 2, o, ow, oh);
  // out pair 0 covers input pixels 0..3 (pairs 0,1): Y0 = mean(0,10 | +1) = 5.5→6, Y1 = mean(20,30) = 25.5→26, Cb = 100.5→101, Cr = 200.5→201
  ok = ok && ow == 4 && oh == 1 && o.size() == 8 && o[0] == 101 && o[1] == 6 && o[2] == 201 && o[3] == 26 && o[4] == 103 && o[5] == 46 && o[6] == 203 && o[7] == 66;
  // P216 4×4 flat Y′ 940<<6 left half, 502<<6 right half; k=2 → 2×2, CbCr 512<<6
  std::vector<uint16_t> p(4 * 4 * 2);
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) { p[(size_t)y * 4 + x] = (uint16_t)((x < 2 ? 940 : 502) << 6); p[16 + (size_t)y * 4 + x] = (uint16_t)((x % 2 ? 520 : 504) << 6); }
  reduceP216(p.data(), 4, 4, 2, o, ow, oh);
  const uint16_t* r16 = reinterpret_cast<const uint16_t*>(o.data());
  ok = ok && ow == 2 && oh == 2 && r16[0] == (940 << 6) && r16[1] == (502 << 6) && r16[4] == (504 << 6) && r16[5] == (520 << 6);
  ok = ok && reduceFactor(1920, 960) == 2 && reduceFactor(1280, 960) == 1 && reduceFactor(3840, 960) == 4 && reduceFactor(1920, 0) == 1;
  (void)t;
  printf("{\"ok\":%s}\n", ok ? "true" : "false");
  return ok ? 0 : 1;
}

// ---------------------------------------------------------------- test sender

static int sendTest(const std::string& name, int seconds, int w, int h) {
  Ndi n;
  std::string err = loadNdi(n);
  if (!err.empty()) { fprintf(stderr, "%s\n", err.c_str()); return 2; }
  NDI_send_create sc = { name.c_str(), nullptr, true, false };
  NDI_send_instance s = n.send_create(&sc);
  if (!s) { fprintf(stderr, "NDI sender cannot be created\n"); return 2; }
  std::vector<uint16_t> p((size_t)w * h * 2);
  for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
    p[(size_t)y * w + x] = (uint16_t)((x < w / 2 ? 940 : 502) << 6);      // Y′, 10-bit code value in 16 bit
    p[(size_t)w * h + (size_t)y * w + x] = (uint16_t)(512 << 6);         // Cb, Cr interleaved
  }
  NDI_video_frame_v2 v;
  std::memset(&v, 0, sizeof v);
  v.xres = w; v.yres = h; v.FourCC = LZ_NDI_FOURCC('P', '2', '1', '6'); v.frame_rate_N = 25; v.frame_rate_D = 1;
  v.picture_aspect_ratio = 16.0f / 9.0f; v.frame_format_type = NDI_frame_format_progressive; v.timecode = INT64_MAX;
  v.p_data = reinterpret_cast<uint8_t*>(p.data()); v.line_stride_in_bytes = w * 2;
  for (int i = 0; i < seconds * 25; i++) n.send_send_video_v2(s, &v);  // clock_video paces to 25 fps
  n.send_destroy(s);
  n.destroy();
  return 0;
}

int main(int argc, char** argv) {
#ifdef _WIN32
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  if (argc >= 2 && std::strcmp(argv[1], "--list") == 0) {
    int wait = 1500;
    for (int i = 2; i + 1 < argc; i++) if (std::strcmp(argv[i], "--wait") == 0) wait = std::atoi(argv[i + 1]);
    return listSources(wait < 0 ? 0 : wait > 10000 ? 10000 : wait);
  }
  if (argc >= 3 && std::strcmp(argv[1], "--capture") == 0) {
    int depth = 16, width = 0;
    for (int i = 3; i + 1 < argc; i++) {
      if (std::strcmp(argv[i], "--depth") == 0) depth = std::atoi(argv[i + 1]) == 8 ? 8 : 16;
      if (std::strcmp(argv[i], "--width") == 0) width = std::atoi(argv[i + 1]);
    }
    return capture(argv[2], depth, width < 0 ? 0 : width);
  }
  if (argc >= 3 && std::strcmp(argv[1], "--send-test") == 0) {
    int w = 320, h = 180;
    if (argc >= 5) std::sscanf(argv[4], "%dx%d", &w, &h);
    w = w < 16 ? 16 : w > 7680 ? 7680 : w & ~1; h = h < 16 ? 16 : h > 4320 ? 4320 : h;
    return sendTest(argv[2], argc >= 4 ? std::atoi(argv[3]) : 30, w, h);
  }
  if (argc >= 2 && std::strcmp(argv[1], "--selftest") == 0) return selftest();
  fprintf(stderr, "usage: lz-ndi --list [--wait ms] | --capture <name> [--depth 8|16] [--width N] | --send-test <name> [seconds] [WxH] | --selftest\n");
  return 1;
}
