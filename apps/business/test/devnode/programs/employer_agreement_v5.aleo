program employer_agreement_v5.aleo;

record PendingAgreement:
    owner as address.private;
    agreement_id as [u128; 2u32].private;
    parties_key as [u128; 2u32].private;
    employer_name_hash as field.private;
    worker_name_hash as field.private;
    industry_code as u8.private;
    pay_frequency_code as u8.private;
    start_epoch as u32.private;
    end_epoch as u32.private;
    review_epoch as u32.private;
    agreement_rev as u16.private;
    schema_v as u16.private;
    policy_v as u16.private;
    terms_doc_hash as [u128; 2u32].private;
    terms_root as [u128; 2u32].private;
    offer_time_hash as [u128; 2u32].private;
    employer_address as address.private;
    worker_address as address.private;
    employer_half as [u128; 4u32].private;

record SentOffer:
    owner as address.private;
    agreement_id as [u128; 2u32].private;
    parties_key as [u128; 2u32].private;
    employer_name_hash as field.private;
    worker_name_hash as field.private;
    terms_doc_hash as [u128; 2u32].private;
    offer_time_hash as [u128; 2u32].private;
    employer_address as address.private;
    worker_address as address.private;
    employer_half as [u128; 4u32].private;

record FinalAgreement:
    owner as address.private;
    agreement_id as [u128; 2u32].private;
    parties_key as [u128; 2u32].private;
    employer_name_hash as field.private;
    worker_name_hash as field.private;
    industry_code as u8.private;
    pay_frequency_code as u8.private;
    start_epoch as u32.private;
    end_epoch as u32.private;
    review_epoch as u32.private;
    agreement_rev as u16.private;
    schema_v as u16.private;
    policy_v as u16.private;
    terms_doc_hash as [u128; 2u32].private;
    terms_root as [u128; 2u32].private;
    offer_time_hash as [u128; 2u32].private;
    accept_time_hash as [u128; 2u32].private;
    employer_address as address.private;
    worker_address as address.private;
    employer_half as [u128; 4u32].private;
    worker_half as [u128; 4u32].private;
    end_reason as u8.private;

record AgreementEnd:
    owner as address.private;
    agreement_id as [u128; 2u32].private;
    parties_key as [u128; 2u32].private;
    ended_by as address.private;
    reason as u8.private;

struct OfferTerms:
    industry_code as u8;
    pay_frequency_code as u8;
    start_epoch as u32;
    end_epoch as u32;
    review_epoch as u32;
    agreement_rev as u16;
    schema_v as u16;
    policy_v as u16;

struct OfferHashes:
    terms_doc_hash as [u128; 2u32];
    terms_root as [u128; 2u32];
    offer_time_hash as [u128; 2u32];

struct PairTagInput:
    parties_key as [u128; 2u32];
    employer as address;
    worker as address;

mapping agreement_anchor_height:
    key as [u128; 2u32].public;
    value as u32.public;

mapping agreement_status:
    key as [u128; 2u32].public;
    value as u8.public;

mapping resume_approvals:
    key as [u128; 2u32].public;
    value as u8.public;

mapping end_approvals:
    key as [u128; 2u32].public;
    value as u8.public;

mapping pair_status:
    key as field.public;
    value as u8.public;

closure pair_tag:
    input r0 as [u128; 2u32];
    input r1 as address;
    input r2 as address;
    cast r0 r1 r2 into r3 as PairTagInput;
    hash.bhp1024 r3 into r4 as field;
    output r4 as field;

