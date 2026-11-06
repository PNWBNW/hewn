program hewn_letters_v2.aleo;

record Letter:
    owner as address.private;
    lookup as [u128; 2u32].private;
    parcel as [field; 34u32].private;

record SentLetter:
    owner as address.private;
    lookup as [u128; 2u32].private;
    parcel as [field; 34u32].private;

record Page:
    owner as address.private;
    lookup as [u128; 2u32].private;
    page as [field; 256u32].private;

function send:
    input r0 as address.private;
    input r1 as [u128; 2u32].private;
    input r2 as [field; 34u32].private;
    assert.neq r0 aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;
    is.neq r1[0u32] 0u128 into r3;
    is.neq r1[1u32] 0u128 into r4;
    or r3 r4 into r5;
    assert.eq r5 true;
    cast r0 r1 r2 into r6 as Letter.record;
    cast self.signer r1 r2 into r7 as SentLetter.record;
    output r6 as Letter.record;
    output r7 as SentLetter.record;

function send_page:
    input r0 as address.private;
    input r1 as [u128; 2u32].private;
    input r2 as [field; 256u32].private;
    assert.neq r0 aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;
    is.neq r1[0u32] 0u128 into r3;
    is.neq r1[1u32] 0u128 into r4;
    or r3 r4 into r5;
    assert.eq r5 true;
    cast r0 r1 r2 into r6 as Page.record;
    output r6 as Page.record;

function send_many:
    input r0 as [address; 8u32].private;
    input r1 as [u128; 2u32].private;
    input r2 as [field; 34u32].private;
    assert.neq r0[0u32] aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;
    assert.neq r0[1u32] aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;
    assert.neq r0[2u32] aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;
    assert.neq r0[3u32] aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;
    assert.neq r0[4u32] aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;
    assert.neq r0[5u32] aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;
    assert.neq r0[6u32] aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;
    assert.neq r0[7u32] aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;
    is.neq r1[0u32] 0u128 into r3;
    is.neq r1[1u32] 0u128 into r4;
    or r3 r4 into r5;
    assert.eq r5 true;
    cast r0[0u32] r1 r2 into r6 as Letter.record;
    cast r0[1u32] r1 r2 into r7 as Letter.record;
    cast r0[2u32] r1 r2 into r8 as Letter.record;
    cast r0[3u32] r1 r2 into r9 as Letter.record;
    cast r0[4u32] r1 r2 into r10 as Letter.record;
    cast r0[5u32] r1 r2 into r11 as Letter.record;
    cast r0[6u32] r1 r2 into r12 as Letter.record;
    cast r0[7u32] r1 r2 into r13 as Letter.record;
    cast self.signer r1 r2 into r14 as SentLetter.record;
    output r6 as Letter.record;
    output r7 as Letter.record;
    output r8 as Letter.record;
    output r9 as Letter.record;
    output r10 as Letter.record;
    output r11 as Letter.record;
    output r12 as Letter.record;
    output r13 as Letter.record;
    output r14 as SentLetter.record;

constructor:
    assert.eq edition 0u16;
