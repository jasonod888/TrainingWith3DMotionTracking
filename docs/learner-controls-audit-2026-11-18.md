# Reviewer notes and preservation contract — 18 November 2026

This is an audit and proposal, not an implementation. Scope includes home/listing, the shared learner shell, Watch/preview, and body/piano/guitar practice and their menus/settings. Creation and editing destinations are excluded; links to them on learner screens stay in scope for appearance only.

I independently checked active routing, shared dock composition, shared control sizing, the global button reset, and the panel portal coupling. Current piano and guitar both use the same workspace root; the panel issue is a future coupling risk, not evidence that today's guitar panel is broken.

Preservation rules for implementation:
- Extract existing styles first. Do not normalize colors, focus rings, disabled opacity, primary hover, spacing, labels, control order, or responsive behavior without separately reviewing the visible change.
- The inventory records CSS declarations, not verified browser-computed values. Context differences described as intentional below are preservation candidates, not a claim that the user approved every difference.
- View is a **34px dock dropdown trigger**, sharing geometry with mode/source selects. Map it to a dropdown-trigger variant, not the 44px dock-tool variant. The menu's multi-selection behavior remains distinct from a single-select.
- Proposed shared primitives should live in an app-level UI folder, with theme/density variants. Practice-specific composition and tokens can remain under practice. Preserve light discovery, dark learner surfaces, and existing CTA variants.
- Component-owned CSS must be independent of DOM depth. CSS Modules alone do not protect against generic ancestor rules. Avoid partial cascade-layer adoption: existing unlayered rules override layered normal rules. Remove/narrow competing learner host rules as each family migrates, without changing editor paths.
- Reuse Popover behavior for account/checkbox menus where appropriate, and Dialog behavior for modal panels; preserve their different keyboard and selection semantics. Do not replace native selects merely to make all menus share one implementation.
- Before the first migration, capture actual browser screenshots at the same viewport, zoom, route, content, and state. Include desktop, narrow mobile, short landscape, open settings/menu, keyboard focus, and disabled controls. Compare small batches. A visual change must be explained and reviewed, not silently accepted as a new baseline.
- Home/feed remains part of the agreed scope. It follows practice and preview in the migration order; it is not dropped as optional work.
- No broad regression suite is needed during exploratory extraction. Use a small targeted check and before/after review per migrated family; run broader regression once the final design is approved, as requested.

The baseline manifest records exact hashes from the working tree (which contains uncommitted concurrent work). Its ignored ZIP preserves the corresponding source bytes locally. Screenshots have **not** been captured, and this source snapshot must not be described as visual sign-off.

---

# Learner-facing controls & styling audit

Read-only source audit. No application source, tests, builds, dependencies, git, or servers were changed. This report is the only file written.

Scope: learner home/listing/feed, lesson Watch/preview, and body/piano/guitar practice including dock, settings and practice menus. Creator/editor/review-authoring flows are excluded except where dormant code can still affect learner routes.

No browser rendering was performed. All measurements below are source CSS values; line numbers are from the current working tree of `D:\3d_trainer\developement`.

---

## 1. Reachable learner routes

| Journey | Source | Current behavior |
|---|---|---|
| Home/listing/feed | `apps/web/src/LibraryApp.tsx:181` → `PracticeFeed` | Feed filtering, subject chips, cards, account menu, search |
| Watch/preview | `apps/web/src/LibraryApp.tsx:196,200` → `PracticePreview` | Shared body/music preview; one green **Practice** CTA |
| Body practice | `LibraryApp.tsx:204` → `LessonExperienceHost.tsx:43-46` → `LessonWorkspace` → `PracticeWorkspace` | Body-only camera/instructor/Challenge UI around common dock |
| Music practice | `LibraryApp.tsx:204` → `LessonExperienceHost.tsx:40-43` → `PianoWorkspaceHarness` → `PianoPracticeWorkspace` | Piano and guitar both use this route; subject slot selected inside the workspace |
| Music fallback screen | `LessonExperienceHost.tsx:45-47` → `MusicLessonHome` | **Currently unreachable for learner practice** because both schema subjects (`piano`/`guitar`) are caught by the branch above |
| Unused export | `LessonExperienceHost.tsx:54-58` → `MusicLessonScreen` | No references in current `apps/web/src` |

