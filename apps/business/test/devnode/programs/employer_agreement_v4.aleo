import pnw_name_registry_v2.aleo;
import employer_license_registry.aleo;

program employer_agreement_v4.aleo;

record PendingAgreement:
    owner as address.private;
    agreement_id as [u8; 32u32].private;
    parties_key as [u8; 32u32].private;
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
    terms_doc_hash as [u8; 32u32].private;
    terms_root as [u8; 32u32].private;
    offer_height as u32.private;
    offer_time_hash as [u8; 32u32].private;
    employer_address as address.private;
    worker_address as address.private;

record FinalAgreement:
    owner as address.private;
    agreement_id as [u8; 32u32].private;
    parties_key as [u8; 32u32].private;
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
    terms_doc_hash as [u8; 32u32].private;
    terms_root as [u8; 32u32].private;
    offer_height as u32.private;
    offer_time_hash as [u8; 32u32].private;
    accept_height as u32.private;
    accept_time_hash as [u8; 32u32].private;
    employer_address as address.private;
    worker_address as address.private;

struct PartiesCommitmentInput:
    parties_key as [u8; 32u32];
    employer_name_hash as field;
    worker_name_hash as field;

mapping agreement_anchor_height:
    key as [u8; 32u32].public;
    value as u32.public;

mapping agreement_parties_commitment:
    key as [u8; 32u32].public;
    value as field.public;

mapping agreement_status:
    key as [u8; 32u32].public;
    value as u8.public;

mapping resume_approvals:
    key as [u8; 32u32].public;
    value as u8.public;

closure compute_parties_commitment:
    input r0 as [u8; 32u32];
    input r1 as field;
    input r2 as field;
    cast r0 r1 r2 into r3 as PartiesCommitmentInput;
    hash.bhp1024 r3 into r4 as field;
    output r4 as field;

function create_job_offer:
    input r0 as [u8; 32u32].private;
    input r1 as [u8; 32u32].private;
    input r2 as field.private;
    input r3 as field.private;
    input r4 as address.private;
    input r5 as u8.private;
    input r6 as u8.private;
    input r7 as u32.private;
    input r8 as u32.private;
    input r9 as u32.private;
    input r10 as u16.private;
    input r11 as u16.private;
    input r12 as u16.private;
    input r13 as [u8; 32u32].private;
    input r14 as [u8; 32u32].private;
    input r15 as [u8; 32u32].private;
    is.eq r6 1u8 into r16;
    is.eq r6 2u8 into r17;
    or r16 r17 into r18;
    is.eq r6 3u8 into r19;
    or r18 r19 into r20;
    is.eq r6 4u8 into r21;
    or r20 r21 into r22;
    is.eq r6 5u8 into r23;
    or r22 r23 into r24;
    assert.eq r24 true;
    is.neq r10 0u16 into r25;
    assert.eq r25 true;
    is.neq r11 0u16 into r26;
    assert.eq r26 true;
    is.neq r12 0u16 into r27;
    assert.eq r27 true;
    is.neq r8 0u32 into r28;
    gt r8 r7 into r29;
    not r28 into r30;
    or r29 r30 into r31;
    assert.eq r31 true;
    gte r9 r7 into r32;
    assert.eq r32 true;
    call employer_license_registry.aleo/assert_verified self.caller into r33;
    call pnw_name_registry_v2.aleo/assert_is_owner r2 self.caller into r34;
    call compute_parties_commitment r1 r2 r3 into r35;
    cast r4 r0 r1 r2 r3 r5 r6 r7 r8 r9 r10 r11 r12 r13 r14 0u32 r15 self.caller r4 into r36 as PendingAgreement.record;
    async create_job_offer r33 r34 r0 r35 into r37;
    output r36 as PendingAgreement.record;
    output r37 as employer_agreement_v4.aleo/create_job_offer.future;

finalize create_job_offer:
    input r0 as employer_license_registry.aleo/assert_verified.future;
    input r1 as pnw_name_registry_v2.aleo/assert_is_owner.future;
    input r2 as [u8; 32u32].public;
    input r3 as field.public;
    await r0;
    await r1;
    get.or_use agreement_anchor_height[r2] 0u32 into r4;
    is.eq r4 0u32 into r5;
    assert.eq r5 true;
    set block.height into agreement_anchor_height[r2];
    set r3 into agreement_parties_commitment[r2];
    set 0u8 into agreement_status[r2];
    set 0u8 into resume_approvals[r2];