function create_offer:
    input r0 as [u128; 2u32].private;
    input r1 as [u128; 2u32].private;
    input r2 as field.private;
    input r3 as field.private;
    input r4 as address.private;
    input r5 as OfferTerms.private;
    input r6 as OfferHashes.private;
    input r7 as [u128; 4u32].private;
    is.eq r5.pay_frequency_code 1u8 into r8;
    is.eq r5.pay_frequency_code 2u8 into r9;
    or r8 r9 into r10;
    is.eq r5.pay_frequency_code 3u8 into r11;
    or r10 r11 into r12;
    is.eq r5.pay_frequency_code 4u8 into r13;
    or r12 r13 into r14;
    is.eq r5.pay_frequency_code 5u8 into r15;
    or r14 r15 into r16;
    assert.eq r16 true;
    is.neq r5.agreement_rev 0u16 into r17;
    assert.eq r17 true;
    is.neq r5.schema_v 0u16 into r18;
    assert.eq r18 true;
    is.neq r5.policy_v 0u16 into r19;
    assert.eq r19 true;
    is.neq r5.end_epoch 0u32 into r20;
    gt r5.end_epoch r5.start_epoch into r21;
    not r20 into r22;
    or r21 r22 into r23;
    assert.eq r23 true;
    gte r5.review_epoch r5.start_epoch into r24;
    assert.eq r24 true;
    is.neq r4 self.signer into r25;
    assert.eq r25 true;
    is.neq r1[0u32] 0u128 into r26;
    is.neq r1[1u32] 0u128 into r27;
    or r26 r27 into r28;
    assert.eq r28 true;
    call pair_tag r1 self.signer r4 into r29;
    cast r4 r0 r1 r2 r3 r5.industry_code r5.pay_frequency_code r5.start_epoch r5.end_epoch r5.review_epoch r5.agreement_rev r5.schema_v r5.policy_v r6.terms_doc_hash r6.terms_root r6.offer_time_hash self.signer r4 r7 into r30 as PendingAgreement.record;
    cast self.signer r0 r1 r2 r3 r6.terms_doc_hash r6.offer_time_hash self.signer r4 r7 into r31 as SentOffer.record;
    async create_offer r0 r29 into r32;
    output r30 as PendingAgreement.record;
    output r31 as SentOffer.record;
    output r32 as employer_agreement_v5.aleo/create_offer.future;

finalize create_offer:
    input r0 as [u128; 2u32].public;
    input r1 as field.public;
    get.or_use agreement_anchor_height[r0] 0u32 into r2;
    is.eq r2 0u32 into r3;
    assert.eq r3 true;
    get.or_use pair_status[r1] 255u8 into r4;
    is.eq r4 255u8 into r5;
    assert.eq r5 true;
    set block.height into agreement_anchor_height[r0];
    set 0u8 into agreement_status[r0];
    set 0u8 into resume_approvals[r0];
    set 0u8 into end_approvals[r0];
    set 0u8 into pair_status[r1];

function accept_offer:
    input r0 as PendingAgreement.record;
    input r1 as [u128; 2u32].private;
    input r2 as [u128; 4u32].private;
    is.eq r0.worker_address self.signer into r3;
    assert.eq r3 true;
    call pair_tag r0.parties_key r0.employer_address r0.worker_address into r4;
    cast r0.employer_address r0.agreement_id r0.parties_key r0.employer_name_hash r0.worker_name_hash r0.industry_code r0.pay_frequency_code r0.start_epoch r0.end_epoch r0.review_epoch r0.agreement_rev r0.schema_v r0.policy_v r0.terms_doc_hash r0.terms_root r0.offer_time_hash r1 r0.employer_address r0.worker_address r0.employer_half r2 0u8 into r5 as FinalAgreement.record;
    cast r0.worker_address r0.agreement_id r0.parties_key r0.employer_name_hash r0.worker_name_hash r0.industry_code r0.pay_frequency_code r0.start_epoch r0.end_epoch r0.review_epoch r0.agreement_rev r0.schema_v r0.policy_v r0.terms_doc_hash r0.terms_root r0.offer_time_hash r1 r0.employer_address r0.worker_address r0.employer_half r2 0u8 into r6 as FinalAgreement.record;
    async accept_offer r0.agreement_id r4 into r7;
    output r5 as FinalAgreement.record;
    output r6 as FinalAgreement.record;
    output r7 as employer_agreement_v5.aleo/accept_offer.future;

finalize accept_offer:
    input r0 as [u128; 2u32].public;
    input r1 as field.public;
    get.or_use agreement_status[r0] 255u8 into r2;
    is.eq r2 0u8 into r3;
    assert.eq r3 true;
    get.or_use pair_status[r1] 255u8 into r4;
    is.eq r4 0u8 into r5;
    assert.eq r5 true;
    set 1u8 into agreement_status[r0];
    set 1u8 into pair_status[r1];

