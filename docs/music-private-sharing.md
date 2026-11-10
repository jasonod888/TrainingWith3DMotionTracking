# Private reviewed-music sharing

10 November 2026. Reviewed music lessons can now be released to named people through the
existing email invitation workflow. **No public listing, share link or group release is
enabled for music**, and processing, scoring and model work remain unchanged.

## Release rules

A music lesson can be published only when:

1. its **latest** revision was accepted through the owner review (`source='music-review'`);
2. the revision manifest is reviewed (`reference_reviewed` true) and schema v2;
3. the owner chooses `mode='invite'`.

`mode='link'` is refused with a conflict; `ensure_release` for a v2 revision never creates
an acceptance and never falls back to a body check. Unreviewed or superseded revisions are
refused. Publishing again after a new review releases the new revision; `keep_current_release`
cannot resurrect an older music revision.

Recipients still use `POST /api/shares/inspect` and `POST /api/shares/accept`. Accepting an
invitation returns the v2 manifest, records the existing grant, and makes the music lesson
appear in `GET /api/shared-lessons/summaries` for clients that advertise format 2. The
body-shaped `/api/shared-lessons` route still omits music.

The shared music lesson is never public: `/api/public/moves/{id}`, public detail and public
media remain unavailable. Recipients cannot publish, unpublish or invite others; only the
owner can. Unpublishing clears the released pointer, and the recipient's next detail or
practice request is refused. Revoking an invitation or a person's access keeps the existing
revocation semantics.

## Client flow

- An owned music card now offers **Share lesson** in its menu.
- The share screen is private-only: no Public, Group or Link tabs. It explains that the
  lesson cannot be shared by link, with a group or publicly.
- The first invitation publishes the latest accepted revision by invitation; subsequent
  invitations reuse that release. Pending invitations can be cancelled, people with access
  can be removed, and **Make private** unpublishes the lesson.
- Accepting an invitation now routes a v2 manifest to the music guide instead of the body
  player. The existing login, invitation email, video, timing, MIDI capture and per-account
  history behaviour is unchanged.

## Verification

| Check | Result |
| --- | --- |
| `tests/api/test_music_sharing.py` | **Passed**: review-only acceptance, link refusal, invitation publish, recipient v2 detail and shared summary, no public endpoint, non-owner refusal, unpublish revocation |
| `scripts/verify_music_sharing.py` | **Passed**: invitation-only UI, single invite publish, pending invitation display, make private, no link/public controls |
| Web suite | **282 passed**; TypeScript, build and bundle checks pass |
| Movement feed / mixed summaries | Pass |
| Full API suite | **307 passed, 13 skipped** |

## Limits

- Music group sharing and share links remain unavailable by design.
- No new notification delivery beyond the existing invitation email.
- The recipient can open the reviewed guide; practice summaries remain private per account.
- No public music, scored release or model processing is enabled.
- The feature is not enabled in a deployed environment by this change.
