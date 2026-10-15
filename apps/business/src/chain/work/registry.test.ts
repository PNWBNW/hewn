import { tlvEncode } from "@pnw/commitments/canonical_encoder";
import { DOMAIN_TAGS, domainHash } from "@pnw/commitments/hash";
import { computeNameHash } from "@pnw/records/registry/name_registry";
import { encodeStringToU128 } from "@pnw/records/registry/profile_types";
import { describe, expect, it } from "vitest";
import { CREATE_PROFILE, type ProfileForm, REGISTER, ageAt, checkProfileForm, nameToU128, profileAnchor, profileInputs, registerNameInputs } from "./registry";

const WORKER = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px";

describe("register_worker_free", () => {
  it("encodes the name as the old RegisterNameStep did: <hash>field, <big-endian bytes>u128", () => {
    const { nameHash, inputs } = registerNameInputs("ana_ruiz");
    expect(nameHash).toBe(computeNameHash("ana_ruiz"));
    expect(nameHash).toMatch(/^\d+$/);
    expect(inputs).toEqual([`${nameHash}field`, `${nameToU128("ana_ruiz")}u128`]);
    expect(REGISTER).toEqual({ program: "pnw_name_registrar_v5.aleo", function: "register_worker_free" });
  });

  it("pins the fixtures", () => {
    // "ana" = 0x61 0x6e 0x61 = 6385249
    expect(nameToU128("ana")).toBe("6385249");
    expect(nameToU128("ana_ruiz")).toBe(encodeStringToU128("ana_ruiz").replace(/u128$/, ""));
    expect(nameToU128("sixteen_chars_ab")).toBe(encodeStringToU128("sixteen_chars_ab").replace(/u128$/, ""));
    expect(registerNameInputs("ana_ruiz").inputs).toEqual([
      "4547698302048783622388735066678619945457518107237306768812295900000616107966field",
      "7020655931687266682u128",
    ]);
  });

  it("refuses a name the registry wouldn't take", () => {
    for (const bad of ["ab", "Ana", "ana ruiz", "a".repeat(17), "ana-ruiz", ""]) expect(() => registerNameInputs(bad)).toThrow(/3 to 16/);
  });
});

const form: ProfileForm = {
  firstName: "Ana",
  middleName: "",
  lastName: "Ruiz",
  dateOfBirth: "1990-06-15",
  gender: 3,
  stateCode: 53,
  countryCode: 840,
  industryCode: 9,
  citizenshipFlag: 1,
};
const NOW = new Date("2026-10-14T19:00:00.000Z");
const NAME_HASH = computeNameHash("ana_ruiz");

describe("create_worker_profile", () => {
  it("builds the 15 inputs exactly as the old CreateProfileStep did", () => {
    const inputs = profileInputs(form, NAME_HASH, WORKER, NOW);
    expect(inputs).toHaveLength(15);
    expect(inputs).toEqual([
      `${NAME_HASH}field`,
      encodeStringToU128("Ana"),
      encodeStringToU128(" "), // a blank middle name goes as one space, as before
      encodeStringToU128("Ruiz"),
      "36u8",
      "3u8",
      "53u16",
      "840u16",
      encodeStringToU128("0"), // the state-issued id the old form sent when blank
      "9u8",
      "1u8",
      "1u16",
      "1u16",
      "1u16",
      profileAnchor(NAME_HASH, WORKER, Math.floor(NOW.getTime() / 1000)),
    ]);
    expect(CREATE_PROFILE).toEqual({ program: "pnw_worker_profiles_v2.aleo", function: "create_worker_profile" });
  });

  it("pins the fixture", () => {
    // "Ana" = 0x41 0x6e 0x61, " " = 0x20, "Ruiz" = 0x52 0x75 0x69 0x7a
    expect(profileInputs(form, NAME_HASH, WORKER, NOW).slice(0, 4)).toEqual([
      "4547698302048783622388735066678619945457518107237306768812295900000616107966field",
      "4288097u128",
      "32u128",
      "1383426426u128",
    ]);
  });

  it("anchors the profile as BLAKE3(PNW::DOC, TLV 0x5010 of name hash, address, u32 seconds)", () => {
    const ts = 1_760_461_200;
    const utf8 = (s: string) => new TextEncoder().encode(s);
    const expected = domainHash(
      DOMAIN_TAGS.DOC,
      tlvEncode(0x5010, [
        { tag: 0x01, value: utf8(NAME_HASH) },
        { tag: 0x02, value: utf8(WORKER) },
        { tag: 0x03, value: new Uint8Array([(ts >>> 24) & 255, (ts >>> 16) & 255, (ts >>> 8) & 255, ts & 255]) },
      ]),
    );
    expect(profileAnchor(NAME_HASH, WORKER, ts)).toBe("[ " + Array.from(expected, (b) => `${b}u8`).join(", ") + " ]");
    expect(profileAnchor(NAME_HASH, WORKER, ts)).not.toBe(profileAnchor(NAME_HASH, WORKER, ts + 1));
  });

  it("works out the age from the date of birth in the person's calendar", () => {
    expect(ageAt("1990-06-15", NOW)).toBe(36);
    expect(ageAt("1990-10-14", NOW)).toBe(36); // birthday today
    expect(ageAt("1990-10-15", NOW)).toBe(35); // birthday tomorrow
    expect(() => ageAt("15/06/1990", NOW)).toThrow(/YYYY-MM-DD/);
  });

  it("checks the form the way the old one did, and refuses to encode a bad one", () => {
    expect(() => checkProfileForm({ ...form, firstName: " " }, NOW)).toThrow(/First name/);
    expect(() => checkProfileForm({ ...form, lastName: "" }, NOW)).toThrow(/Last name/);
    expect(() => checkProfileForm({ ...form, dateOfBirth: "2015-01-01" }, NOW)).toThrow(/between 16 and 120/);
    expect(() => checkProfileForm({ ...form, stateCode: 0 }, NOW)).toThrow(/state/);
    expect(() => checkProfileForm({ ...form, gender: 0 }, NOW)).toThrow(/gender/);
    expect(() => checkProfileForm({ ...form, citizenshipFlag: 9 }, NOW)).toThrow(/citizenship/);
    expect(() => checkProfileForm({ ...form, firstName: "a".repeat(17) }, NOW)).toThrow(/16 characters/);
    expect(() => profileInputs({ ...form, lastName: "" }, NAME_HASH, WORKER, NOW)).toThrow(/Last name/);
  });
});