Important consequence: `MusicLessonHome.tsx` and its custom `music-practice-drawer`, audio-mode buttons, and settings drawer are active-looking CSS/TSX but are not on the current learner practice route. They must not be used as the basis for new shared controls without confirming a future route change.

---

## 2. Existing shared control components

| Component | Evidence | Use |
|---|---|---|
| `PracticePlayerDock` | `apps/web/src/PracticePlayerDock.tsx:10-77` | Single dock shell, timeline, toolbar, fullscreen, status |
| `PracticePrimaryActions` | `apps/web/src/practice/PracticePrimaryActions.tsx:5-19` | Canonical primary/secondary renderer |
| `PracticeShell` | `apps/web/src/practice/PracticeShell.tsx:23-163` | Music practice shell, common header/stage/dock/settings/section picker/fullscreen |
| `PracticeTimeline` | `apps/web/src/PracticeTimeline.tsx:8-40` | Chapter rail/seek control |
| `PracticeSettings` primitives | `apps/web/src/PracticeSettings.tsx:14-57` | Settings provider, groups, rows, choices |
| `PracticeSettingsPanel` | `apps/web/src/practice/PracticeSettingsPanel.tsx:17-46` | Common music settings container + common rows |
| `PracticeCommonSettings` | `apps/web/src/practice/PracticeCommonSettings.tsx:8-57` | Speed/progression/repeat/rest/count-in rows |
| `ExperienceModeSelector` | `apps/web/src/practice/ExperienceModeSelector.tsx:6-30` | Native Watch/Practice/Challenge mode select |
| `PracticeCheckboxMenu` | `apps/web/src/practice/PracticeCheckboxMenu.tsx:7-57` | Generic dock checkbox popup (currently piano View menu) |
| `PracticePanel` | `apps/web/src/PracticePanel.tsx:8-27` | Portal dialog/drawer used by body and common settings |
| `usePracticeFullscreen` | `apps/web/src/practice/usePracticeFullscreen.ts` | Shared root fullscreen lifecycle |
| `useVoiceStartCoordinator` | `apps/web/src/practice/useVoiceStartCoordinator.ts` | Shared mode/voice start policy |

These are real shared components, but they are still mostly **class-name contracts** (`player-tool`, `practice-player-primary`, `secondary`, etc.) without typed visual variants or tokens.

### Active composition

- Body instructor practice: `PracticeWorkspace.tsx:614-668` passes `view`/`onCommand` into `PracticePlayerDock`; camera branch still provides a subject `primaryAction` extension at `632-654`.
- Music practice: `PracticeShell.tsx:116-135` owns dock; `MusicLessonHome` branch is currently dormant.
- Piano/guitar route: `PianoPracticeWorkspace.tsx:359-380` uses `PracticeShell`, common mode/View/source controls, and subject extensions.
- Settings: body `PracticeWorkspace.tsx:672-731` uses `PracticePanel` + `PracticeSettingsProvider` + `SettingsGroup/Row` + `PracticeCommonSettings`; music `PracticeShell.tsx:161-162` uses `PracticeSettingsPanel`.
- Preview: `PracticePreview.tsx:43,55` owns its own back button and green CTA; it is not a dock.

---

## 3. Current style baseline (source values)

### 3.1 Global/app baseline

`apps/web/src/style.css:1`

- Root: 15px Inter/Segoe UI/Arial, `#242d26` ink, `#f5f4ef` background, `#d8ed9b` accent, `#fffefa` surface, `#dedfd6` line.
- Global button reset: no border/background, `cursor:pointer`, disabled opacity `.4`, focus `3px solid #738b35`, offset 4px.
- `.primary,.secondary`: min-height 44, padding 12×20, radius 9, 12px/600. `.primary` dark ink; `.secondary` surface + line border.
- Global `.nav-item`: min-height 44, padding 10×18, radius 30 (feed overrides to radius 10 and padding 10×14).

### 3.2 Feed/home

`apps/web/src/feed.css`

