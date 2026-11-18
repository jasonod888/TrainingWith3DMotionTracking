# Learner shared controls — implementation record (2026-11-18)

Status: implemented, uncommitted. Functional-first validation only; no browser screenshots, broad suites, build, installs, or server restarts. Concurrent guitar/editor/API work was preserved.

Baseline references:
- `docs/learner-controls-audit-2026-11-18.md`
- `docs/learner-controls-baseline-2026-11-18.json`
- ignored source snapshot `.local/dsh-practice-engine/learner-controls-baseline-2026-11-18.zip`
- implementation plan `.local/dsh-practice-engine/shared-controls-plan.md`

## Architecture

New app-level shared UI layer:

- `apps/web/src/ui/tokens.css` — UI font/color/accent/focus/disabled tokens. Intentional light/dark and compact/form densities remain separate variants.
- `apps/web/src/ui/controls.tsx` — native `Button`, `IconButton`, `Select`, `Input`, `Checkbox`, `MenuTrigger` with typed variants. Native elements and refs are preserved.
- `apps/web/src/ui/controls.css` — variant-owned geometry/appearance, scoped beneath `data-ui-surface="app" | "watch" | "practice"` so host generic `button/select` rules cannot override by DOM depth or stylesheet order.
- `apps/web/src/ui/overlays.ts` — shared popover dismiss/focus-return and dialog focus-trap/Escape/opener-restoration behavior. Popover and dialog semantics remain distinct.
- Learner roots now declare `data-ui-surface`: `LibraryApp` (`app`), `PracticePreview` (`watch`), `PracticeWorkspace`/`PracticeShell`/dock/modal (`practice`).

`PracticePanel` no longer queries `.mimic-shell`. It accepts explicit `portalRoot`; body and music owners pass their shell root. The modal backdrop carries `data-ui-surface="practice"` so primitives remain correctly styled even if a caller needs a body fallback.

Domain components remain compositional owners: `PracticePlayerDock`, `PracticePrimaryActions`, `PracticeShell`, `PracticeSettings`, `PracticeCommonSettings`, `PianoPracticeViews`. Subject content slots and capabilities remain subject-specific.

## Preserved source-value inventory (variants)

| Variant | Height | Padding | Radius | Type | Colors / notes |
|---|---:|---|---:|---|---|
| `app-primary` | 44 min | 12×20 | 9 | 12/600 | `#242d26` on `#f4f6eb`; focus 3px `#738b35` offset 4; disabled `.4` |
| `app-primary-large` | 50 | 0×26 | 9 | 14/600 | public-detail action |
| `app-secondary` / large | 44 / 50 | 12×20 / 0×26 | 9 | 12 or 14/600 | `#fffefa`, line `#dedfd6` |
| `app-back` | 44 min | 0 | 0 | 11 | muted `#7b8573` |
| `nav` | 44 desktop / 50 mobile | 10×14 / 5×2 | 10 | 13 / 10 | active `#eaf0e0` on `#263a22`; mobile active transparent |
| `feed-chip` | 40 | 0×18 (0×14 mobile) | 9 | 12/550 | `#eef1e9`; selected `#293a28` on `#f7f9ef` |
| `feed-create` | 44 | 0×16 | 24 | 12/600 | `#f0f3e9`, no border on mobile |
| `feed-sign-in` | 44 | 0×14 | 22 | 12 | `#eef3e4` |
| `feed-profile` | 40 desktop / 36 mobile | 0 | 50% | 16/600 | light green |
| `feed-menu-row` | 44 | 10 | 8 | 13 | left-aligned account menu row |
| `feed-card-action` | 44 | 10 | 8 | 12 | card action menu row |
| `feed-thumbnail` | baseline feed thumbnail | 0 | 14 desktop / 12 mobile | baseline | `#203b30` surface, `#f6f9ee` text; preserves image/layout |
| `pip-close` (piano video PiP) | baseline immersive button (24 width / 44 min-height) | 10×14 | 14 | 13 | `#162b22a6`, border `#ffffff20`, text `#f7f9f3` |
| `move-play` (public detail) | 44 | 10×16 | 30 | 12/600 | `#fffefa` on `#242d26`, border `#dedfd6` |
| `watch-overlay` | 100% inset overlay | 0 | 0 | inherit | transparent video toggle; image/layout preserved |
| `watch-cta` | 38 | 0×22; 0×18 only ≤600 | 22 | 13/650 | lime |
| `watcher CTA` (`watch-cta`) | 38 | 0×22 (0×18 mobile) | 22 | 13/650 | lime `#d8ed9b` on `#1b311f`; focus 2px lime offset 3 |
| `watch-control` / `icon-watch` | 44 | 0×12 | 8 | inherit | transparent; focus 2px lime offset 3 |
| `watch-section` | 44 | 12 | 0 | inherit | dark section row |
| `dock-primary` | 40 (mobile font 12 / padding 8×10) | 8×14 | 9 | 13/600 | lime `#d8ed9b` on `#203525`; focus 2px lime offset 2; disabled `.5` |
| `dock-quiet` | 44 (mobile text 11 / padding 8×7) | 8×10 | 8 | 12 | transparent `#c6d4c9` |
| `dock-tool` | 44 | 8×10 (mobile 8) | 8 | 12 | min-width 44 |
| `dock-dropdown` (View trigger) | 34 | 0×24×8 | 8 | 12 | `#183328`, border `#ffffff24`, text `#eef4e9` |
| dock mode/source selects | 34 | 0×24×8 | 8 | 12 | source max-width 112; mode wrapper 124 |