function withdraw_offer:
    input r0 as SentOffer.record;
    is.eq r0.employer_address self.signer into r1;
    assert.eq r1 true;
    call pair_tag r0.parties_key r0.employer_address r0.worker_address into r2;
    async withdraw_offer r0.agreement_id r2 into r3;
    output r3 as employer_agreement_v5.aleo/withdraw_offer.future;

finalize withdraw_offer:
    input r0 as [u128; 2u32].public;
    input r1 as field.public;
    get.or_use agreement_status[r0] 255u8 into r2;
    is.eq r2 0u8 into r3;
    assert.eq r3 true;
    set 4u8 into agreement_status[r0];
    set 4u8 into pair_status[r1];

function pause_employer:
    input r0 as FinalAgreement.record;
    is.eq r0.employer_address self.signer into r1;
    assert.eq r1 true;
    call pair_tag r0.parties_key r0.employer_address r0.worker_address into r2;
    async pause_employer r0.agreement_id r2 into r3;
    cast r0.owner r0.agreement_id r0.parties_key r0.employer_name_hash r0.worker_name_hash r0.industry_code r0.pay_frequency_code r0.start_epoch r0.end_epoch r0.review_epoch r0.agreement_rev r0.schema_v r0.policy_v r0.terms_doc_hash r0.terms_root r0.offer_time_hash r0.accept_time_hash r0.employer_address r0.worker_address r0.employer_half r0.worker_half r0.end_reason into r4 as FinalAgreement.record;
    output r4 as FinalAgreement.record;
    output r3 as employer_agreement_v5.aleo/pause_employer.future;

finalize pause_employer:
    input r0 as [u128; 2u32].public;
    input r1 as field.public;
    get.or_use agreement_status[r0] 255u8 into r2;
    is.eq r2 1u8 into r3;
    assert.eq r3 true;
    set 2u8 into agreement_status[r0];
    set 2u8 into pair_status[r1];
    set 0u8 into resume_approvals[r0];

function pause_worker:
    input r0 as FinalAgreement.record;
    is.eq r0.worker_address self.signer into r1;
    assert.eq r1 true;
    call pair_tag r0.parties_key r0.employer_address r0.worker_address into r2;
    async pause_worker r0.agreement_id r2 into r3;
    cast r0.owner r0.agreement_id r0.parties_key r0.employer_name_hash r0.worker_name_hash r0.industry_code r0.pay_frequency_code r0.start_epoch r0.end_epoch r0.review_epoch r0.agreement_rev r0.schema_v r0.policy_v r0.terms_doc_hash r0.terms_root r0.offer_time_hash r0.accept_time_hash r0.employer_address r0.worker_address r0.employer_half r0.worker_half r0.end_reason into r4 as FinalAgreement.record;
    output r4 as FinalAgreement.record;
    output r3 as employer_agreement_v5.aleo/pause_worker.future;

finalize pause_worker:
    input r0 as [u128; 2u32].public;
    input r1 as field.public;
    get.or_use agreement_status[r0] 255u8 into r2;
    is.eq r2 1u8 into r3;
    assert.eq r3 true;
    set 2u8 into agreement_status[r0];
    set 2u8 into pair_status[r1];
    set 0u8 into resume_approvals[r0];

function approve_resume_employer:
    input r0 as FinalAgreement.record;
    is.eq r0.employer_address self.signer into r1;
    assert.eq r1 true;
    async approve_resume_employer r0.agreement_id into r2;
    cast r0.owner r0.agreement_id r0.parties_key r0.employer_name_hash r0.worker_name_hash r0.industry_code r0.pay_frequency_code r0.start_epoch r0.end_epoch r0.review_epoch r0.agreement_rev r0.schema_v r0.policy_v r0.terms_doc_hash r0.terms_root r0.offer_time_hash r0.accept_time_hash r0.employer_address r0.worker_address r0.employer_half r0.worker_half r0.end_reason into r3 as FinalAgreement.record;
    output r3 as FinalAgreement.record;
    output r2 as employer_agreement_v5.aleo/approve_resume_employer.future;