- Feed header/sidebar tokens at `2-4`; nav item at `9-11`.
- Create/account buttons: `14`, `62-68`; header actions min-height 44.
- Search field: `18-19`; 44px tall, radius 24.
- Filters: `21`; 40px high, 9px radius, `#eef1e9`; selected `#293a28`; hover border `#becbaa`.
- Cards/actions: `22-28`; thumbnail radius 14, card action rows 44, account menu 44 rows, radius 13.
- Feed cards and filters are visually a **light discovery** context, not a practice transport context.

### 3.3 Watch/preview

`apps/web/src/preview.css`

- Scope dark `#0e2018`, text `#edf3e9` (`1-3`).
- Header/control buttons: 44 minimum, padding 0×12, transparent, radius 8 (`7-8`).
- Play/pause/mute/fullscreen row radius 8 (`16-17`).
- **Practice CTA**: `.watch-control-row>.watch-practice` at `17`: min-height 38, padding 0×22, radius 22 pill, background `#d8ed9b`, text `#1b311f`, 13px/650.
- Preview timeline is intentionally denser: heading 28, track 30, rail 5, playhead 13 (`14-16`).
- Focus 2px/offset 3; disabled opacity `.4` (`4-6`).
- Mobile CTA margin-left auto, controls move below media (`28-36`).

### 3.4 Practice dock and common transport

`apps/web/src/practice-player.css`

- Dock: `46-56`, background `#10241d`, border `#ffffff0a`, padding 10px / 28px horizontal / 12px bottom + safe area; 12px dock audit font.
- Timeline within dock: heading 28, track 32, rail top 13/height 6, playhead 14×14 (`64-67`).
- Toolbar/actions/tools: flex, gap 8; tools gap 2 and margin-left auto (`79-90`).
- Primary: `92-107`, min-height 40, padding 8×14, radius 9, `#d8ed9b` on `#203525`, 13px/600.
- Secondary/tool: `113-130`, min-height 44, padding 8×10, radius 8, transparent, `#c6d4c9`, 12px/400; tools min-width 44.
- Shared selects/trigger: `137-161`, 34px height/min/max, border-box, padding 0 24 0 8, radius 8, 12px/1.2, dark `#183328`, border `#ffffff24`. Mode width 124; source max 112; View trigger fills its menu container.
- Hover primary/tools reset to near-transparent `#ffffff0a` (`162-166`) — primary hover currently loses its lime surface.
- Focus 2px `#d8ed9b` offset 2 (`168-172`); disabled opacity `.5` (`174-178`).
- Mobile: dock 8px/side, primary 12px and 8×10, secondary 11px and 8×7, tool padding 8, speed hidden (`237-252`).
- Short landscape: dock top/bottom 4, timeline heading 26 (`255-257`).

`apps/web/src/practice-timeline.css`

- Base timeline text `#e8f0e6`; heading 36; browse 44/radius 8/12px; count `#d8ed9b`; name 11; times 11; rail 8; playhead 16 with 3px white border; tooltip radius 10 (`3-24`).
- Preview overrides density (`preview.css:14-16`); dock overrides density (`practice-player.css:64-67`). This is an intentional variant, not accidental.

### 3.5 Shell and settings

`apps/web/src/practice/practice-runtime.css`

- Shared shell: flex column, 100dvh, dark `#0e2018` (`3-11`); music shell background `#f5f4ef` and ink `#1f2a24` (`13-16`).
- Header: 58px min-height, 8×14 padding, dark `#10241d`, radius none (`18-28`); music header white (`30-34`).
- Dock as sibling: relative, z-index 20, dark `#10241d` (`64-73`).
- Mode selector base `experience-mode.css:1-57`: wrapper 140 (compact 124), select min-height 30 (compact 28), radius 8, padding 0 22 0 8; dark host override at `58-66`. Dock then normalizes to 34/12 (`practice-player.css:137-149`). These are layered variants: component default, compact, dock.
- Settings visual: `practice.css:360-386` (dark immersive rows/choice buttons) and `practice-player.css` settings family; `PracticeSettings.tsx:24-56` supplies semantics. Active settings row is 52px min-height/13px; choices 44/radius10; inputs 44; checkboxes 24.
- Body settings uses `PracticeSettingsProvider` plus `PracticePanel` (`PracticeWorkspace.tsx:672`, `PracticeSettingsPanel.tsx:30` uses `PracticePanel` drawered).
- Body has a header **Practice settings** button (`PracticeWorkspace.tsx:563`) and dock settings icon (`PracticePlayerDock.tsx:60`); both call the same opener but are two entry points. This may be contextual (header when dock is hidden) but should be deliberate.
- Guitar's custom `MusicLessonHome` settings drawer (`MusicLessonHome.tsx:407-447`) is dormant on current routes; it duplicates section/volume/sync/loop controls and is a future migration hazard.