function accept_job_offer:
    input r0 as PendingAgreement.record;
    input r1 as [u8; 32u32].private;
    is.eq r0.worker_address self.caller into r2;
    assert.eq r2 true;
    call pnw_name_registry_v2.aleo/assert_is_owner r0.worker_name_hash self.caller into r3;
    call compute_parties_commitment r0.parties_key r0.employer_name_hash r0.worker_name_hash into r4;
    cast r0.employer_address r0.agreement_id r0.parties_key r0.employer_name_hash r0.worker_name_hash r0.industry_code r0.pay_frequency_code r0.start_epoch r0.end_epoch r0.review_epoch r0.agreement_rev r0.schema_v r0.policy_v r0.terms_doc_hash r0.terms_root r0.offer_height r0.offer_time_hash 0u32 r1 r0.employer_address r0.worker_address into r5 as FinalAgreement.record;
    cast r0.worker_address r0.agreement_id r0.parties_key r0.employer_name_hash r0.worker_name_hash r0.industry_code r0.pay_frequency_code r0.start_epoch r0.end_epoch r0.review_epoch r0.agreement_rev r0.schema_v r0.policy_v r0.terms_doc_hash r0.terms_root r0.offer_height r0.offer_time_hash 0u32 r1 r0.employer_address r0.worker_address into r6 as FinalAgreement.record;
    cast aleo1s8t86aza932zah3mv5knclvnn5zy4gedpl5a4wn5h2yrt08mxqzsw5amdd r0.agreement_id r0.parties_key r0.employer_name_hash r0.worker_name_hash r0.industry_code r0.pay_frequency_code r0.start_epoch r0.end_epoch r0.review_epoch r0.agreement_rev r0.schema_v r0.policy_v r0.terms_doc_hash r0.terms_root r0.offer_height r0.offer_time_hash 0u32 r1 r0.employer_address r0.worker_address into r7 as FinalAgreement.record;
    async accept_job_offer r3 r0.agreement_id r4 into r8;
    output r5 as FinalAgreement.record;
    output r6 as FinalAgreement.record;
    output r7 as FinalAgreement.record;
    output r8 as employer_agreement_v4.aleo/accept_job_offer.future;

finalize accept_job_offer:
    input r0 as pnw_name_registry_v2.aleo/assert_is_owner.future;
    input r1 as [u8; 32u32].public;
    input r2 as field.public;
    await r0;
    get.or_use agreement_anchor_height[r1] 0u32 into r3;
    is.neq r3 0u32 into r4;
    assert.eq r4 true;
    get.or_use agreement_status[r1] 255u8 into r5;
    is.eq r5 0u8 into r6;
    assert.eq r6 true;
    get.or_use agreement_parties_commitment[r1] 0field into r7;
    is.neq r7 0field into r8;
    assert.eq r8 true;
    is.eq r7 r2 into r9;
    assert.eq r9 true;
    set 1u8 into agreement_status[r1];
    set 0u8 into resume_approvals[r1];

function pause_agreement_employer:
    input r0 as [u8; 32u32].private;
    input r1 as [u8; 32u32].private;
    input r2 as field.private;
    input r3 as field.private;
    call employer_license_registry.aleo/assert_verified self.caller into r4;
    call pnw_name_registry_v2.aleo/assert_is_owner r2 self.caller into r5;
    call compute_parties_commitment r1 r2 r3 into r6;
    async pause_agreement_employer r4 r5 r0 r6 into r7;
    output r7 as employer_agreement_v4.aleo/pause_agreement_employer.future;

finalize pause_agreement_employer:
    input r0 as employer_license_registry.aleo/assert_verified.future;
    input r1 as pnw_name_registry_v2.aleo/assert_is_owner.future;
    input r2 as [u8; 32u32].public;
    input r3 as field.public;
    await r0;
    await r1;
    get.or_use agreement_anchor_height[r2] 0u32 into r4;
    is.neq r4 0u32 into r5;
    assert.eq r5 true;
    get.or_use agreement_parties_commitment[r2] 0field into r6;
    is.neq r6 0field into r7;
    assert.eq r7 true;
    is.eq r6 r3 into r8;
    assert.eq r8 true;
    get.or_use agreement_status[r2] 255u8 into r9;
    is.eq r9 0u8 into r10;
    is.eq r9 1u8 into r11;
    or r10 r11 into r12;
    is.eq r9 2u8 into r13;
    or r12 r13 into r14;
    is.eq r9 3u8 into r15;
    or r14 r15 into r16;
    is.eq r9 4u8 into r17;
    or r16 r17 into r18;
    assert.eq r18 true;
    assert.eq r11 true;
    set 2u8 into agreement_status[r2];
    set 0u8 into resume_approvals[r2];