finalize approve_resume_employer:
    input r0 as [u128; 2u32].public;
    get.or_use agreement_status[r0] 255u8 into r1;
    is.eq r1 2u8 into r2;
    assert.eq r2 true;
    get.or_use resume_approvals[r0] 0u8 into r3;
    or r3 1u8 into r4;
    set r4 into resume_approvals[r0];

function approve_resume_worker:
    input r0 as FinalAgreement.record;
    is.eq r0.worker_address self.signer into r1;
    assert.eq r1 true;
    async approve_resume_worker r0.agreement_id into r2;
    cast r0.owner r0.agreement_id r0.parties_key r0.employer_name_hash r0.worker_name_hash r0.industry_code r0.pay_frequency_code r0.start_epoch r0.end_epoch r0.review_epoch r0.agreement_rev r0.schema_v r0.policy_v r0.terms_doc_hash r0.terms_root r0.offer_time_hash r0.accept_time_hash r0.employer_address r0.worker_address r0.employer_half r0.worker_half r0.end_reason into r3 as FinalAgreement.record;
    output r3 as FinalAgreement.record;
    output r2 as employer_agreement_v5.aleo/approve_resume_worker.future;

finalize approve_resume_worker:
    input r0 as [u128; 2u32].public;
    get.or_use agreement_status[r0] 255u8 into r1;
    is.eq r1 2u8 into r2;
    assert.eq r2 true;
    get.or_use resume_approvals[r0] 0u8 into r3;
    or r3 2u8 into r4;
    set r4 into resume_approvals[r0];

function resume:
    input r0 as FinalAgreement.record;
    is.eq r0.employer_address self.signer into r1;
    is.eq r0.worker_address self.signer into r2;
    or r1 r2 into r3;
    assert.eq r3 true;
    call pair_tag r0.parties_key r0.employer_address r0.worker_address into r4;
    async resume r0.agreement_id r4 into r5;
    cast r0.owner r0.agreement_id r0.parties_key r0.employer_name_hash r0.worker_name_hash r0.industry_code r0.pay_frequency_code r0.start_epoch r0.end_epoch r0.review_epoch r0.agreement_rev r0.schema_v r0.policy_v r0.terms_doc_hash r0.terms_root r0.offer_time_hash r0.accept_time_hash r0.employer_address r0.worker_address r0.employer_half r0.worker_half r0.end_reason into r6 as FinalAgreement.record;
    output r6 as FinalAgreement.record;
    output r5 as employer_agreement_v5.aleo/resume.future;

finalize resume:
    input r0 as [u128; 2u32].public;
    input r1 as field.public;
    get.or_use agreement_status[r0] 255u8 into r2;
    is.eq r2 2u8 into r3;
    assert.eq r3 true;
    get.or_use resume_approvals[r0] 0u8 into r4;
    is.eq r4 3u8 into r5;
    assert.eq r5 true;
    set 1u8 into agreement_status[r0];
    set 1u8 into pair_status[r1];
    set 0u8 into resume_approvals[r0];

function terminate_employer:
    input r0 as FinalAgreement.record;
    input r1 as u8.private;
    is.eq r0.employer_address self.signer into r2;
    assert.eq r2 true;
    is.eq r1 2u8 into r3;
    is.eq r1 3u8 into r4;
    or r3 r4 into r5;
    is.eq r1 4u8 into r6;
    or r5 r6 into r7;
    assert.eq r7 true;
    call pair_tag r0.parties_key r0.employer_address r0.worker_address into r8;
    cast r0.owner r0.agreement_id r0.parties_key r0.employer_name_hash r0.worker_name_hash r0.industry_code r0.pay_frequency_code r0.start_epoch r0.end_epoch r0.review_epoch r0.agreement_rev r0.schema_v r0.policy_v r0.terms_doc_hash r0.terms_root r0.offer_time_hash r0.accept_time_hash r0.employer_address r0.worker_address r0.employer_half r0.worker_half r1 into r9 as FinalAgreement.record;
    cast r0.worker_address r0.agreement_id r0.parties_key self.signer r1 into r10 as AgreementEnd.record;
    async terminate_employer r0.agreement_id r8 into r11;
    output r9 as FinalAgreement.record;
    output r10 as AgreementEnd.record;
    output r11 as employer_agreement_v5.aleo/terminate_employer.future;