`apps/web/src/PracticePanel.tsx:26`

- Portal target is `document.querySelector('.mimic-shell') ?? document.body`.
- Body and current music practice roots happen to include `.mimic-shell` (`PracticeWorkspace.tsx:562`; `PianoPracticeWorkspace.tsx:359`), so current dialog theme works. A shell rendered without that class will silently portal to body and use base light `.practice-modal` styles (`practice.css:11`) instead of immersive dark styles (`practice.css:85-86`). This is a real coupling hazard for future surfaces/refactors.
- Two presentation patterns exist: `PracticePanel` dialog/side drawer, and `PracticeShell`'s custom section overlay (`practice-runtime.css:115-154`). Voice prompts are a third small dialog pattern (`practice-runtime.css:89-114`).

### 3.6 Menus

- Mode: native select (`ExperienceModeSelector.tsx:16-28`).
- Piano View: `PracticeCheckboxMenu` popup 176 min-width, 6px padding, radius 10, dark `#10241d`, rows min-height 34, checkbox 16, rows hover `#ffffff0d` (`practice-checkbox-menu.css:1-27`).
- Preview sections: list buttons 44, radius 10, dark panel (`preview.css:21`).
- Body sections: custom `PracticePanel` list, not the common shell section overlay (`PracticeWorkspace.tsx:733`).
- Feed account/card menus: light popovers (`feed.css:64,28`), 44 rows.
- These are necessarily different surfaces, but they currently share no positioning/focus/escape primitive.

### 3.7 State styles (drift evidence)

| State | Global/app | Preview | Dock | Settings |
|---|---|---|---|---|
| Focus | 3px `#738b35`, offset 4 | 2px `#d8ed9b`, offset 3 | 2px `#d8ed9b`, offset 2 | piano `.ws-shell` 2px `#1d4ed8`, offset 2; some `.ws-icon-button` 3px green |
| Disabled opacity | `.4` | `.4` | `.5` | `.35` choices, `.38` icon, `.45` mimic buttons/checkboxes |
| Primary geometry | 44/12×20/r9 | 38 pill/r22 | 40/8×14/r9 | row/choice variants |

These are partly intentional density/theme choices, but opacity and focus should be tokens (`--practice-focus-ring`, `--control-disabled-opacity`) so future edits do not make them diverge accidentally.

---

## 4. Prioritised findings

### P0 — Establish a visual ownership boundary before adding more controls

There is a functioning shared practice component layer, but visual ownership is split between global reset (`style.css:1`), host generic rules (`practice.css:4,29`; `.ws-shell` styles in `workspace.css`), component CSS (`practice-player.css`, `practice-runtime.css`) and subject extensions (`workspace.css`, `music.css`). Host selectors with higher specificity can override class contracts; the dock has already needed explicit `(0,3,0)` scoped selectors (`practice-player.css:137-177`) to defend itself. Adding a new control without that defense recreates drift.

Recommendation: introduce shared CSS tokens and component variants, then explicitly scope practice controls under the dock/shell owner. Do not attempt a global reset rewrite.

### P0/P1 — Dialog portal/theme coupling

`PracticePanel.tsx:26` chooses `.mimic-shell` by document query and falls back to `body`. This couples shared dialog correctness to caller class names and CSS inheritance. It is not currently broken on the active routes but is the largest hidden architecture risk for a reusable shell. Pass an explicit portal root/theme from the shell rather than querying global DOM.

### P1 — Duplicated settings entry points and surfaces