function pause_agreement_worker:
    input r0 as [u8; 32u32].private;
    input r1 as [u8; 32u32].private;
    input r2 as field.private;
    input r3 as field.private;
    call pnw_name_registry_v2.aleo/assert_is_owner r3 self.caller into r4;
    call compute_parties_commitment r1 r2 r3 into r5;
    async pause_agreement_worker r4 r0 r5 into r6;
    output r6 as employer_agreement_v4.aleo/pause_agreement_worker.future;

finalize pause_agreement_worker:
    input r0 as pnw_name_registry_v2.aleo/assert_is_owner.future;
    input r1 as [u8; 32u32].public;
    input r2 as field.public;
    await r0;
    get.or_use agreement_anchor_height[r1] 0u32 into r3;
    is.neq r3 0u32 into r4;
    assert.eq r4 true;
    get.or_use agreement_parties_commitment[r1] 0field into r5;
    is.neq r5 0field into r6;
    assert.eq r6 true;
    is.eq r5 r2 into r7;
    assert.eq r7 true;
    get.or_use agreement_status[r1] 255u8 into r8;
    is.eq r8 0u8 into r9;
    is.eq r8 1u8 into r10;
    or r9 r10 into r11;
    is.eq r8 2u8 into r12;
    or r11 r12 into r13;
    is.eq r8 3u8 into r14;
    or r13 r14 into r15;
    is.eq r8 4u8 into r16;
    or r15 r16 into r17;
    assert.eq r17 true;
    assert.eq r10 true;
    set 2u8 into agreement_status[r1];
    set 0u8 into resume_approvals[r1];

function pause_agreement_dao:
    input r0 as [u8; 32u32].private;
    input r1 as [u8; 32u32].private;
    input r2 as field.private;
    input r3 as field.private;
    is.eq self.caller aleo1s8t86aza932zah3mv5knclvnn5zy4gedpl5a4wn5h2yrt08mxqzsw5amdd into r4;
    assert.eq r4 true;
    call compute_parties_commitment r1 r2 r3 into r5;
    async pause_agreement_dao r0 r5 into r6;
    output r6 as employer_agreement_v4.aleo/pause_agreement_dao.future;

finalize pause_agreement_dao:
    input r0 as [u8; 32u32].public;
    input r1 as field.public;
    get.or_use agreement_anchor_height[r0] 0u32 into r2;
    is.neq r2 0u32 into r3;
    assert.eq r3 true;
    get.or_use agreement_parties_commitment[r0] 0field into r4;
    is.neq r4 0field into r5;
    assert.eq r5 true;
    is.eq r4 r1 into r6;
    assert.eq r6 true;
    get.or_use agreement_status[r0] 255u8 into r7;
    is.eq r7 0u8 into r8;
    is.eq r7 1u8 into r9;
    or r8 r9 into r10;
    is.eq r7 2u8 into r11;
    or r10 r11 into r12;
    is.eq r7 3u8 into r13;
    or r12 r13 into r14;
    is.eq r7 4u8 into r15;
    or r14 r15 into r16;
    assert.eq r16 true;
    assert.eq r9 true;
    set 2u8 into agreement_status[r0];
    set 0u8 into resume_approvals[r0];

function terminate_agreement_employer:
    input r0 as [u8; 32u32].private;
    input r1 as [u8; 32u32].private;
    input r2 as field.private;
    input r3 as field.private;
    call employer_license_registry.aleo/assert_verified self.caller into r4;
    call pnw_name_registry_v2.aleo/assert_is_owner r2 self.caller into r5;
    call compute_parties_commitment r1 r2 r3 into r6;
    async terminate_agreement_employer r4 r5 r0 r6 into r7;
    output r7 as employer_agreement_v4.aleo/terminate_agreement_employer.future;

