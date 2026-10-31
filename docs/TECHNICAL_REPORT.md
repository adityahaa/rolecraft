# Rolecraft technical report

## Problem and architecture

Rolecraft connects candidate evidence, job descriptions, document drafting, and application tracking. Next.js/React implement the interface and API routes. lib/domain.ts defines schemas, fixed skill vocabulary, overlap scoring, and evidence-preserving composition. lib/jobs.ts normalizes Remotive listings. lib/documents.ts extracts PDF/DOCX text and creates exports. lib/server.ts coordinates authentication, quotas, provider requests, and storage. supabase/schema.sql defines ownership policies, versions, deletion functions, and atomic counters.

## Methodology

Matching is the proportion of recognized job skill tags present in candidate facts; an empty recognized requirement set yields no score. It is neither a trained model nor an ATS probability. The optional Gemini path ranks numbered evidence IDs and skill tags; template assembly uses the candidate's original statements. The manual/synthetic path provides a credential-free demonstration, not a measured AI-quality baseline. Remotive is the only integrated source and is not comprehensive job-market coverage.

## Evaluation

Existing tests cover matching, evidence preservation, payload privacy, safe links, feed normalization/filtering, export roundtrips, PDF pagination, and malformed/oversized extraction. Run npm test and npm run typecheck after npm ci. These test local behavior; they do not establish deployed tenant isolation, provider quality, OAuth behavior, or cross-browser synchronization. See [verification record](VERIFICATION.md) for checks rerun during this review. The original README's prior test/build results are historical evidence unless explicitly revalidated there.

## Reproduction and limits

Follow the root README for local setup and synthetic examples. Cloud use requires private Supabase/Gemini settings and GitHub OAuth configuration. Guest edits are in tab memory. PDF supports the bundled font's character coverage; OCR is absent. Private persistence/deletion, provider availability, and live AI require separate end-to-end verification. Heuristic overlap can miss synonyms and context; factual text preservation does not establish suitability for a job. No recruiter outcome, hiring probability, or automated application submission is claimed.
