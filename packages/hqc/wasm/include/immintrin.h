/*
 * Empty on purpose. Three of the reference implementation's headers (src/ref/hqc.h, parsing.h,
 * vector.h) include <immintrin.h>, the x86 intrinsics, though the reference code uses none of
 * them; clang's own copy refuses any target but x86. This file comes first on the include path
 * when building for WebAssembly, so the vendored files compile unmodified. If the reference ever
 * used an intrinsic, the build would fail on the undefined name rather than miscompile.
 */