finalize terminate_agreement_employer:
    input r0 as employer_license_registry.aleo/assert_verified.future;
    input r1 as pnw_name_registry_v2.aleo/assert_is_owner.future;
    input r2 as [u8; 32u32].public;
    input r3 as field.public;
    await r0;
    await r1;
    get.or_use agreement_anchor_height[r2] 0u32 into r4;
    is.neq r4 0u32 into r5;
    assert.eq r5 true;
    get.or_use agreement_parties_commitment[r2] 0field into r6;
    is.neq r6 0field into r7;
    assert.eq r7 true;
    is.eq r6 r3 into r8;
    assert.eq r8 true;
    get.or_use agreement_status[r2] 255u8 into r9;
    is.eq r9 0u8 into r10;
    is.eq r9 1u8 into r11;
    or r10 r11 into r12;
    is.eq r9 2u8 into r13;
    or r12 r13 into r14;
    is.eq r9 3u8 into r15;
    or r14 r15 into r16;
    is.eq r9 4u8 into r17;
    or r16 r17 into r18;
    assert.eq r18 true;
    is.neq r9 3u8 into r19;
    assert.eq r19 true;
    set 3u8 into agreement_status[r2];
    set 0u8 into resume_approvals[r2];

function terminate_agreement_worker:
    input r0 as [u8; 32u32].private;
    input r1 as [u8; 32u32].private;
    input r2 as field.private;
    input r3 as field.private;
    call pnw_name_registry_v2.aleo/assert_is_owner r3 self.caller into r4;
    call compute_parties_commitment r1 r2 r3 into r5;
    async terminate_agreement_worker r4 r0 r5 into r6;
    output r6 as employer_agreement_v4.aleo/terminate_agreement_worker.future;

finalize terminate_agreement_worker:
    input r0 as pnw_name_registry_v2.aleo/assert_is_owner.future;
    input r1 as [u8; 32u32].public;
    input r2 as field.public;
    await r0;
    get.or_use agreement_anchor_height[r1] 0u32 into r3;
    is.neq r3 0u32 into r4;
    assert.eq r4 true;
    get.or_use agreement_parties_commitment[r1] 0field into r5;
    is.neq r5 0field into r6;
    assert.eq r6 true;
    is.eq r5 r2 into r7;
    assert.eq r7 true;
    get.or_use agreement_status[r1] 255u8 into r8;
    is.eq r8 0u8 into r9;
    is.eq r8 1u8 into r10;
    or r9 r10 into r11;
    is.eq r8 2u8 into r12;
    or r11 r12 into r13;
    is.eq r8 3u8 into r14;
    or r13 r14 into r15;
    is.eq r8 4u8 into r16;
    or r15 r16 into r17;
    assert.eq r17 true;
    is.neq r8 3u8 into r18;
    assert.eq r18 true;
    set 3u8 into agreement_status[r1];
    set 0u8 into resume_approvals[r1];

function terminate_agreement_dao:
    input r0 as [u8; 32u32].private;
    input r1 as [u8; 32u32].private;
    input r2 as field.private;
    input r3 as field.private;
    is.eq self.caller aleo1s8t86aza932zah3mv5knclvnn5zy4gedpl5a4wn5h2yrt08mxqzsw5amdd into r4;
    assert.eq r4 true;
    call compute_parties_commitment r1 r2 r3 into r5;
    async terminate_agreement_dao r0 r5 into r6;
    output r6 as employer_agreement_v4.aleo/terminate_agreement_dao.future;

finalize terminate_agreement_dao:
    input r0 as [u8; 32u32].public;
    input r1 as field.public;
    get.or_use agreement_anchor_height[r0] 0u32 into r2;
    is.neq r2 0u32 into r3;
    assert.eq r3 true;
    get.or_use agreement_parties_commitment[r0] 0field into r4;
    is.neq r4 0field into r5;
    assert.eq r5 true;
    is.eq r4 r1 into r6;
    assert.eq r6 true;
    get.or_use agreement_status[r0] 255u8 into r7;
    is.eq r7 0u8 into r8;
    is.eq r7 1u8 into r9;
    or r8 r9 into r10;
    is.eq r7 2u8 into r11;
    or r10 r11 into r12;
    is.eq r7 3u8 into r13;
    or r12 r13 into r14;
    is.eq r7 4u8 into r15;
    or r14 r15 into r16;
    assert.eq r16 true;
    is.neq r7 3u8 into r17;
    assert.eq r17 true;
    set 3u8 into agreement_status[r0];
    set 0u8 into resume_approvals[r0];