- Body: header settings (`PracticeWorkspace.tsx:563`) + dock settings (`PracticePlayerDock.tsx:60`) open the same panel.
- Music: common shell settings icon (`PracticeShell.tsx:102`) plus, in the dormant `MusicLessonHome`, a separate Settings header and drawer (`MusicLessonHome.tsx:353-357`, `407-447`).
- Body section selection uses `PracticePanel` (`PracticeWorkspace.tsx:733`), music shell uses a custom section overlay (`PracticeShell.tsx:149-155`), guitar dormant drawer uses another list (`MusicLessonHome.tsx:413-423`).

Recommendation: one `SettingsSurface`/`Popover` primitive with variants (`sideDrawer`, `sheet`, `inlinePopover`) and one owner per visible entry point. Keep camera/setup rows in body slots and instrument/source rows in subject slots.

### P1 — No shared button/select primitive; class contracts are implicit

Classes such as `primary`, `secondary`, `player-tool`, `player-text-action`, `practice-player-primary`, `ws-icon-button`, `ws-quiet-button`, `mimic-icon-button`, `record-take`, `take-review-button`, `practice-session-toggle` encode many dimensions with no typed variant or token. The same label can therefore be 34, 38, 40, 44 or 52px depending on host.

Recommendation: `Button` (visual variants `appPrimary`, `appSecondary`, `watchCta`, `dockPrimary`, `dockQuiet`, `icon`, `chip`, `dangerAction`), `Select` (`dock`, `form`), `CheckboxRow`, `IconButton`, `Panel`, `Popover`. These should be small wrappers over native elements, not a new design system.

### P1 — Font/color tokens are repeated literals

`#d8ed9b`, `#10241d`, `#183328`, `#203525`, `#ffffff24`, font stacks, radii and gap values recur across `practice-player.css`, `practice-runtime.css`, `preview.css`, `feed.css`, `practice.css`, `workspace.css`. The dock uses one font stack (`practice-player.css:55,147`), while feed root uses Inter (`style.css:1`) and preview inherits its own. There is no single token authority.

### P2 — State styling is inconsistent

Focus ring color/size/offset and disabled opacity differ by surface (see §3.7). Primary hover currently turns the lime CTA into a ghost surface because primary and tools share a hover rule (`practice-player.css:162-166`). Some of this may be intentional, but it is not named as a variant.

### P2 — Modal/menu primitive duplication

`PracticePanel` (dialog with focus trap), `PracticeCheckboxMenu` (popup with first-checkbox focus and Escape), `AccountMenu` (menu), and `PracticeShell` section overlay/voice prompt all implement their own focus/outside/Escape rules. `PracticeCheckboxMenu` uses `role="dialog"` without modal semantics; section overlay and voice prompt are similarly custom. A shared `Popover`/`Dialog` behavior primitive would reduce accessibility drift, without forcing identical styling.

### P2 — Stale/dead style selectors increase migration risk

Current grep finds no TSX references for:

- `.lesson-mode-control` (`practice-player.css:262-266`)
- `.ws-practice-view-select` (`workspace.css:1696,1702`)
- `.music-practice-player` (`music.css:449-459`)
- `.ws-practice-footer` (`workspace.css:1602-1651`)

`MusicLessonHome` and `MusicLessonScreen` are also effectively dormant for learner music practice. A future shared migration should delete or clearly quarantine these only after confirming dynamic/external use.

### P3 — Feed/app and practice already have different density by intent

Feed filter chips 40px, app primary 44px, preview CTA 38px pill, dock primary 40px, dock selects 34px, settings fields 44px. This is not automatically drift: discovery, watch overlay, compact transport and form settings have different ergonomics. The goal should be **named variants** with frozen values, not literal one-size controls.

---

## 5. Intentional contextual differences vs accidental drift

Keep as intentional variants (freeze current values):

- Feed light theme and discovery controls; watch dark overlay; practice dark dock; music shell header may remain light while dock stays dark.
- Preview pill CTA (38/r22) vs practice dock primary (40/r9) vs app primary (44/r9).
- Compact dock selects (34) vs settings form fields (44) vs feed filters (40).
- Timeline density: preview inline (heading 28/track 30) vs practice dock (28/32) vs base editor (36/36).
- Body camera/Challenge special controls; piano View/source; guitar source/instrument slots.
- Icon-only controls on immersive surfaces vs text/icon settings rows.

Currently accidental or under-specified:

