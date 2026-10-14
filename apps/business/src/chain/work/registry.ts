// ---------------------------------------------------------------------------
// The person's identity on the registry, encoded exactly as the old portal
// encoded it (RegisterNameStep.tsx, CreateProfileStep.tsx):
//
//   pnw_name_registrar_v5::register_worker_name(<hash>field, <name as u128>u128)
//   pnw_worker_profiles_v2::create_worker_profile(15 inputs, see profileInputs)
//
// The name hash is BLAKE3("PNW::NAME", TLV(name)) reduced into the field
// (computeNameHash, @pnw/records). The name itself goes on the chain as a
// u128 (big-endian bytes, 16 at most) for the public reverse lookup: a
// registered name is public by design. The profile's names, age and codes
// go into a private record; only its anchor is public. Nothing from the
// profile form is kept in the vault.
// ---------------------------------------------------------------------------

import { tlvEncode } from "@pnw/commitments/canonical_encoder";
import { DOMAIN_TAGS, domainHash } from "@pnw/commitments/hash";
import { PROGRAMS } from "@pnw/config/programs";
import { computeNameHash } from "@pnw/records/registry/name_registry";
import { GENDER_CODES, encodeStringToU128 } from "@pnw/records/registry/profile_types";
import { toU8Array } from "./agreements";

export const NAME_PATTERN = /^[a-z0-9_]{3,16}$/;
export const NAME_RULE = "3 to 16 characters: lower-case letters, digits and underscores";

export const REGISTER = { program: PROGRAMS.layer1.pnw_name_registrar, function: "register_worker_name" } as const;
export const CREATE_PROFILE = { program: PROGRAMS.layer1.worker_profiles, function: "create_worker_profile" } as const;

/** The name's bytes as a decimal u128, big-endian, as the registrar's reverse lookup stores it. */
export function nameToU128(name: string): string {
  let value = 0n;
  for (const b of new TextEncoder().encode(name.slice(0, 16))) value = (value << 8n) | BigInt(b);
  return value.toString(10);
}

/** The two inputs of `register_worker_name`, with the hash the registry will hold. */
export function registerNameInputs(name: string): { nameHash: string; inputs: string[] } {
  if (!NAME_PATTERN.test(name)) throw new Error(`A name is ${NAME_RULE}`);
  const nameHash = computeNameHash(name);
  return { nameHash, inputs: [`${nameHash}field`, `${nameToU128(name)}u128`] };
}

export type ProfileForm = {
  firstName: string;
  middleName: string;
  lastName: string;
  /** YYYY-MM-DD. */
  dateOfBirth: string;
  /** 1 male, 2 female, 3 prefer not to say (the old code's own value for unspecified). */
  gender: number;
  /** FIPS 5-2 numeric state code. */
  stateCode: number;
  /** ISO 3166-1 numeric. */
  countryCode: number;
  industryCode: number;
  /** 1 citizen, 2 permanent resident, 3 work visa, 4 other. */
  citizenshipFlag: number;
};

export const GENDER_UNSPECIFIED = GENDER_CODES.PREFER_NOT;

export const CITIZENSHIP = [
  { code: 1, label: "U.S. citizen" },
  { code: 2, label: "Permanent resident" },
  { code: 3, label: "Work visa" },
  { code: 4, label: "Other" },
];

/** Whole years from a birth date to `now`, in the person's own calendar. */
export function ageAt(dateOfBirth: string, now: Date): number {
  const m = dateOfBirth.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error("Enter the date of birth as YYYY-MM-DD");
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age--;
  return age;
}

/** Field by field, the same checks the old form made. */
export function checkProfileForm(form: ProfileForm, now: Date): void {
  if (!form.firstName.trim()) throw new Error("First name is required");
  if (!form.lastName.trim()) throw new Error("Last name is required");
  if (new TextEncoder().encode(form.firstName.trim()).length > 16 || new TextEncoder().encode(form.lastName.trim()).length > 16 || new TextEncoder().encode(form.middleName.trim()).length > 16) {
    throw new Error("Each name can be at most 16 characters");
  }
  const age = ageAt(form.dateOfBirth, now);
  if (age < 16 || age > 120) throw new Error("Age must be between 16 and 120");
  if (!Number.isInteger(form.stateCode) || form.stateCode <= 0) throw new Error("Select your state");
  if (!Number.isInteger(form.countryCode) || form.countryCode <= 0) throw new Error("Select your country");
  if (![1, 2, 3].includes(form.gender)) throw new Error("Unknown gender code");
  if (!Number.isInteger(form.industryCode) || form.industryCode <= 0 || form.industryCode > 255) throw new Error("Select your industry");
  if (![1, 2, 3, 4].includes(form.citizenshipFlag)) throw new Error("Select your citizenship");
}

const OBJ_PROFILE_ANCHOR = 0x5010;
const FIELD_MODULUS = 8444461749428370424248824938781546531375899335154063827935233455917409239041n;

const u32be = (v: number): Uint8Array => {
  const b = new Uint8Array(4);
  b[0] = (v >>> 24) & 0xff;
  b[1] = (v >>> 16) & 0xff;
  b[2] = (v >>> 8) & 0xff;
  b[3] = v & 0xff;
  return b;
};

/** BLAKE3("PNW::DOC", TLV(name hash, address, epoch seconds)) as a `[u8; 32]`: the profile's public anchor. */
export function profileAnchor(nameHash: string, address: string, epochSeconds: number): string {
  const utf8 = (s: string) => new TextEncoder().encode(s);
  return toU8Array(
    domainHash(
      DOMAIN_TAGS.DOC,
      tlvEncode(OBJ_PROFILE_ANCHOR, [
        { tag: 0x01, value: utf8(nameHash) },
        { tag: 0x02, value: utf8(address) },
        { tag: 0x03, value: u32be(epochSeconds) },
      ]),
    ),
  );
}

/** The 15 inputs of `create_worker_profile`, in order. */
export function profileInputs(form: ProfileForm, nameHash: string, address: string, now: Date): string[] {
  checkProfileForm(form, now);
  const safeHash = (BigInt(nameHash.replace(/field$/, "").trim()) % FIELD_MODULUS).toString(10);
  const epoch = Math.floor(now.getTime() / 1000);
  return [
    `${safeHash}field`,
    encodeStringToU128(form.firstName.trim()),
    encodeStringToU128(form.middleName.trim() || " "),
    encodeStringToU128(form.lastName.trim()),
    `${ageAt(form.dateOfBirth, now)}u8`,
    `${form.gender}u8`,
    `${form.stateCode}u16`,
    `${form.countryCode}u16`,
    encodeStringToU128("0"), // state-issued id: not asked for; the old form sent "0" when blank
    `${form.industryCode}u8`,
    `${form.citizenshipFlag}u8`,
    "1u16", // schema_v
    "1u16", // policy_v
    "1u16", // profile_rev
    profileAnchor(nameHash, address, epoch),
  ];
}