function approve_resume_employer:
    input r0 as [u8; 32u32].private;
    input r1 as [u8; 32u32].private;
    input r2 as field.private;
    input r3 as field.private;
    call employer_license_registry.aleo/assert_verified self.caller into r4;
    call pnw_name_registry_v2.aleo/assert_is_owner r2 self.caller into r5;
    call compute_parties_commitment r1 r2 r3 into r6;
    async approve_resume_employer r4 r5 r0 r6 into r7;
    output r7 as employer_agreement_v4.aleo/approve_resume_employer.future;

finalize approve_resume_employer:
    input r0 as employer_license_registry.aleo/assert_verified.future;
    input r1 as pnw_name_registry_v2.aleo/assert_is_owner.future;
    input r2 as [u8; 32u32].public;
    input r3 as field.public;
    await r0;
    await r1;
    get.or_use agreement_anchor_height[r2] 0u32 into r4;
    is.neq r4 0u32 into r5;
    assert.eq r5 true;
    get.or_use agreement_parties_commitment[r2] 0field into r6;
    is.neq r6 0field into r7;
    assert.eq r7 true;
    is.eq r6 r3 into r8;
    assert.eq r8 true;
    get.or_use agreement_status[r2] 255u8 into r9;
    is.eq r9 0u8 into r10;
    is.eq r9 1u8 into r11;
    or r10 r11 into r12;
    is.eq r9 2u8 into r13;
    or r12 r13 into r14;
    is.eq r9 3u8 into r15;
    or r14 r15 into r16;
    is.eq r9 4u8 into r17;
    or r16 r17 into r18;
    assert.eq r18 true;
    assert.eq r13 true;
    get.or_use resume_approvals[r2] 0u8 into r19;
    or r19 1u8 into r20;
    set r20 into resume_approvals[r2];

function approve_resume_worker:
    input r0 as [u8; 32u32].private;
    input r1 as [u8; 32u32].private;
    input r2 as field.private;
    input r3 as field.private;
    call pnw_name_registry_v2.aleo/assert_is_owner r3 self.caller into r4;
    call compute_parties_commitment r1 r2 r3 into r5;
    async approve_resume_worker r4 r0 r5 into r6;
    output r6 as employer_agreement_v4.aleo/approve_resume_worker.future;

finalize approve_resume_worker:
    input r0 as pnw_name_registry_v2.aleo/assert_is_owner.future;
    input r1 as [u8; 32u32].public;
    input r2 as field.public;
    await r0;
    get.or_use agreement_anchor_height[r1] 0u32 into r3;
    is.neq r3 0u32 into r4;
    assert.eq r4 true;
    get.or_use agreement_parties_commitment[r1] 0field into r5;
    is.neq r5 0field into r6;
    assert.eq r6 true;
    is.eq r5 r2 into r7;
    assert.eq r7 true;
    get.or_use agreement_status[r1] 255u8 into r8;
    is.eq r8 0u8 into r9;
    is.eq r8 1u8 into r10;
    or r9 r10 into r11;
    is.eq r8 2u8 into r12;
    or r11 r12 into r13;
    is.eq r8 3u8 into r14;
    or r13 r14 into r15;
    is.eq r8 4u8 into r16;
    or r15 r16 into r17;
    assert.eq r17 true;
    assert.eq r12 true;
    get.or_use resume_approvals[r1] 0u8 into r18;
    or r18 2u8 into r19;
    set r19 into resume_approvals[r1];

function approve_resume_dao:
    input r0 as [u8; 32u32].private;
    input r1 as [u8; 32u32].private;
    input r2 as field.private;
    input r3 as field.private;
    is.eq self.caller aleo1s8t86aza932zah3mv5knclvnn5zy4gedpl5a4wn5h2yrt08mxqzsw5amdd into r4;
    assert.eq r4 true;
    call compute_parties_commitment r1 r2 r3 into r5;
    async approve_resume_dao r0 r5 into r6;
    output r6 as employer_agreement_v4.aleo/approve_resume_dao.future;