Shared dock trigger/select geometry is one rule family using
`--ui-dock-control-height`, `--ui-dock-control-padding` and
`--ui-dock-control-radius`; changing that family’s height/padding/radius no longer
requires editing separate trigger and select blocks. Intentional 40px primary and
44px tool sizes remain separate.
| settings group | 60 | 14×12 | 0 | 15 | `#ffffff05`; hover `#355443` |
| settings choice | 44 | 9×10 | 10 | 13 | selected lime; disabled `.35` |
| settings field select/input | 44 | 6 | 8 | 13 | `#233c30`; max-width 58% |
| settings-extra select | 44 | 6 | 6 | 16 | `#233c30`; max-width 65% |
| modal close / immersive action | 44 | 10×14 | 14 | 13 | `#162b22a6`, border `#ffffff20` |
| settings pill | 44 | 10×14 | 24 | 13 | `#1b3429` |
| settings preview | 44 | 8×10 | 14 | 12 | `#162b22a6` |
| icon-shell | 36×36 | 0 | 9 | inherit | transparent; disabled `.38`; focus 3px `#8ab59a` |
| icon-immersive | 44×44 | 0 | 50% | inherit | `#162b22a6` |
| icon-feed | 40×44 desktop; hidden mobile | 0 | 50% | inherit | `#586751`; hover `#edf1e5` |
| icon-search | 44×44 | 0 | 50% | inherit | hidden desktop except mobile search |
| compete primary | 44; dock variant 48 | 10×14 | 30 | 12 | lime; pressed translucent |
| record action | 44 | 8×12 | 30 | 11 | translucent; active red `#762e35` |
| compete result row | 54 | 10×14 | 14 | 12 | dark translucent |

Timeline, sheet/view geometry, playback/session, source clock, voice/PiP/fullscreen state were not changed by this extraction.

## Migrated controls

| Area | Components |
|---|---|
| App shell | header sidebar toggle, nav items, Create, account/sign-in/profile/menu rows, search open/back/submit/clear + input, feed filters, feed cards/thumbnail/title/action details, feed empty/load-more/retry |
| Public discovery | Explore filters/load-more/back/CTA/share/report, public move playback button |
| Watch | Back, play/mute/fullscreen/CTA, video toggle, section rows, related lessons, retry |
| Practice dock | primary/secondary, speed/settings/fullscreen/voice tools, View trigger, mode select, source select, fullscreen |
| Settings | settings family trigger, choices, common speed/repeat/rest/count-in fields, voice toggle, modal close, body camera/setup/record/display/pair/share actions, body checkboxes, piano/guitar extra selects, competition result actions |
| Menus/overlays | account popover, checkbox View popover, section popover, voice prompt dialog behavior, settings/body dialogs |

Legacy layout class names remain where needed for selectors/tests (`practice-player-primary`, `player-text-action`, `player-tool`, `ws-icon-button`, sidebar/nav classes, etc.). Migrated elements also carry `ui-*` classes, and primitive selectors outrank old appearance selectors. Dock old primary/tool/select rules were narrowed with `:not(.ui-btn)` / `:not(.ui-select)` so review-only raw fallbacks keep working without competing with learner primitives.

## Behavioral changes

- `PracticePanel` portal target is explicit instead of a global `.mimic-shell` query.
- Account/View/popover behavior shares outside/Escape/focus return; View still stays open during multi-toggle.
- Dialog opener capture happens during render/active transition, before a parent layout
  effect can blur/inert the opener. Passive effects set initial dialog focus and do not
  overwrite the captured opener; close restores the original control.
- Section and voice overlays use shared dismiss/focus helpers where applied; settings dialogs use shared focus trap.
- No playback/session reset or source-clock lifecycle changes. View remains a multi-check menu; native selects remain native.
- Existing intentional light feed/watch and dark practice surfaces, compact vs form densities, and CTA variants are retained.

### Responsive preservation corrections

- Final feed drawer hamburger is restored at ≤760: `display:grid`, 36px wide, 44px min-height. It is not hidden by the shared rule.
- The navigation-overlay selectors use the real same-element root structure
  `.feed-app[data-ui-surface="app"].navigation-overlay`; active drawer rows keep
  `#eaf0e0`, horizontal padding 12×14, 44px min-height and 13px type.
- Compact desktop navigation keeps padding 12px 0 via a same-element
  `.feed-app[data-ui-surface].sidebar-compact` rule.
