/*
 * The WebAssembly module's own entry points around the HQC team's reference code for HQC-5
 * (vendor/hqc-5.1.0, unmodified). This file is ours, not the HQC team's; it implements nothing of
 * HQC itself. It does two things:
 *
 * 1. It is the reference code's `randombytes()` (src/common/randombytes.h). The reference draws
 *    its randomness through that one function: 32 bytes for key generation (the KEM seed, which is
 *    the secret key), then 32 and 16 for encapsulation (the message m and the salt). Here it hands
 *    out the bytes the JavaScript side wrote into `io.rnd` before the call, in order, and fails if
 *    a call asks for more than are left. So a key comes from a seed the caller chooses, and an
 *    encapsulation from randomness the caller chooses (fresh from crypto.getRandomValues, or fixed
 *    in a test); the module itself has no source of randomness and imports nothing.
 * 2. It exports the three KEM operations and one table saying where the buffers they read and
 *    write, and the stack, lie in the module's memory, so the JavaScript side can fill them, read
 *    them, and zero them all after every call.
 *
 * Nothing here prints, allocates, or touches a file or the network.
 */

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "hqc-kem.h"
#include "randombytes.h"

#define ENCAPS_M_BYTES     32U /* PARAM_K for HQC-5 */
#define ENCAPS_SALT_BYTES  16U /* SALT_BYTES */
#define KEYGEN_RANDOM      CRYPTO_SECRETKEYBYTES
#define ENCAPS_RANDOM      (ENCAPS_M_BYTES + ENCAPS_SALT_BYTES)

#define EXPORT(name) __attribute__((export_name(name), visibility("default")))

/* Results beyond the reference's own 0 (success) and -1 (randombytes failed). */
#define HQC5_RANDOM_LEFT_OVER (-2) /* the reference drew fewer random bytes than were given */

static struct {
    uint8_t pk[CRYPTO_PUBLICKEYBYTES];
    uint8_t ct[CRYPTO_CIPHERTEXTBYTES];
    uint8_t sk[CRYPTO_SECRETKEYBYTES];
    uint8_t ss[CRYPTO_BYTES];
    uint8_t rnd[ENCAPS_RANDOM];
} io;

static size_t rnd_len;
static size_t rnd_used;

/* The linker's bounds of the stack (wasm-ld defines both). */
extern unsigned char __stack_low;
extern unsigned char __stack_high;

static uint32_t layout[7];

uint32_t *hqc5_layout(void);
int32_t hqc5_keygen(void);
int32_t hqc5_encaps(void);
int32_t hqc5_decaps(void);

int randombytes(uint8_t *out, size_t outlen) {
    if (outlen > rnd_len - rnd_used) {
        return -1;
    }
    memcpy(out, io.rnd + rnd_used, outlen);
    rnd_used += outlen;
    return 0;
}

static int32_t finish(int8_t ret) {
    int32_t out = ret;
    if (out == 0 && rnd_used != rnd_len) {
        out = HQC5_RANDOM_LEFT_OVER;
    }
    rnd_len = 0;
    rnd_used = 0;
    return out;
}

/* Where io's fields and the stack are: pk, ct, sk, ss, rnd, stack low, stack high. */
EXPORT("hqc5_layout") uint32_t *hqc5_layout(void) {
    layout[0] = (uint32_t)(uintptr_t)io.pk;
    layout[1] = (uint32_t)(uintptr_t)io.ct;
    layout[2] = (uint32_t)(uintptr_t)io.sk;
    layout[3] = (uint32_t)(uintptr_t)io.ss;
    layout[4] = (uint32_t)(uintptr_t)io.rnd;
    layout[5] = (uint32_t)(uintptr_t)&__stack_low;
    layout[6] = (uint32_t)(uintptr_t)&__stack_high;
    return layout;
}

/* io.rnd holds the 32-byte seed; writes io.pk and io.sk (the seed itself, by HQC's design). */
EXPORT("hqc5_keygen") int32_t hqc5_keygen(void) {
    rnd_len = KEYGEN_RANDOM;
    rnd_used = 0;
    return finish(hqc_kem_keygen(io.pk, io.sk));
}

/* io.pk holds the public key and io.rnd the 48 random bytes (m, then the salt); writes io.ct, io.ss. */
EXPORT("hqc5_encaps") int32_t hqc5_encaps(void) {
    rnd_len = ENCAPS_RANDOM;
    rnd_used = 0;
    return finish(hqc_kem_encaps(io.ss, io.ct, io.pk));
}

/* io.sk holds the secret key and io.ct the ciphertext; writes io.ss (implicit rejection: a
 * ciphertext that doesn't re-encrypt gives a pseudorandom secret, never an error). */
EXPORT("hqc5_decaps") int32_t hqc5_decaps(void) {
    rnd_len = 0;
    rnd_used = 0;
    return finish(hqc_kem_decaps(io.ss, io.sk, io.ct));
}