finalize terminate_employer:
    input r0 as [u128; 2u32].public;
    input r1 as field.public;
    get.or_use agreement_status[r0] 255u8 into r2;
    is.eq r2 1u8 into r3;
    is.eq r2 2u8 into r4;
    or r3 r4 into r5;
    assert.eq r5 true;
    set 3u8 into agreement_status[r0];
    set 3u8 into pair_status[r1];
    set 0u8 into resume_approvals[r0];
    set 0u8 into end_approvals[r0];

function terminate_worker:
    input r0 as FinalAgreement.record;
    input r1 as u8.private;
    is.eq r0.worker_address self.signer into r2;
    assert.eq r2 true;
    is.eq r1 1u8 into r3;
    is.eq r1 3u8 into r4;
    or r3 r4 into r5;
    assert.eq r5 true;
    call pair_tag r0.parties_key r0.employer_address r0.worker_address into r6;
    cast r0.owner r0.agreement_id r0.parties_key r0.employer_name_hash r0.worker_name_hash r0.industry_code r0.pay_frequency_code r0.start_epoch r0.end_epoch r0.review_epoch r0.agreement_rev r0.schema_v r0.policy_v r0.terms_doc_hash r0.terms_root r0.offer_time_hash r0.accept_time_hash r0.employer_address r0.worker_address r0.employer_half r0.worker_half r1 into r7 as FinalAgreement.record;
    cast r0.employer_address r0.agreement_id r0.parties_key self.signer r1 into r8 as AgreementEnd.record;
    async terminate_worker r0.agreement_id r6 into r9;
    output r7 as FinalAgreement.record;
    output r8 as AgreementEnd.record;
    output r9 as employer_agreement_v5.aleo/terminate_worker.future;

finalize terminate_worker:
    input r0 as [u128; 2u32].public;
    input r1 as field.public;
    get.or_use agreement_status[r0] 255u8 into r2;
    is.eq r2 1u8 into r3;
    is.eq r2 2u8 into r4;
    or r3 r4 into r5;
    assert.eq r5 true;
    set 3u8 into agreement_status[r0];
    set 3u8 into pair_status[r1];
    set 0u8 into resume_approvals[r0];
    set 0u8 into end_approvals[r0];

function approve_end_employer:
    input r0 as FinalAgreement.record;
    is.eq r0.employer_address self.signer into r1;
    assert.eq r1 true;
    async approve_end_employer r0.agreement_id into r2;
    cast r0.owner r0.agreement_id r0.parties_key r0.employer_name_hash r0.worker_name_hash r0.industry_code r0.pay_frequency_code r0.start_epoch r0.end_epoch r0.review_epoch r0.agreement_rev r0.schema_v r0.policy_v r0.terms_doc_hash r0.terms_root r0.offer_time_hash r0.accept_time_hash r0.employer_address r0.worker_address r0.employer_half r0.worker_half r0.end_reason into r3 as FinalAgreement.record;
    output r3 as FinalAgreement.record;
    output r2 as employer_agreement_v5.aleo/approve_end_employer.future;

finalize approve_end_employer:
    input r0 as [u128; 2u32].public;
    get.or_use agreement_status[r0] 255u8 into r1;
    is.eq r1 1u8 into r2;
    is.eq r1 2u8 into r3;
    or r2 r3 into r4;
    assert.eq r4 true;
    get.or_use end_approvals[r0] 0u8 into r5;
    or r5 1u8 into r6;
    set r6 into end_approvals[r0];