finalize approve_resume_dao:
    input r0 as [u8; 32u32].public;
    input r1 as field.public;
    get.or_use agreement_anchor_height[r0] 0u32 into r2;
    is.neq r2 0u32 into r3;
    assert.eq r3 true;
    get.or_use agreement_parties_commitment[r0] 0field into r4;
    is.neq r4 0field into r5;
    assert.eq r5 true;
    is.eq r4 r1 into r6;
    assert.eq r6 true;
    get.or_use agreement_status[r0] 255u8 into r7;
    is.eq r7 0u8 into r8;
    is.eq r7 1u8 into r9;
    or r8 r9 into r10;
    is.eq r7 2u8 into r11;
    or r10 r11 into r12;
    is.eq r7 3u8 into r13;
    or r12 r13 into r14;
    is.eq r7 4u8 into r15;
    or r14 r15 into r16;
    assert.eq r16 true;
    assert.eq r11 true;
    get.or_use resume_approvals[r0] 0u8 into r17;
    or r17 4u8 into r18;
    set r18 into resume_approvals[r0];

function resume_agreement:
    input r0 as [u8; 32u32].private;
    input r1 as [u8; 32u32].private;
    input r2 as field.private;
    input r3 as field.private;
    call compute_parties_commitment r1 r2 r3 into r4;
    async resume_agreement r0 r4 into r5;
    output r5 as employer_agreement_v4.aleo/resume_agreement.future;

finalize resume_agreement:
    input r0 as [u8; 32u32].public;
    input r1 as field.public;
    get.or_use agreement_anchor_height[r0] 0u32 into r2;
    is.neq r2 0u32 into r3;
    assert.eq r3 true;
    get.or_use agreement_parties_commitment[r0] 0field into r4;
    is.neq r4 0field into r5;
    assert.eq r5 true;
    is.eq r4 r1 into r6;
    assert.eq r6 true;
    get.or_use agreement_status[r0] 255u8 into r7;
    is.eq r7 0u8 into r8;
    is.eq r7 1u8 into r9;
    or r8 r9 into r10;
    is.eq r7 2u8 into r11;
    or r10 r11 into r12;
    is.eq r7 3u8 into r13;
    or r12 r13 into r14;
    is.eq r7 4u8 into r15;
    or r14 r15 into r16;
    assert.eq r16 true;
    assert.eq r11 true;
    get.or_use resume_approvals[r0] 0u8 into r17;
    is.eq r17 7u8 into r18;
    assert.eq r18 true;
    set 1u8 into agreement_status[r0];
    set 0u8 into resume_approvals[r0];

function supersede_agreement:
    input r0 as [u8; 32u32].private;
    input r1 as [u8; 32u32].private;
    input r2 as field.private;
    input r3 as field.private;
    call compute_parties_commitment r1 r2 r3 into r4;
    async supersede_agreement r0 r4 into r5;
    output r5 as employer_agreement_v4.aleo/supersede_agreement.future;

finalize supersede_agreement:
    input r0 as [u8; 32u32].public;
    input r1 as field.public;
    get.or_use agreement_anchor_height[r0] 0u32 into r2;
    is.neq r2 0u32 into r3;
    assert.eq r3 true;
    get.or_use agreement_parties_commitment[r0] 0field into r4;
    is.neq r4 0field into r5;
    assert.eq r5 true;
    is.eq r4 r1 into r6;
    assert.eq r6 true;
    get.or_use agreement_status[r0] 255u8 into r7;
    is.eq r7 0u8 into r8;
    is.eq r7 1u8 into r9;
    or r8 r9 into r10;
    is.eq r7 2u8 into r11;
    or r10 r11 into r12;
    is.eq r7 3u8 into r13;
    or r12 r13 into r14;
    is.eq r7 4u8 into r15;
    or r14 r15 into r16;
    assert.eq r16 true;
    is.neq r7 4u8 into r17;
    assert.eq r17 true;
    set 4u8 into agreement_status[r0];
    set 0u8 into resume_approvals[r0];

function assert_agreement_anchored:
    input r0 as [u8; 32u32].private;
    async assert_agreement_anchored r0 into r1;
    output r1 as employer_agreement_v4.aleo/assert_agreement_anchored.future;

finalize assert_agreement_anchored:
    input r0 as [u8; 32u32].public;
    get.or_use agreement_anchor_height[r0] 0u32 into r1;
    is.neq r1 0u32 into r2;
    assert.eq r2 true;

function assert_agreement_active:
    input r0 as [u8; 32u32].private;
    async assert_agreement_active r0 into r1;
    output r1 as employer_agreement_v4.aleo/assert_agreement_active.future;

finalize assert_agreement_active:
    input r0 as [u8; 32u32].public;
    get.or_use agreement_status[r0] 255u8 into r1;
    is.eq r1 1u8 into r2;
    assert.eq r2 true;