- Shared dock speed is hidden only at ≤599 and remains visible above.
- Watch CTA mobile padding/margin changes only at ≤600, not 760.
- Mobile feed sign-in keeps 38px min-height / 0×10 padding; mobile thumbnail keeps 12px radius.

## Validation

Executed from `apps/web` after the final correction:

1. `npx tsc --noEmit` — **exit 0**, 12.02 s.
2. `node --import ./tests/runner/register.mjs tests/ui-controls.test.tsx` — **exit 0**, **5/5 passed**, runner 1211 ms, wall 3.44 s:
   - Source/media guard asserts the final 760/600/599 responsive rules and real same-element feed root selector structure.
   - Actual `PracticePrimaryActions`, `SettingsChoices`, `PracticeCheckboxMenu`, `Select`, and Button primitives rendered under body- and piano-like `.mimic-shell.mimic-immersive` hosts, both CSS load orders. Bounded UI token variables are resolved only in the fixture because JSDOM does not resolve custom properties in computed style.
   - Asserted dock primary 40/min-height, padding 8×14, 9px radius, lime; tools 44/8×10; shared dock trigger/select 34/0 24 0 8/max112; settings choice 44/10; watch CTA 38/22 with lime; app disabled `.4`; dock disabled `.5`.
   - Actual `FeedCard` thumbnail, PiP-close, watch overlay, and public play variants preserve baseline background/padding/radius/border and color.
   - Actual View menu: opens with two checkboxes, toggles without closing, Escape closes and restores trigger focus.
   - Actual `PracticePanel` opener regression: opener is blurred by a parent layout effect before the dialog passive effect; closing restores the original opener. The fixture explicitly simulates visible client rects for focusables.
   - Test file: `apps/web/tests/ui-controls.test.tsx`.

No real browser screenshots were captured. Root CUA was reported blocked by Windows Firefox URL-policy support; this was not bypassed and no browser tools were installed. JSDOM does not evaluate viewport media queries, so mobile rules are source-guarded rather than computed in the focused test. The test fixture resolves only the UI custom-property set for geometry; this is not a claim that JSDOM computes CSS variables like a browser.

## Deferred / not migrated

- Creator/editing/review-authoring screens, auth/account forms, admin, groups/community management, and camera-setup internals remain on their existing controls. Links to editing from learner screens remain appearance-preserved.
- `MusicLessonHome`/`MusicLessonScreen` are dormant on the current learner music route; their custom controls were not migrated.
- Native `<video controls>`, native range inputs where they intentionally rely on browser UI, and native `<details>` card menus remain native.
- Public-detail “Keep in a group” still uses a native unstyled `<select>` in `workflow.css`; it was left to avoid changing that form family without a dedicated review.
- The repository still contains legacy editor CSS (`ws-practice-footer`, `music-practice-player`, `ws-practice-view-select`, `lesson-mode-control`) and dormant review-practice hooks. They were not deleted in this bounded migration.
- Old class names and existing tests/selectors remain for compatibility; future cleanup should follow the source/ZIP baseline and a real screenshot pass.

## Limitations

- No browser/visual verification, screenshots, zoom, native popup, real focus rendering, or device/mobile computed styles.
- Shared dock trigger/select geometry uses bounded UI tokens and one common rule family; the focused fixture substitutes those custom properties because JSDOM does not compute them. This must not be presented as browser font/size verification. The baseline’s `font: … var(--…)` shorthand is also not computed faithfully by JSDOM; no browser font-drift conclusion was drawn.
- Key backgrounds that needed reliable cascade checks use explicit values matching the source inventory.
- Exact colors in native selects/popups remain browser-owned.
- Concurrent work means files may change after this record; the implementation diff and test results are the authority for this turn.


## Independent reviewer verification

- Reproduced and corrected the dialog opener regression: an actual PracticePanel now restores the original opener even when an owner layout effect blurs it before passive effects. Independent direct component check passed.
- Compared 66 selected baseline CSS properties against the pre-migration source snapshot at 400, 700 and 1200px. Covered actual same-element Home drawer root, navigation toggle, selected drawer row, thumbnail, playback speed visibility, preview CTA and PiP close. All selected comparisons passed. Media rules were selected explicitly for the JSDOM fixture; this is not a browser/device screenshot or complete pixel comparison.
- Source/diff review confirmed learner control composition and the explicit settings portal target; editing/creation destinations were not migrated.
- Final DeepSeek typecheck passed and focused control tests passed 5/5. Earlier interrupted/failed fixture attempts are not counted as passes; the visibility fixture was corrected without changing application behavior to satisfy JSDOM.
- Existing Vite server served the new shared-control module with HTTP 200. No server restart was performed.
- Real browser screenshot comparison remains unavailable due the reported Windows Firefox URL-policy tooling limitation. Font shorthand involving CSS custom properties, native popup paint, and device layout have not received browser-level visual sign-off.
- All changes remain uncommitted. DeepSeek continuation session: session-9b698783-926f-45b7-a9f8-16116b1689a4 (deepseek-flash).
