# lz-aja: AJA capture helper, linked statically against libajantv2 (MIT).
#   cmake -S helpers/aja -B build/aja -DAJA_SDK_DIR=vendor/libajantv2 && cmake --build build/aja --config Release
# scripts/build-helpers.mjs runs this and copies the binary to helpers/bin/.
cmake_minimum_required(VERSION 3.21)
project(lz-aja CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if (NOT AJA_SDK_DIR)
  message(FATAL_ERROR "AJA_SDK_DIR not set (npm run aja:fetch puts libajantv2 in vendor/libajantv2)")
endif()
# only the library: no demos, tools, tests, Linux kernel module, no third-party plugin loading
set(AJANTV2_DISABLE_DEMOS ON CACHE BOOL "" FORCE)
set(AJANTV2_DISABLE_TOOLS ON CACHE BOOL "" FORCE)
set(AJANTV2_DISABLE_TESTS ON CACHE BOOL "" FORCE)
set(AJANTV2_DISABLE_DRIVER ON CACHE BOOL "" FORCE)
set(AJANTV2_DISABLE_PLUGIN_LOAD ON CACHE BOOL "" FORCE)
set(AJANTV2_BUILD_SHARED OFF CACHE BOOL "" FORCE)
set(AJANTV2_BUILD_OPENSOURCE ON CACHE BOOL "" FORCE)
add_subdirectory(${AJA_SDK_DIR} libajantv2 EXCLUDE_FROM_ALL)
# AJA's demo helpers (MIT, same repository): the 4K routing tables of ntv2capture4k
add_executable(lz-aja lz-aja.cpp ${AJA_SDK_DIR}/demos/ntv2democommon.cpp)
target_include_directories(lz-aja PRIVATE ${AJA_SDK_DIR}/demos)
target_link_libraries(lz-aja PRIVATE ajantv2)
if (MSVC)
  target_compile_options(lz-aja PRIVATE /utf-8)
endif()
