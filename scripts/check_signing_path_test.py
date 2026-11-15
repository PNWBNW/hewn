#!/usr/bin/env python3
"""Tests for scripts/check_signing_path.py: the one door to the wallet stays the only one.

Builds a throwaway tree holding a copy of the check and a small shield.ts of the same shape as
apps/business/src/chain/shield.ts (FIXTURE below), adds one source file (or changes that shield.ts)
per case and runs the check the way CI does. Only the first test reads today's real shield.ts, so a
change there that keeps the one door (a `.catch` on the send, a new field returned) doesn't break
the others. Standard library only:

    python3 -I scripts/check_signing_path_test.py
"""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "check_signing_path.py"
SHIELD = "apps/business/src/chain/shield.ts"
GUARD = "await checkEditions();"
SEND = "return adaptor.executeTransaction(withFeeMode(call, feeMode ?? readFeeMode()));"
WIRED = "const wallet = { ...adaptor, executeTransaction: checkedSend(adaptor) };"
RETURNED = "return { shield, restart, error, setError, wallet };"
FIXTURE = f"""\"use client\";

// A small stand-in for apps/business/src/chain/shield.ts: the same one door, nothing else.

import {{ useState }} from "react";
import {{ type FeeMode, readFeeMode, withFeeMode }} from "@pnw/wallet/fee-mode";
import {{ useWallet }} from "@pnw/wallet/wallet-provider";
import {{ checkEditions }} from "./editions";

type Sender = Pick<ReturnType<typeof useWallet>, "executeTransaction">;

export function checkedSend(adaptor: Sender) {{
  return async (opts: Parameters<Sender["executeTransaction"]>[0] & {{ feeMode?: FeeMode }}) => {{
    const {{ feeMode, ...call }} = opts;
    {GUARD}
    {SEND}
  }};
}}

export function useShield() {{
  const adaptor = useWallet();
  {WIRED}
  const shield = wallet.wallets[0];
  const [error, setError] = useState<string | null>(null);

  const restart = async () => {{
    try {{
      await adaptor.disconnect();
    }} catch {{
      // Nothing was connected.
    }}
    // The provider misses the disconnect once a shield:// link has fired; selecting no wallet clears it.
    wallet.selectWallet(null);
  }};

  {RETURNED}
}}
"""
# The send as written today, and as it may be written once Shield's refusals are rethrown.
SEND_FORMS = (
    SEND,
    "return adaptor.executeTransaction(withFeeMode(call, feeMode ?? readFeeMode())).catch(rethrowSendError);",
    "try {\n      return await adaptor.executeTransaction(withFeeMode(call, feeMode ?? readFeeMode()));\n"
    "    } catch (e) {\n      return rethrowSendError(e);\n    }",
)
PANEL = """import { useShield } from "./shield";

export async function send(opts: { program: string; function: string; inputs: string[] }) {
  const { wallet } = useShield();
  return wallet.executeTransaction({ ...opts, privateFee: false });
}
"""


class SigningPathTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "scripts").mkdir()
        shutil.copy(SCRIPT, self.root / "scripts" / "check_signing_path.py")
        self.shield = FIXTURE
        self.write(SHIELD, self.shield)
        self.write("apps/business/src/chain/Panel.tsx", PANEL)
        (self.root / "packages").mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, rel: str, text: str) -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def change(self, old: str, new: str) -> None:
        """Writes the fixture with `old` (which it must hold once) replaced by `new`."""
        self.assertEqual(self.shield.count(old), 1, f"the fixture no longer holds {old!r}")
        self.write(SHIELD, self.shield.replace(old, new, 1))

    def check(self):
        return subprocess.run(
            [sys.executable, "-I", str(self.root / "scripts" / "check_signing_path.py")],
            cwd=self.root,
            capture_output=True,
            text=True,
            timeout=60,
        )

    def assertFails(self, rel: str, why: str):
        done = self.check()
        self.assertEqual(done.returncode, 1, done.stdout)
        self.assertIn(f"{rel}: {why}", done.stderr)

    def test_todays_tree_passes(self):
        self.write(SHIELD, (HERE.parent / SHIELD).read_text(encoding="utf-8"))
        done = self.check()
        self.assertEqual(done.returncode, 0, done.stderr)

    def test_a_proving_request_fails(self):
        rel = "apps/business/src/chain/prove.ts"
        self.write(rel, 'import { ProvingRequest } from "@provablehq/sdk";\n'
                        "export const p = (r: never) => ProvingRequest.fromRequest(r, undefined, false);\n")
        self.assertFails(rel, "uses the SDK's external signing or proving request")

    def test_external_signing_from_the_wasm_package_fails(self):
        rel = "packages/rail/src/sign.ts"
        self.write(rel, 'import { buildExecutionRequestFromExternallySignedData } from "@provablehq/wasm";\n'
                        "export const s = buildExecutionRequestFromExternallySignedData;\n")
        self.assertFails(rel, "uses the SDK's external signing or proving request")

    def test_external_signing_names_fail_however_they_are_reached(self):
        rel = "apps/business/src/books/auth.ts"
        self.write(rel, "export async function a(sdk: any, req: unknown) {\n"
                        "  return sdk.buildAuthorizationFromExecutionRequest(req);\n}\n")
        self.assertFails(rel, "uses the SDK's external signing or proving request")

    def test_the_proving_service_fails(self):
        rel = "apps/business/src/chain/prover.ts"
        self.write(rel, 'const { submitProvingRequestSafe } = await import("@provablehq/sdk");\n'
                        "export const go = submitProvingRequestSafe;\n")
        self.assertFails(rel, "uses the SDK's external signing or proving request")

    def test_the_program_manager_base_fails(self):
        rel = "apps/business/src/chain/pm.ts"
        self.write(rel, 'import { ProgramManagerBase } from "@provablehq/sdk";\nexport const m = new ProgramManagerBase();\n')
        self.assertFails(rel, "uses the SDK's execute path")

    def test_names_in_tests_and_comments_pass(self):
        self.write("apps/business/src/chain/prove.test.ts", 'import { ProvingRequest } from "@provablehq/sdk";\nProvingRequest;\n')
        self.write("apps/business/src/chain/note.ts", "// Shield builds its own ProvingRequest; this app never does.\nexport const x = 1;\n")
        done = self.check()
        self.assertEqual(done.returncode, 0, done.stderr)

    def test_a_send_without_the_edition_check_fails(self):
        self.change(GUARD, "")
        self.assertFails(SHIELD, "asks the adapter to sign without `await checkEditions()` first")

    def test_the_edition_check_after_the_send_fails(self):
        for form in SEND_FORMS:
            with self.subTest(form=form):
                self.change(SEND, form)
                done = self.check()
                self.assertEqual(done.returncode, 0, done.stderr)
                after = form.replace("return ", "const sent = ", 1).replace(";", f";\n    {GUARD}\n    return sent;", 1)
                self.change(f"{GUARD}\n    {SEND}", after)
                self.assertFails(SHIELD, "asks the adapter to sign without `await checkEditions()` first")

    def test_the_edition_check_named_in_a_comment_beside_a_link_fails(self):
        self.change(GUARD, "// The editions, as https://example.org says: await checkEditions()")
        self.assertFails(SHIELD, "asks the adapter to sign without `await checkEditions()` first")

    def test_an_apostrophe_in_a_comment_beside_a_link_passes(self):
        self.change("The provider misses the disconnect", "The provider doesn't see the disconnect")
        done = self.check()
        self.assertEqual(done.returncode, 0, done.stderr)

    def test_code_after_a_link_still_counts(self):
        rel = "apps/business/src/chain/Linked.tsx"
        self.write(rel, PANEL.replace(
            "return wallet.executeTransaction(",
            'void fetch("https://api.example.org/v2"); return wallet.wallets[0].adapter.executeTransaction(',
        ))
        self.assertFails(rel, "asks the wallet adapter itself to sign")

    def test_an_unchecked_deployment_in_shield_fails(self):
        self.write(SHIELD, self.shield + "\nexport const deploy = async (a: any, o: unknown) => a.executeDeployment(o);\n")
        self.assertFails(SHIELD, "asks the adapter to sign without `await checkEditions()` first")

    def test_a_deployment_outside_shield_fails(self):
        rel = "apps/business/src/chain/Deploy.tsx"
        self.write(rel, PANEL.replace("wallet.executeTransaction(", "wallet.executeDeployment("))
        self.assertFails(rel, "asks for a deployment")

    def test_the_raw_adapter_outside_shield_fails(self):
        rel = "apps/business/src/chain/Raw.tsx"
        self.write(rel, PANEL.replace("wallet.executeTransaction(", "wallet.wallets[0].adapter.executeTransaction("))
        self.assertFails(rel, "asks the wallet adapter itself to sign")

    def test_the_raw_adapter_under_another_name_fails(self):
        rel = "apps/business/src/chain/ZzRaw.tsx"
        self.write(rel, PANEL.replace(
            "return wallet.executeTransaction({ ...opts, privateFee: false });",
            "const a = wallet.wallet?.adapter;\n  return a?.executeTransaction({ ...opts, privateFee: false });",
        ))
        self.assertFails(rel, "reads the wallet's raw adapter")

    def test_the_raw_adapter_destructured_fails(self):
        rel = "packages/rail/src/raw.ts"
        self.write(rel, "export function raw(w: any) {\n  const { wallets } = w;\n  return wallets;\n}\n")
        self.assertFails(rel, "reads the wallet's raw adapter")

    def test_a_wallet_without_the_checked_send_fails(self):
        self.change(WIRED, "const wallet = { ...adaptor };")
        self.assertFails(SHIELD, "useShield() must build its wallet")

    def test_the_raw_send_cast_into_the_wallet_fails(self):
        self.change("executeTransaction: checkedSend(adaptor) }",
                    "executeTransaction: adaptor.executeTransaction as ReturnType<typeof checkedSend> }")
        self.assertFails(SHIELD, "asks the adapter to sign without `await checkEditions()` first")

    def test_the_raw_adapter_returned_from_use_shield_fails(self):
        self.change(RETURNED, RETURNED.replace("wallet }", "wallet: adaptor }"))
        self.assertFails(SHIELD, "useShield() must build its wallet")

    def test_a_second_send_after_checked_send_fails(self):
        self.change("export function useShield()",
                    "export const raw = (a: Sender, o: never) => a.executeTransaction(o);\n\nexport function useShield()")
        self.assertFails(SHIELD, "asks the adapter to sign without `await checkEditions()` first")

    def test_other_proving_request_names_fail(self):
        for i, line in enumerate(("export const p = (pm: any, o: unknown) => pm.provingRequest(o);",
                                  "export const e = (sdk: any, r: unknown) => sdk.encryptProvingRequest(r);",
                                  "export const b = (pm: any, o: unknown) => pm.buildExecutionRequest(o);")):
            rel = f"apps/business/src/chain/prove{i}.ts"
            self.write(rel, line + "\n")
            self.assertFails(rel, "uses the SDK's external signing or proving request")

    def test_an_unrelated_authorization_name_passes(self):
        self.write("apps/business/src/books/letter.ts", "export function buildAuthorizationLetter() {\n  return 1;\n}\n")
        done = self.check()
        self.assertEqual(done.returncode, 0, done.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
