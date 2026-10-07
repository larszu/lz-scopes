// lz-ndi – NDI(R) receive helper for the lz-scopes bridge.
//
//   lz-ndi --list [--wait <ms>]         one JSON line: {"ok":true,"version":"…","sources":[{"name":"…","url":"…"}]}
//   lz-ndi --capture <source name>      helper protocol on stdout (docs/frame-protocol.md)
//   lz-ndi --send-test <name> [seconds] test sender: P216 frames, left half Y′ 940, right half 502 (10-bit scale)
//
// The NDI runtime is loaded at run time (dlopen / LoadLibrary) from $NDI_RUNTIME_DIR_V6 or
// the system paths – it is installed by the user (NDI Tools or the NDI runtime from
// ndi.video) and is not part of lz-scopes. Frames are requested as
// NDIlib_recv_color_format_best, so 16-bit sources arrive as P216 and 8-bit ones as UYVY.
//
// NDI(R) is a registered trademark of Vizrt NDI AB. https://ndi.video/

#include "ndi-min.h"

#include <chrono>
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
  if (!h) return "NDI runtime not found – install NDI Tools or the NDI runtime from ndi.video";
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

static int capture(const std::string& name) {
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
  NDI_recv_create_v3 rc = { found, NDI_recv_color_format_best, NDI_recv_bandwidth_highest, false, "LZ Scopes" };
  NDI_recv_instance r = n.recv_create_v3(&rc);
  n.find_destroy(f);
  if (!r) { writeText("ERR ", "{\"code\":\"ndi.recvFailed\",\"message\":\"NDI receiver cannot be created\"}"); return 2; }
  std::string lastInfo;
  std::vector<uint8_t> buf;
  auto lastFrame = std::chrono::steady_clock::now();
  for (;;) {
    NDI_video_frame_v2 v;
    std::memset(&v, 0, sizeof v);
    const int32_t t = n.recv_capture_v3(r, &v, nullptr, nullptr, 1000);
    if (t == NDI_frame_type_error) { writeText("ERR ", "{\"code\":\"ndi.lost\",\"message\":\"Connection to the NDI source lost\"}"); return 3; }
    if (t != NDI_frame_type_video) {
      if (std::chrono::steady_clock::now() - lastFrame > std::chrono::seconds(2)) { writeText("STAT", "{\"code\":\"ndi.waiting\",\"message\":\"waiting for a picture from the NDI source\"}"); lastFrame = std::chrono::steady_clock::now(); }
      continue;
    }
    lastFrame = std::chrono::steady_clock::now();
    const char* pixel = repack(v, buf);
    if (!pixel) {
      char cc[5] = { (char)(v.FourCC & 0xff), (char)((v.FourCC >> 8) & 0xff), (char)((v.FourCC >> 16) & 0xff), (char)(v.FourCC >> 24), 0 };
      writeText("STAT", std::string("{\"code\":\"ndi.format\",\"message\":\"NDI format ") + jsonEscape(cc) + " not supported\",\"params\":{\"fourcc\":\"" + jsonEscape(cc) + "\"}}");
      n.recv_free_video_v2(r, &v);
      continue;
    }
    // NDI signals no colour metadata here; the bridge applies BT.709 above SD, BT.601 for SD.
    // With color_format_best the SDK header says fields may arrive individually (field_0/1):
    // each field is then measured as its own picture.
    std::string info = "{\"width\":" + std::to_string(v.xres) + ",\"height\":" + std::to_string(v.yres)
      + ",\"fpsNum\":" + std::to_string(v.frame_rate_N) + ",\"fpsDen\":" + std::to_string(v.frame_rate_D)
      + ",\"pixel\":\"" + pixel + "\",\"range\":\"" + (pixel[0] == 'b' || pixel[0] == 'r' ? "pc" : "tv") + "\",\"interlaced\":" + (v.frame_format_type == NDI_frame_format_progressive ? "false" : "true")
      + ",\"name\":\"" + jsonEscape(foundName) + "\"}";
    if (info != lastInfo) { writeText("INFO", info); lastInfo = info; }
    n.recv_free_video_v2(r, &v);
    writeRecord("FRAM", buf.data(), (uint32_t)buf.size());
  }
}

// ---------------------------------------------------------------- test sender

static int sendTest(const std::string& name, int seconds) {
  Ndi n;
  std::string err = loadNdi(n);
  if (!err.empty()) { fprintf(stderr, "%s\n", err.c_str()); return 2; }
  NDI_send_create sc = { name.c_str(), nullptr, true, false };
  NDI_send_instance s = n.send_create(&sc);
  if (!s) { fprintf(stderr, "NDI sender cannot be created\n"); return 2; }
  const int w = 320, h = 180;
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
  if (argc >= 3 && std::strcmp(argv[1], "--capture") == 0) return capture(argv[2]);
  if (argc >= 3 && std::strcmp(argv[1], "--send-test") == 0) return sendTest(argv[2], argc >= 4 ? std::atoi(argv[3]) : 30);
  fprintf(stderr, "usage: lz-ndi --list [--wait ms] | --capture <name> | --send-test <name> [seconds]\n");
  return 1;
}