- Different disabled opacity (`.35/.38/.4/.45/.5`) and focus colors (blue/green) within learner surfaces.
- Primary dock hover losing its lime fill through a shared hover rule.
- Settings dialog appearance depending on whether the root happens to carry `.mimic-shell`.
- Duplicate settings entry points and duplicate setting surfaces.
- Class names used as visual API without a variant contract.
- Stale/dead selectors left beside active ones.

---

## 6. Recommended architecture (minimal)

### 6.1 Token layer

One shared CSS file, e.g. `apps/web/src/practice/ui-tokens.css`, defining only values already in use:

```css
--ui-font-ui: ui-sans-serif, system-ui, ...;
--ui-color-accent: #d8ed9b;
--ui-color-ink-dark: #203525;
--ui-surface-dock: #10241d;
--ui-surface-control: #183328;
--ui-border-control: #ffffff24;
--ui-radius-control: 8px;
--ui-radius-primary: 9px;
--ui-focus-ring: 2px solid #d8ed9b;
--ui-focus-offset: 2px;
--ui-disabled-opacity: .5;
--ui-control-height-dock: 34px;
--ui-control-height-primary: 40px;
--ui-control-height-tool: 44px;
--ui-control-height-form: 44px;
```

Keep feed tokens separate (`feed.css` or an app token block): discovery controls may use app colors/radii and should not inherit dark dock tokens.

### 6.2 Primitives

Add small React wrappers, not a page redesign:

- `Button` with explicit `variant`, `size`, native `button` props.
- `Select` with `variant="dock" | "form"`; native `<select>` only.
- `IconButton` for square/circular host icon variants.
- `CheckboxRow` and `CheckboxMenu` built on existing `PracticeCheckboxMenu` behavior.
- `Panel`/`Dialog`/`Popover` behavior primitives: explicit `portalRoot`, `modal`, focus restoration, outside/Escape.
- Existing `PracticePrimaryActions`, `PracticePlayerDock`, `PracticeSettings`, `PracticeCommonSettings` stay as composition owners; they consume primitives rather than raw classes.

### 6.3 Isolation

- Give the learner practice root a stable `data-practice-ui="..."`/theme attribute and load token overrides there.
- Scope selectors under the dock/shell owner for geometry, as already done for dock controls (`practice-player.css:137-177`).
- Prefer CSS layers (`@layer app-reset, ui-tokens, ui-components, host-theme`) only if a focused spike proves the build and current cascade; otherwise explicit scoped selectors are safer than a broad layer migration.
- Replace `PracticePanel`'s `document.querySelector('.mimic-shell')` with an explicit portal/theme context supplied by the shell. Avoid portal-to-body fallback for designed surfaces.
- Do not let subject CSS target generic `button`, `select`, `input`; target named control slots or data variants.
- Keep native controls and existing labels/order. No custom select replacement.

### 6.4 Component mapping

| Existing | Proposed owner/variant |
|---|---|
| `.primary`, `.secondary` in feed/app | `Button` `appPrimary` / `appSecondary` (later stage) |
| `.watch-practice` | `Button` `watchCta` (preview-only) |
| `.practice-player-primary` | `Button` `dockPrimary` via `PracticePrimaryActions` |
| `.player-text-action` | `Button` `dockQuiet` |
| `.player-tool`, fullscreen/voice/settings/speed | `Button`/`IconButton` `dockTool` |
| `.experience-mode-selector` | `Select` `dock` + compact/theme variants |
| `.ws-practice-source-select` | `Select` `dockSource` |
| `PracticeCheckboxMenu` trigger/rows | `Button` `dockTool` + `CheckboxMenu` |
| `.ws-icon-button`, `.mimic-icon-button` | `IconButton` `shellSquare` / `immersiveCircle` |
| `.ws-quiet-button`, `.ws-pill` | `Button` `surfaceQuiet` / `chip` |
| `SettingsChoices` buttons | `Button` `settingsChoice` |
| `SettingsRow` fields | `Select`/`Input` `settingsField` |
| `PracticePanel`, section overlay, voice prompts | `Panel`/`Dialog`/`Popover` variants |
| `.record-take`, `.take-review-button`, `.practice-session-toggle` | `Button` camera/Challenge variants |