function approve_end_worker:
    input r0 as FinalAgreement.record;
    is.eq r0.worker_address self.signer into r1;
    assert.eq r1 true;
    async approve_end_worker r0.agreement_id into r2;
    cast r0.owner r0.agreement_id r0.parties_key r0.employer_name_hash r0.worker_name_hash r0.industry_code r0.pay_frequency_code r0.start_epoch r0.end_epoch r0.review_epoch r0.agreement_rev r0.schema_v r0.policy_v r0.terms_doc_hash r0.terms_root r0.offer_time_hash r0.accept_time_hash r0.employer_address r0.worker_address r0.employer_half r0.worker_half r0.end_reason into r3 as FinalAgreement.record;
    output r3 as FinalAgreement.record;
    output r2 as employer_agreement_v5.aleo/approve_end_worker.future;

finalize approve_end_worker:
    input r0 as [u128; 2u32].public;
    get.or_use agreement_status[r0] 255u8 into r1;
    is.eq r1 1u8 into r2;
    is.eq r1 2u8 into r3;
    or r2 r3 into r4;
    assert.eq r4 true;
    get.or_use end_approvals[r0] 0u8 into r5;
    or r5 2u8 into r6;
    set r6 into end_approvals[r0];

function end_mutual:
    input r0 as FinalAgreement.record;
    is.eq r0.employer_address self.signer into r1;
    is.eq r0.worker_address self.signer into r2;
    or r1 r2 into r3;
    assert.eq r3 true;
    call pair_tag r0.parties_key r0.employer_address r0.worker_address into r4;
    cast r0.owner r0.agreement_id r0.parties_key r0.employer_name_hash r0.worker_name_hash r0.industry_code r0.pay_frequency_code r0.start_epoch r0.end_epoch r0.review_epoch r0.agreement_rev r0.schema_v r0.policy_v r0.terms_doc_hash r0.terms_root r0.offer_time_hash r0.accept_time_hash r0.employer_address r0.worker_address r0.employer_half r0.worker_half 5u8 into r5 as FinalAgreement.record;
    ternary r1 r0.worker_address r0.employer_address into r6;
    cast r6 r0.agreement_id r0.parties_key self.signer 5u8 into r7 as AgreementEnd.record;
    async end_mutual r0.agreement_id r4 into r8;
    output r5 as FinalAgreement.record;
    output r7 as AgreementEnd.record;
    output r8 as employer_agreement_v5.aleo/end_mutual.future;

finalize end_mutual:
    input r0 as [u128; 2u32].public;
    input r1 as field.public;
    get.or_use end_approvals[r0] 0u8 into r2;
    is.eq r2 3u8 into r3;
    assert.eq r3 true;
    get.or_use agreement_status[r0] 255u8 into r4;
    is.eq r4 1u8 into r5;
    is.eq r4 2u8 into r6;
    or r5 r6 into r7;
    assert.eq r7 true;
    set 3u8 into agreement_status[r0];
    set 3u8 into pair_status[r1];
    set 0u8 into resume_approvals[r0];
    set 0u8 into end_approvals[r0];

function assert_pair_active:
    input r0 as [u128; 2u32].private;
    input r1 as address.private;
    input r2 as address.private;
    call pair_tag r0 r1 r2 into r3;
    async assert_pair_active r3 into r4;
    output r4 as employer_agreement_v5.aleo/assert_pair_active.future;

finalize assert_pair_active:
    input r0 as field.public;
    get.or_use pair_status[r0] 255u8 into r1;
    is.eq r1 1u8 into r2;
    assert.eq r2 true;

function assert_pair_agreed:
    input r0 as [u128; 2u32].private;
    input r1 as address.private;
    input r2 as address.private;
    call pair_tag r0 r1 r2 into r3;
    async assert_pair_agreed r3 into r4;
    output r4 as employer_agreement_v5.aleo/assert_pair_agreed.future;

finalize assert_pair_agreed:
    input r0 as field.public;
    get.or_use pair_status[r0] 255u8 into r1;
    is.eq r1 1u8 into r2;
    is.eq r1 2u8 into r3;
    or r2 r3 into r4;
    is.eq r1 3u8 into r5;
    or r4 r5 into r6;
    assert.eq r6 true;

constructor:
    assert.eq edition 0u16;
