# Model artifact licensing review

10 November 2026. **No artifact has been reviewed or approved.** This is the checklist and
record shape for the commercial code/weights review that must precede transcription. It is
not legal advice; a qualified reviewer/legal function must decide.

## Why code and weights separately

A repository licence does not automatically cover model weights, training data, hosted
inference terms or redistribution. The qualification harness therefore requires
`code_license`, `weights_license` and `license_source_url` as separate declarations, and a
commercial run additionally requires commercial-use, redistribution, attribution and a
recorded approval. A permissive code licence alone is never sufficient.

## Required review record

Retain one record per artifact version, containing:

| Field | Meaning |
| --- | --- |
| `artifact.name`, `version`, `sha256` | Exact artifact identity; the harness verifies local bytes |
| `source_url` | HTTPS source for the artifact or release |
| `code_license`, `code_license_url` | Source-code terms and the exact terms location |
| `weights_license`, `weights_license_url` | Weights-specific terms, if different |
| `terms_snapshot_sha256` | Digest of the retained licence/terms snapshot reviewed |
| `commercial_use` | `allowed` / `restricted` / `unknown`, with the clause reference |
| `redistribution` | Whether weights/binaries may be redistributed, with the clause reference |
| `attribution` | Exact attribution/notice obligation |
| `approval.reviewer_id` | Accountable human/legal reviewer |
| `approval.approved_at` | ISO decision date |
| `approval.decision` | `approved` / `rejected` / `needs-changes` |
| `approval.scope` | Deployment scope approved (e.g., hosted inference only) |
| `approval.evidence_sha256` | Digest of retained approval evidence (not the raw contract) |
| Obligations/notes | Copyleft, notice, field-of-use, patent, API rate terms, output rights |

Do not commit confidential contracts or credentials. Commit sanitized records and digests;
keep restricted evidence in the approved internal store.

## Checklist

- Are code and weights under separate terms, and are both compatible with commercial
  hosted use and any redistribution of the runtime image?
- Do the terms restrict commercial use, fields of use, benchmarks, reverse engineering,
  output ownership or model improvement?
- What attribution/notice must appear in the product and documentation?
- Are weights redistributed, or only used behind a hosted service? Do the terms survive
  containerization and backup/restore?
- Is the training-data provenance acceptable for the intended commercial use, and are
  there model-card limitations the product must disclose?
- Are there export-control, security or acceptable-use obligations?
- Is the exact version/digest pinned, with an update review path?
- Does using the artifact in qualification reports itself require permission?

Any unresolved answer blocks commercial qualification.

## How the harness consumes it

- `--use internal-evaluation` (default) records the evidence but labels the result
  `internal-evaluation-only`; it cannot authorize deployment.
- `--use commercial` requires allowed commercial use and redistribution, attribution, a
  valid approval object and a retained `--approval-file` whose digest matches
  `approval.evidence_sha256`. It still reports
  `commercial-evidence-complete-not-an-approval`; the human approval remains the decision.
- The harness verifies artifact bytes, licence evidence presence and the approval digest.
  It does not negotiate, interpret or grant rights.

## Procedure

1. Obtain the artifact and terms from the vendor/upstream; record name, version, digests.
2. Complete the checklist with the accountable reviewer; retain sanitized evidence.
3. Run the harness with `--use commercial`, the approval file and a real-audio reviewed
   corpus; retain the report.
4. Package/enable only after both the licence approval and the real-audio accuracy review
   pass; otherwise keep transcription disabled.

## Status

No artifact metadata, approval record or real-audio corpus exists in the repository. The
fixture engine remains a transport test; processing stays disabled.