function assert_employer_authorized:
    input r0 as [u8; 32u32].private;
    input r1 as [u8; 32u32].private;
    input r2 as field.private;
    input r3 as field.private;
    call compute_parties_commitment r1 r2 r3 into r4;
    async assert_employer_authorized r0 r4 into r5;
    output r5 as employer_agreement_v4.aleo/assert_employer_authorized.future;

finalize assert_employer_authorized:
    input r0 as [u8; 32u32].public;
    input r1 as field.public;
    get.or_use agreement_anchor_height[r0] 0u32 into r2;
    is.neq r2 0u32 into r3;
    assert.eq r3 true;
    get.or_use agreement_parties_commitment[r0] 0field into r4;
    is.neq r4 0field into r5;
    assert.eq r5 true;
    is.eq r4 r1 into r6;
    assert.eq r6 true;
    get.or_use agreement_status[r0] 255u8 into r7;
    is.eq r7 0u8 into r8;
    is.eq r7 1u8 into r9;
    or r8 r9 into r10;
    is.eq r7 2u8 into r11;
    or r10 r11 into r12;
    is.eq r7 3u8 into r13;
    or r12 r13 into r14;
    is.eq r7 4u8 into r15;
    or r14 r15 into r16;
    assert.eq r16 true;
    assert.eq r9 true;

function create_offer_open:
    input r0 as [u8; 32u32].private;
    input r1 as [u8; 32u32].private;
    input r2 as field.private;
    input r3 as field.private;
    input r4 as address.private;
    input r5 as u8.private;
    input r6 as u8.private;
    input r7 as u32.private;
    input r8 as u32.private;
    input r9 as u32.private;
    input r10 as u16.private;
    input r11 as u16.private;
    input r12 as u16.private;
    input r13 as [u8; 32u32].private;
    input r14 as [u8; 32u32].private;
    input r15 as [u8; 32u32].private;
    is.eq r6 1u8 into r16;
    is.eq r6 2u8 into r17;
    or r16 r17 into r18;
    is.eq r6 3u8 into r19;
    or r18 r19 into r20;
    is.eq r6 4u8 into r21;
    or r20 r21 into r22;
    is.eq r6 5u8 into r23;
    or r22 r23 into r24;
    assert.eq r24 true;
    is.neq r10 0u16 into r25;
    assert.eq r25 true;
    is.neq r11 0u16 into r26;
    assert.eq r26 true;
    is.neq r12 0u16 into r27;
    assert.eq r27 true;
    is.neq r8 0u32 into r28;
    gt r8 r7 into r29;
    not r28 into r30;
    or r29 r30 into r31;
    assert.eq r31 true;
    gte r9 r7 into r32;
    assert.eq r32 true;
    call pnw_name_registry_v2.aleo/assert_is_owner r2 self.caller into r33;
    call compute_parties_commitment r1 r2 r3 into r34;
    cast r4 r0 r1 r2 r3 r5 r6 r7 r8 r9 r10 r11 r12 r13 r14 0u32 r15 self.caller r4 into r35 as PendingAgreement.record;
    async create_offer_open r33 r0 r34 into r36;
    output r35 as PendingAgreement.record;
    output r36 as employer_agreement_v4.aleo/create_offer_open.future;

finalize create_offer_open:
    input r0 as pnw_name_registry_v2.aleo/assert_is_owner.future;
    input r1 as [u8; 32u32].public;
    input r2 as field.public;
    await r0;
    get.or_use agreement_anchor_height[r1] 0u32 into r3;
    is.eq r3 0u32 into r4;
    assert.eq r4 true;
    set block.height into agreement_anchor_height[r1];
    set r2 into agreement_parties_commitment[r1];
    set 0u8 into agreement_status[r1];
    set 0u8 into resume_approvals[r1];

function pause_employer_open:
    input r0 as [u8; 32u32].private;
    input r1 as [u8; 32u32].private;
    input r2 as field.private;
    input r3 as field.private;
    call pnw_name_registry_v2.aleo/assert_is_owner r2 self.caller into r4;
    call compute_parties_commitment r1 r2 r3 into r5;
    async pause_employer_open r4 r0 r5 into r6;
    output r6 as employer_agreement_v4.aleo/pause_employer_open.future;

