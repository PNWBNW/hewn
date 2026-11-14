#!/usr/bin/env python3
"""Tests for scripts/check_signing_path.py: the one door to the wallet stays the only one.

Builds a throwaway tree holding a copy of the check and of today's apps/business/src/chain/shield.ts,
adds one source file (or changes shield.ts) per case and runs the check the way CI does.
Standard library only:

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
        self.shield = (HERE.parent / SHIELD).read_text(encoding="utf-8")
        self.write(SHIELD, self.shield)
        self.write("apps/business/src/chain/Panel.tsx", PANEL)
        (self.root / "packages").mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, rel: str, text: str) -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

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
        self.assertIn(GUARD, self.shield)
        self.write(SHIELD, self.shield.replace(GUARD, "", 1))
        self.assertFails(SHIELD, "asks the adapter to sign without `await checkEditions()` first")

    def test_the_edition_check_after_the_send_fails(self):
        self.assertIn(GUARD, self.shield)
        moved = self.shield.replace(GUARD, "", 1).replace("return adaptor.executeTransaction(", "const sent = adaptor.executeTransaction(", 1)
        self.assertNotEqual(moved, self.shield.replace(GUARD, "", 1))
        moved = moved.replace("readFeeMode()));", f"readFeeMode()));\n      {GUARD}\n      return sent;", 1)
        self.write(SHIELD, moved)
        self.assertFails(SHIELD, "asks the adapter to sign without `await checkEditions()` first")

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
        wired = "const wallet = { ...adaptor, executeTransaction: checkedSend(adaptor) };"
        self.assertIn(wired, self.shield)
        self.write(SHIELD, self.shield.replace(wired, "const wallet = { ...adaptor };", 1))
        self.assertFails(SHIELD, "useShield() must build its wallet")

    def test_the_raw_send_cast_into_the_wallet_fails(self):
        wired = "executeTransaction: checkedSend(adaptor) }"
        self.write(SHIELD, self.shield.replace(
            wired, "executeTransaction: adaptor.executeTransaction as ReturnType<typeof checkedSend> }", 1))
        self.assertFails(SHIELD, "asks the adapter to sign without `await checkEditions()` first")

    def test_the_raw_adapter_returned_from_use_shield_fails(self):
        ret = "return { state, route, away, connect, restart, wakeUrl, error, wallet };"
        self.assertIn(ret, self.shield)
        self.write(SHIELD, self.shield.replace(ret, ret.replace("wallet }", "wallet: adaptor }"), 1))
        self.assertFails(SHIELD, "useShield() must build its wallet")

    def test_a_second_send_after_checked_send_fails(self):
        self.write(SHIELD, self.shield.replace(
            "export function useShield()",
            "export const raw = (a: Sender, o: never) => a.executeTransaction(o);\n\nexport function useShield()", 1))
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
