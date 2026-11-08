program test_usdcx_stablecoin.aleo;

record Token:
    owner as address.private;
    amount as u128.private;

record ComplianceRecord:
    owner as address.private;
    amount as u128.private;
    sender as address.private;
    recipient as address.private;

struct MerkleProof:
    siblings as [field; 16u32];
    leaf_index as u32;

mapping balances:
    key as address.public;
    value as u128.public;

function transfer_public:
    input r0 as address.private;
    input r1 as u128.private;
    async transfer_public self.caller r1 r0 into r2;
    output r2 as test_usdcx_stablecoin.aleo/transfer_public.future;

finalize transfer_public:
    input r0 as address.public;
    input r1 as u128.public;
    input r2 as address.public;
    get.or_use balances[r0] 0u128 into r3;
    gte r3 r1 into r4;
    assert.eq r4 true;
    sub r3 r1 into r5;
    set r5 into balances[r0];
    get.or_use balances[r2] 0u128 into r6;
    add r6 r1 into r7;
    set r7 into balances[r2];

function transfer_public_as_signer:
    input r0 as address.private;
    input r1 as u128.private;
    async transfer_public_as_signer self.signer r1 r0 into r2;
    output r2 as test_usdcx_stablecoin.aleo/transfer_public_as_signer.future;

finalize transfer_public_as_signer:
    input r0 as address.public;
    input r1 as u128.public;
    input r2 as address.public;
    get.or_use balances[r0] 0u128 into r3;
    gte r3 r1 into r4;
    assert.eq r4 true;
    sub r3 r1 into r5;
    set r5 into balances[r0];
    get.or_use balances[r2] 0u128 into r6;
    add r6 r1 into r7;
    set r7 into balances[r2];

function mint_test:
    input r0 as address.private;
    input r1 as u128.private;
    async mint_test r0 r1 into r2;
    output r2 as test_usdcx_stablecoin.aleo/mint_test.future;

finalize mint_test:
    input r0 as address.public;
    input r1 as u128.public;
    get.or_use balances[r0] 0u128 into r2;
    add r2 r1 into r3;
    set r3 into balances[r0];

function transfer_public_to_private:
    input r0 as address.private;
    input r1 as u128.private;
    cast r0 r1 into r2 as Token.record;
    cast aleo1mnldqsfrwayzfep3t9zusu4y7yknsdhfwx76v5pajla35mrqn5xsvvurhy r1 self.caller r0 into r3 as ComplianceRecord.record;
    async transfer_public_to_private self.caller r1 into r4;
    output r3 as ComplianceRecord.record;
    output r2 as Token.record;
    output r4 as test_usdcx_stablecoin.aleo/transfer_public_to_private.future;

finalize transfer_public_to_private:
    input r0 as address.public;
    input r1 as u128.public;
    get.or_use balances[r0] 0u128 into r2;
    gte r2 r1 into r3;
    assert.eq r3 true;
    sub r2 r1 into r4;
    set r4 into balances[r0];

function mint_private:
    input r0 as address.private;
    input r1 as u128.private;
    cast r0 r1 into r2 as Token.record;
    cast aleo1mnldqsfrwayzfep3t9zusu4y7yknsdhfwx76v5pajla35mrqn5xsvvurhy r1 aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc r0 into r3 as ComplianceRecord.record;
    async mint_private into r4;
    output r3 as ComplianceRecord.record;
    output r2 as Token.record;
    output r4 as test_usdcx_stablecoin.aleo/mint_private.future;

finalize mint_private:
    assert.eq true true;

function transfer_private:
    input r0 as address.private;
    input r1 as u128.private;
    input r2 as Token.record;
    input r3 as [MerkleProof; 2u32].private;
    sub r2.amount r1 into r4;
    cast r2.owner r4 into r5 as Token.record;
    cast r0 r1 into r6 as Token.record;
    cast aleo1mnldqsfrwayzfep3t9zusu4y7yknsdhfwx76v5pajla35mrqn5xsvvurhy r1 r2.owner r0 into r7 as ComplianceRecord.record;
    async transfer_private into r8;
    output r7 as ComplianceRecord.record;
    output r5 as Token.record;
    output r6 as Token.record;
    output r8 as test_usdcx_stablecoin.aleo/transfer_private.future;

finalize transfer_private:
    assert.eq true true;

function split:
    input r0 as Token.record;
    input r1 as u128.private;
    cast r0.owner r1 into r2 as Token.record;
    sub r0.amount r1 into r3;
    cast r0.owner r3 into r4 as Token.record;
    output r2 as Token.record;
    output r4 as Token.record;

function join:
    input r0 as Token.record;
    input r1 as Token.record;
    add r0.amount r1.amount into r2;
    cast r0.owner r2 into r3 as Token.record;
    output r3 as Token.record;

constructor:
    assert.eq edition 0u16;