finalize pause_employer_open:
    input r0 as pnw_name_registry_v2.aleo/assert_is_owner.future;
    input r1 as [u8; 32u32].public;
    input r2 as field.public;
    await r0;
    get.or_use agreement_anchor_height[r1] 0u32 into r3;
    is.neq r3 0u32 into r4;
    assert.eq r4 true;
    get.or_use agreement_parties_commitment[r1] 0field into r5;
    is.neq r5 0field into r6;
    assert.eq r6 true;
    is.eq r5 r2 into r7;
    assert.eq r7 true;
    get.or_use agreement_status[r1] 255u8 into r8;
    is.eq r8 0u8 into r9;
    is.eq r8 1u8 into r10;
    or r9 r10 into r11;
    is.eq r8 2u8 into r12;
    or r11 r12 into r13;
    is.eq r8 3u8 into r14;
    or r13 r14 into r15;
    is.eq r8 4u8 into r16;
    or r15 r16 into r17;
    assert.eq r17 true;
    assert.eq r10 true;
    set 2u8 into agreement_status[r1];
    set 0u8 into resume_approvals[r1];

function terminate_employer_open:
    input r0 as [u8; 32u32].private;
    input r1 as [u8; 32u32].private;
    input r2 as field.private;
    input r3 as field.private;
    call pnw_name_registry_v2.aleo/assert_is_owner r2 self.caller into r4;
    call compute_parties_commitment r1 r2 r3 into r5;
    async terminate_employer_open r4 r0 r5 into r6;
    output r6 as employer_agreement_v4.aleo/terminate_employer_open.future;

finalize terminate_employer_open:
    input r0 as pnw_name_registry_v2.aleo/assert_is_owner.future;
    input r1 as [u8; 32u32].public;
    input r2 as field.public;
    await r0;
    get.or_use agreement_anchor_height[r1] 0u32 into r3;
    is.neq r3 0u32 into r4;
    assert.eq r4 true;
    get.or_use agreement_parties_commitment[r1] 0field into r5;
    is.neq r5 0field into r6;
    assert.eq r6 true;
    is.eq r5 r2 into r7;
    assert.eq r7 true;
    get.or_use agreement_status[r1] 255u8 into r8;
    is.eq r8 0u8 into r9;
    is.eq r8 1u8 into r10;
    or r9 r10 into r11;
    is.eq r8 2u8 into r12;
    or r11 r12 into r13;
    is.eq r8 3u8 into r14;
    or r13 r14 into r15;
    is.eq r8 4u8 into r16;
    or r15 r16 into r17;
    assert.eq r17 true;
    is.neq r8 3u8 into r18;
    assert.eq r18 true;
    set 3u8 into agreement_status[r1];
    set 0u8 into resume_approvals[r1];

function resume_employer_open:
    input r0 as [u8; 32u32].private;
    input r1 as [u8; 32u32].private;
    input r2 as field.private;
    input r3 as field.private;
    call pnw_name_registry_v2.aleo/assert_is_owner r2 self.caller into r4;
    call compute_parties_commitment r1 r2 r3 into r5;
    async resume_employer_open r4 r0 r5 into r6;
    output r6 as employer_agreement_v4.aleo/resume_employer_open.future;

finalize resume_employer_open:
    input r0 as pnw_name_registry_v2.aleo/assert_is_owner.future;
    input r1 as [u8; 32u32].public;
    input r2 as field.public;
    await r0;
    get.or_use agreement_anchor_height[r1] 0u32 into r3;
    is.neq r3 0u32 into r4;
    assert.eq r4 true;
    get.or_use agreement_parties_commitment[r1] 0field into r5;
    is.neq r5 0field into r6;
    assert.eq r6 true;
    is.eq r5 r2 into r7;
    assert.eq r7 true;
    get.or_use agreement_status[r1] 255u8 into r8;
    is.eq r8 0u8 into r9;
    is.eq r8 1u8 into r10;
    or r9 r10 into r11;
    is.eq r8 2u8 into r12;
    or r11 r12 into r13;
    is.eq r8 3u8 into r14;
    or r13 r14 into r15;
    is.eq r8 4u8 into r16;
    or r15 r16 into r17;
    assert.eq r17 true;
    assert.eq r12 true;
    get.or_use resume_approvals[r1] 0u8 into r18;
    or r18 1u8 into r19;
    set r19 into resume_approvals[r1];

constructor:
    assert.eq program_owner aleo1a2qje865a7ccrrwg37z6e36uyjtqlm5vdj8yzlrhypvg60xhncqqlev4dx;