Subject-specific components (`GuitarChordStrumHud`, piano view menu, camera setup) remain slots and can opt into tokens without becoming shared engine code.

---

## 7. Smallest practical staging

### Stage 0 — Freeze baseline (no behavior change)

Create a source-values baseline table (this report) plus a small computed-style fixture for the dock's primary/secondary/tool/select/menu trigger under body/piano/guitar host classes and both CSS load orders. No broad suite; use JSDOM computed styles for cascade guards and manual screenshots for visual review.

### Stage 1 — Tokens + dock/transport primitives

Only `PracticePlayerDock`, `PracticePrimaryActions`, `PracticeCheckboxMenu`, `ExperienceModeSelector`, their CSS. Replace literals with tokens and add explicit types/variants. Preserve every current measured value: 40/44/34 controls, dark dock, focus/disabled states, current mobile rules. Verify body/piano/guitar computed equality for same variants and intentional differences for different variants.

### Stage 2 — Settings/dialog ownership

Introduce `Panel`/`SettingsSurface`; make portal root/theme explicit. Migrate `PracticePanel` and `PracticeSettingsPanel` first, then body settings entry points and section-picker/voice dialogs. Keep body camera/Challenge slots. Confirm one settings entry per visible surface or document why two are intentional; remove the dormant `MusicLessonHome` settings path from consideration.

### Stage 3 — Watch/preview CTA and controls

Adopt `watchCta`/watch icon variants without changing the single green Practice CTA, timeline density, or focus/disabled appearance. Keep preview independent of dock theme.

### Stage 4 — Feed/app discovery controls (later, optional)

Adopt app tokens/buttons for filters, search, nav, cards and account menu only after practice migration is stable. Feed has its own density and should not inherit dock tokens.

### Stage 5 — Cleanup

Remove or quarantine confirmed dead selectors/components (`lesson-mode-control`, `ws-practice-view-select`, `music-practice-player`, `ws-practice-footer`, dormant `MusicLessonHome`/`MusicLessonScreen` branches) in a separate narrow change, after grep and route confirmation.

---

## 8. Lightweight acceptance process

For each stage, use a focused control matrix rather than broad app regression:

1. **Variant/state matrix**: normal, hover, focus-visible, disabled, dark/light surface, compact/mobile, portal open.
2. **Cascade matrix**: body host classes, piano host classes, guitar host classes; CSS load order normal/reversed; assert computed height, padding, radius, font, colors, focus/disabled.
3. **Route smoke**: feed → preview green Practice → body practice; feed → preview → piano/guitar practice; open/close dock settings, View menu, sections, fullscreen; no dead/duplicate settings entry.
4. **Visual baseline**: browser screenshots at desktop and ≤600px for feed, preview, three practice routes, settings sheet and View menu. Compare with baseline before/after; no redesign.
5. **Accessibility spot checks**: native select keyboard behavior, menu popup Escape/outside/focus return, dialog focus trap/inert, labels/roles.
6. **No broad suite requirement for CSS-only extraction**; retain existing focused tests and add one computed-style/cascade test only where it guards a known regression.

---

## 9. Unknowns / not verified

- No browser screenshots, DevTools computed styles, zoom behavior, or actual touch/keyboard checks were performed.
- `MusicLessonHome`/`MusicLessonScreen` are unreachable from the current `LibraryApp` learner route but may be used by external/dynamic imports; confirm before deleting.
- `PianoWorkspaceHarness` contains dormant practice branches from the old review/practice composition; they are not the active practice route and may contain stale selectors.
- `lesson-mode-control`, `ws-practice-view-select`, `music-practice-player`, `ws-practice-footer` have no current TSX references in `apps/web/src`; no runtime confirmation of zero use.
- CSS values are source declarations; actual computed values can be affected by future worker edits, stylesheet order, browser normalization, and native control rendering.

## 10. Bottom line

Yes: learner controls should share an underlying control/token architecture. No: they should not become one undifferentiated visual control. The current app has a strong shared practice-runtime core and real reusable dock/settings/view components; the remaining gap is **visual ownership and variant contracts**, especially host CSS, settings/dialog composition, and state styling. Start with the dock/transport and explicit variants, freeze current appearance with computed-style baselines, then migrate watch and feed in bounded stages.
